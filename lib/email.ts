import type { ReactElement } from "react";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/utils/sentry";
import type { EmailJob } from "@/lib/qstash";
import { TicketCreatedEmail } from "@/emails/ticket-created";
import { StatusUpdatedEmail } from "@/emails/status-updated";
import { NewCommentEmail } from "@/emails/new-comment";

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
 * The recipient is always the ticket owner, re-read from the database at
 * send time so the address can never be stale data from the queue payload.
 */
export async function sendJobEmail(job: EmailJob): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: job.ticketId },
    include: { user: { select: { email: true } } },
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
  const to = ticket.user.email;

  let email: { subject: string; react: ReactElement };

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
    case "NEW_COMMENT":
      email = {
        subject: `New reply on ticket #${ticket.id}`,
        react: NewCommentEmail({
          ticketId: ticket.id,
          subject: ticket.subject,
          ticketUrl,
        }),
      };
      break;
  }

  const { error } = await resend.emails.send({
    from: senderAddress(),
    to,
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
    to,
  });
}
