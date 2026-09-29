import type { ReactElement } from "react";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { isStaff } from "@/lib/roles";
import { logEvent } from "@/utils/sentry";
import type { EmailJob } from "@/lib/qstash";
import { TicketCreatedEmail } from "@/emails/ticket-created";
import { StatusUpdatedEmail } from "@/emails/status-updated";
import { NewCommentEmail } from "@/emails/new-comment";
import { TicketAssignedEmail } from "@/emails/ticket-assigned";

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sender identity must be configured; a missing value throws so the route
 * reports it to Sentry and QStash retries (it cannot self-heal, but the
 * failure stays visible instead of silently sending from a bogus address).
 */
const senderAddress = (): string => {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set");
  return from;
};

/** "In_Progress" → "In Progress" for display in subjects and templates. */
const formatStatus = (status: string) => status.replace(/_/g, " ");

/**
 * Renders and sends the email for one verified QStash job.
 *
 * Contract used by the worker route:
 * - resolves     → job done (or a logged permanent no-op, e.g. ticket gone)
 * - throws       → transient failure; the route answers 500 so QStash
 *                  retries the delivery with exponential backoff
 *
 * The recipient is resolved from the database at send time so the address can
 * never be stale data from the queue payload. TICKET_CREATED and STATUS_UPDATED
 * always go to the ticket owner; NEW_COMMENT is two-way (a staff reply notifies
 * the owner, a customer reply notifies the assignee) and may legitimately have
 * no recipient at all. TICKET_ASSIGNED / TICKET_UNASSIGNED notify exactly one
 * staff member each — they are published one job per recipient on purpose, so
 * a retry can never duplicate the other recipient's email.
 */
export async function sendJobEmail(job: EmailJob): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: job.ticketId },
    include: {
      user: { select: { id: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  if (!ticket) {
    // Permanent: nothing left to notify about — acknowledge instead of retrying.
    logEvent(
      "Email job skipped: ticket no longer exists",
      "email",
      { job },
      "warning",
    );
    return;
  }

  const ticketUrl = `${process.env.APP_URL}/tickets/${ticket.id}`;

  let email: { subject: string; react: ReactElement; to?: string };

  switch (job.type) {
    case "TICKET_CREATED":
      email = {
        subject: `Ticket #${ticket.id} received: ${ticket.subject}`,
        react: TicketCreatedEmail({
          ticketId: ticket.id,
          subject: ticket.subject,
          priority: ticket.priority,
          ticketUrl,
        }),
      };
      break;
    case "STATUS_UPDATED":
      email = {
        subject: `Ticket #${ticket.id} is now ${formatStatus(job.newStatus)}`,
        react: StatusUpdatedEmail({
          ticketId: ticket.id,
          subject: ticket.subject,
          status: formatStatus(job.newStatus),
          ticketUrl,
        }),
      };
      break;
    case "NEW_COMMENT": {
      const comment = await prisma.ticketComment.findUnique({
        where: { id: job.commentId },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      });

      if (!comment) {
        // Permanent: the comment went away with its ticket. Acknowledge.
        logEvent(
          "Email job skipped: comment no longer exists",
          "email",
          { job },
          "warning",
        );
        return;
      }

      const authorIsStaff = isStaff(comment.user);

      // A staff reply notifies the customer; a customer reply notifies the
      // assignee. With no assignee there is nobody to notify — deliberately a
      // no-op rather than broadcasting every ticket to every agent.
      const recipient = authorIsStaff
        ? ticket.user.email
        : ticket.assignedTo?.email;

      if (!recipient) {
        logEvent(
          "Email job skipped: customer reply on an unassigned ticket",
          "email",
          { ticketId: ticket.id, commentId: comment.id },
          "warning",
        );
        return;
      }

      if (recipient === comment.user.email) {
        // E.g. an admin replying on a ticket they own themselves.
        logEvent(
          "Email job skipped: author is the only party to notify",
          "email",
          { ticketId: ticket.id, commentId: comment.id },
          "debug",
        );
        return;
      }

      email = {
        to: recipient,
        subject: authorIsStaff
          ? `New reply on ticket #${ticket.id}: ${ticket.subject}`
          : `New customer reply on ticket #${ticket.id}: ${ticket.subject}`,
        react: NewCommentEmail({
          ticketId: ticket.id,
          subject: ticket.subject,
          authorName: comment.user.name ?? comment.user.email,
          isStaffAuthor: authorIsStaff,
          body: comment.body,
          ticketUrl,
        }),
      };
      break;
    }
    case "TICKET_ASSIGNED": {
      // The ticket may have been reassigned again before this job ran, in which
      // case "you have been assigned" is simply no longer true.
      if (!ticket.assignedTo || ticket.assignedTo.id !== job.assigneeId) {
        logEvent(
          "Email job skipped: ticket has since been reassigned",
          "email",
          { ticketId: ticket.id, job },
          "warning",
        );
        return;
      }

      if (ticket.assignedTo.email === ticket.user.email) {
        // E.g. an admin assigning a ticket they own to themselves.
        logEvent(
          "Email job skipped: assignee owns the ticket",
          "email",
          { ticketId: ticket.id },
          "debug",
        );
        return;
      }

      email = {
        to: ticket.assignedTo.email,
        subject: `Ticket #${ticket.id} was assigned to you: ${ticket.subject}`,
        react: TicketAssignedEmail({
          variant: "assigned",
          agentName: ticket.assignedTo.name ?? ticket.assignedTo.email,
          ticketId: ticket.id,
          subject: ticket.subject,
          ticketUrl,
        }),
      };
      break;
    }
    case "TICKET_UNASSIGNED": {
      // The previous assignee has to come from the payload: the ticket row only
      // remembers the current one. Looked up by id so no address sits in the
      // broker.
      const previous = await prisma.user.findUnique({
        where: { id: job.previousAssigneeId },
        select: { id: true, name: true, email: true },
      });

      if (!previous || previous.email === ticket.user.email) {
        logEvent(
          "Email job skipped: previous assignee is gone or owns the ticket",
          "email",
          { ticketId: ticket.id, job },
          "warning",
        );
        return;
      }

      email = {
        to: previous.email,
        subject: `Ticket #${ticket.id} is no longer assigned to you: ${ticket.subject}`,
        react: TicketAssignedEmail({
          variant: "unassigned",
          agentName: previous.name ?? previous.email,
          ticketId: ticket.id,
          subject: ticket.subject,
          ticketUrl,
        }),
      };
      break;
    }
  }

  // TICKET_CREATED / STATUS_UPDATED leave `to` unset and fall back to the owner.
  const recipient = email.to ?? ticket.user.email;

  const { error } = await resend.emails.send({
    from: senderAddress(),
    to: recipient,
    subject: email.subject,
    react: email.react,
  });

  if (error) {
    // Resend returns errors as data (validation, rate limit, API key issues).
    throw new Error(`Resend send failed [${error.name}]: ${error.message}`);
  }

  logEvent("Email sent", "email", {
    type: job.type,
    ticketId: ticket.id,
    to: recipient,
  });
}
