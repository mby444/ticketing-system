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
