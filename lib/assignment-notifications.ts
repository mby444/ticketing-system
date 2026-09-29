import type { EmailJob } from "@/lib/qstash";

/** A change in ticket ownership, as observed by assignTicket. */
export type AssignmentChange = {
  ticketId: number;
  /** null when the ticket was unassigned. */
  previousAssigneeId: string | null;
  /** null when the ticket is being unassigned. */
  nextAssigneeId: string | null;
};

export type AssignmentNotification = {
  job: EmailJob;
  deduplicationId: string;
};

/**
 * Decides which notifications an assignment change produces. Pure — the
 * callers only publish what comes back.
 *
 * One job per recipient on purpose: a single job mailing two people would
 * re-deliver the first email whenever a retry landed after it had succeeded.
 * The `deduplicationId` keys are stable per ticket+person so a
 * timeout-then-retry collapses instead of mailing twice.
 *
 * A change to the same value (including unassigning an already-unassigned
 * ticket) is a no-op and notifies nobody.
 */
export function buildAssignmentNotifications({
  ticketId,
  previousAssigneeId,
  nextAssigneeId,
}: AssignmentChange): AssignmentNotification[] {
  if (previousAssigneeId === nextAssigneeId) return [];

  const notifications: AssignmentNotification[] = [];

  if (nextAssigneeId) {
    notifications.push({
      job: { type: "TICKET_ASSIGNED", ticketId, assigneeId: nextAssigneeId },
      deduplicationId: `assigned_${ticketId}_${nextAssigneeId}`,
    });
  }

  if (previousAssigneeId) {
    notifications.push({
      job: { type: "TICKET_UNASSIGNED", ticketId, previousAssigneeId },
      deduplicationId: `unassigned_${ticketId}_${previousAssigneeId}`,
    });
  }

  return notifications;
}
