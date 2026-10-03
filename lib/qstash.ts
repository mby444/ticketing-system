import { Client } from "@upstash/qstash";
import { logEvent } from "@/utils/sentry";

/**
 * Payload published to QStash for asynchronous email delivery. Deliberately
 * minimal: the worker re-reads fresh ticket/recipient data from the database,
 * so no PII ever sits in the message broker.
 */
export type EmailJob =
  | { type: "TICKET_CREATED"; ticketId: number }
  | { type: "STATUS_UPDATED"; ticketId: number; newStatus: string }
  | { type: "NEW_COMMENT"; ticketId: number; commentId: number }
  // One job per recipient, on purpose. A single job mailing two people would
  // duplicate the first email whenever a retry happened after it succeeded.
  | { type: "TICKET_ASSIGNED"; ticketId: number; assigneeId: string }
  | { type: "TICKET_UNASSIGNED"; ticketId: number; previousAssigneeId: string };

/**
 * Payload published to QStash for asynchronous in-app notification creation.
 *
 * Unlike EmailJob, this carries the target userId and pre-computed title/body/
 * dedupeKey because the notification worker does NOT re-read recipient logic
 * from the database - it simply writes the rows. The recipient logic lives in
 * lib/notifications.ts and is executed at PUBLISH time (in the ticket actions),
 * so the worker is a dumb writer. This keeps the worker fast and side-effect
 * free (one insert per recipient).
 *
 * The dedupeKey + unique index in the DB is what collapses QStash retries.
 * No QStash-level deduplicationId is used here.
 */
export type NotificationJob = {
  userId: string;
  type: "TICKET_CREATED" | "STATUS_UPDATED" | "NEW_COMMENT" | "TICKET_ASSIGNED" | "TICKET_UNASSIGNED";
  ticketId: number;
  title: string;
  body?: string;
  dedupeKey: string;
};

/**
 * Best-effort enqueue of one email job.
 *
 * A QStash outage must never fail the ticket action that triggered it, so
 * every failure is reported to Sentry and swallowed here (no rethrow).
 * Only the lightweight publish is awaited — the actual email is rendered and
 * sent later by the worker route (`/api/jobs/send-email`) in the background,
 * with automatic retries.
 *
 * `deduplicationId` is optional: pass a stable key to make QStash collapse
 * retries of the same logical notification. It is how the assignment events
 * avoid duplicate mail, since a timeout-then-retry would otherwise deliver the
 * same "you have been assigned" twice.
 *
 * The `Client` picks up `QSTASH_URL` from the environment for its base URL.
 */
export async function publishJob(
  job: EmailJob,
  options?: { deduplicationId?: string },
): Promise<void> {
  try {
    const client = new Client({ token: process.env.QSTASH_TOKEN });
    const result = await client.publishJSON({
      url: `${process.env.APP_URL}/api/jobs/send-email`,
      body: job,
      retries: 5,
      ...(options?.deduplicationId
        ? { deduplicationId: options.deduplicationId }
        : {}),
    });
    logEvent("Email job enqueued", "email", {
      type: job.type,
      ticketId: job.ticketId,
      messageId: result.messageId,
      deduplicationId: options?.deduplicationId,
    });
  } catch (error) {
    logEvent("Failed to enqueue email job", "email", { job }, "warning", error);
  }
}

/**
 * Best-effort enqueue of one in-app notification job.
 *
 * Same contract as publishJob: failures are swallowed, only the publish is
 * awaited. The worker at /api/jobs/create-notification writes the row.
 *
 * No deduplicationId here — the DB unique index on
 * (userId, type, ticketId, dedupeKey) with skipDuplicates is what collapses
 * retries. Adding a second mechanism would mean reasoning about two retention
 * windows.
 */
export async function publishNotificationJob(
  job: NotificationJob,
): Promise<void> {
  try {
    const client = new Client({ token: process.env.QSTASH_TOKEN });
    const result = await client.publishJSON({
      url: `${process.env.APP_URL}/api/jobs/create-notification`,
      body: job,
      retries: 5,
    });
    logEvent("Notification job enqueued", "notification", {
      type: job.type,
      ticketId: job.ticketId,
      userId: job.userId,
      messageId: result.messageId,
    });
  } catch (error) {
    logEvent("Failed to enqueue notification job", "notification", { job }, "warning", error);
  }
}
