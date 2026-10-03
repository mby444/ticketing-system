import type { Role } from "@/generated/prisma/client";
import { isStaff } from "./roles";

/**
 * Pure in-app notification logic: who to tell, what to say, and how a retry is
 * told apart from a genuine second event.
 *
 * Dependency-free (no Next, no Prisma value import) for the same reason as
 * `lib/dashboard-filters.ts`: this is the security-relevant part of the feature,
 * so it is unit tested rather than only reached through the UI. It is imported
 * by the ticket actions, which run inside the QStash-triggering request.
 */

export type NotificationEvent =
  | { type: "TICKET_CREATED"; ticketId: number }
  | { type: "STATUS_UPDATED"; ticketId: number; newStatus: string }
  | { type: "NEW_COMMENT"; ticketId: number; commentId: number }
  | { type: "TICKET_ASSIGNED"; ticketId: number; assigneeId: string }
  | { type: "TICKET_UNASSIGNED"; ticketId: number; previousAssigneeId: string };

export type NotificationContext = {
  ticket: { id: number; userId: string; assigneeId: string | null; subject: string };
  actor: { id: string; role: Role };
  /** Every current staff id, so a fan-out does not need one query per person. */
  staffIds: string[];
  /** NEW_COMMENT only: who wrote the comment. */
  commentAuthor?: { id: string; role: Role };
  /** NEW_COMMENT only: set when the comment has been soft-deleted. */
  commentDeletedAt?: Date | null;
};

/**
 * Who receives an in-app notification for one event.
 *
 * Deliberately a list of concrete user ids rather than "the staff group": the
 * caller passes `staffIds` read moments earlier, so the fan-out is resolved
 * before anything is published. An earlier draft modelled this as
 * `{ kind: "staff" }` and expanded it in the worker, which meant a job sat in the
 * broker naming no recipient — harder to retry, impossible to inspect, and it
 * still had to query the staff list. Resolving here keeps the payload concrete.
 *
 * THE ACTOR IS NEVER NOTIFIED. Every branch filters them out, otherwise people
 * get pinged for their own clicks.
 */
export function notificationRecipients(
  event: NotificationEvent,
  ctx: NotificationContext,
): string[] {
  const { actor, ticket, staffIds } = ctx;

  switch (event.type) {
    case "TICKET_CREATED": {
      // Staff triage incoming work; the person who filed it already knows.
      return staffIds.filter((id) => id !== actor.id);
    }

    case "STATUS_UPDATED": {
      // Owner and assignee, minus whoever pressed save.
      const recipients = [ticket.userId];
      if (ticket.assigneeId) recipients.push(ticket.assigneeId);
      return [...new Set(recipients)].filter((id) => id !== actor.id);
    }

    case "NEW_COMMENT": {
      const author = ctx.commentAuthor;
      // A soft-deleted comment retracts the whole message, screenshots included,
      // so there is nothing true left to announce.
      if (!author || ctx.commentDeletedAt) return [];

      if (isStaff(author)) {
        return ticket.userId === actor.id ? [] : [ticket.userId];
      }

      if (ticket.assigneeId) {
        return ticket.assigneeId === actor.id ? [] : [ticket.assigneeId];
      }
      // The deliberate divergence from email, which resolves this same case to a
      // no-op because there is no assignee address to send to. An in-app row
      // needs no address, so this is where email backlog #2 stops being a hole.
      return staffIds.filter((id) => id !== actor.id);
    }

    case "TICKET_ASSIGNED": {
      // Not the person doing the assigning, and not the ticket owner — telling
      // an owner they own their own ticket is noise.
      if (event.assigneeId === actor.id || event.assigneeId === ticket.userId) {
        return [];
      }
      return [event.assigneeId];
    }

    case "TICKET_UNASSIGNED": {
      // Whether they still exist is a worker concern; the caller has already
      // validated that this id was a real, staff assignee.
      if (event.previousAssigneeId === actor.id) return [];
      return [event.previousAssigneeId];
    }
  }
}

export type NotificationContent = {
  title: string;
  body: string;
  /**
   * Distinguishes two genuine occurrences of the same event type on the same
   * ticket, which together with the unique index on
   * (userId, type, ticketId, dedupeKey) is what makes a QStash retry a no-op
   * instead of a duplicate row.
   */
  dedupeKey: string;
};

export function notificationContent(
  event: NotificationEvent,
  ctx: NotificationContext,
): NotificationContent {
  const { ticket } = ctx;
  const label = `Ticket #${ticket.id}: ${ticket.subject}`;

  switch (event.type) {
    case "TICKET_CREATED":
      return { title: "New ticket created", body: label, dedupeKey: "-" };

    case "STATUS_UPDATED":
      return {
        title: "Ticket status changed",
        body: `${label} is now ${formatStatus(event.newStatus)}`,
        // Re-setting the same status is not a new event, so it collapses.
        dedupeKey: event.newStatus,
      };

    case "NEW_COMMENT":
      return {
        title: ctx.commentAuthor && isStaff(ctx.commentAuthor)
          ? "New reply on your ticket"
          : "New customer reply",
        body: label,
        // Each comment is its own occurrence.
        dedupeKey: String(event.commentId),
      };

    case "TICKET_ASSIGNED":
      return {
        title: "Ticket assigned to you",
        body: label,
        // Assign and reassign are two different events; this deliberately keys
        // on "-" so a re-assignment to the same person collapses.
        dedupeKey: "-",
      };

    case "TICKET_UNASSIGNED":
      return {
        title: "Ticket no longer assigned to you",
        body: label,
        dedupeKey: "-",
      };
  }
}

const formatStatus = (status: string): string => status.replace(/_/g, " ");

/** One row to write, per recipient. */
export type NotificationJob = {
  userId: string;
  type: NotificationEvent["type"];
  ticketId: number;
  title: string;
  body: string;
  dedupeKey: string;
};

export function buildNotificationJobs(
  event: NotificationEvent,
  ctx: NotificationContext,
): NotificationJob[] {
  const content = notificationContent(event, ctx);

  return notificationRecipients(event, ctx).map((userId) => ({
    userId,
    type: event.type,
    ticketId: event.ticketId,
    title: content.title,
    body: content.body,
    dedupeKey: content.dedupeKey,
  }));
}