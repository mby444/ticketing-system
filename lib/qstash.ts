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
  | { type: "NEW_COMMENT"; ticketId: number; commentId: number };

/**
 * Best-effort enqueue of one email job.
 *
 * A QStash outage must never fail the ticket action that triggered it, so
 * every failure is reported to Sentry and swallowed here (no rethrow).
 * Only the lightweight publish is awaited — the actual email is rendered and
 * sent later by the worker route (`/api/jobs/send-email`) in the background,
 * with automatic retries.
 *
 * The `Client` picks up `QSTASH_URL` from the environment for its base URL.
 */
export async function publishJob(job: EmailJob): Promise<void> {
  try {
    const client = new Client({ token: process.env.QSTASH_TOKEN });
    const result = await client.publishJSON({
      url: `${process.env.APP_URL}/api/jobs/send-email`,
      body: job,
      retries: 5,
    });
    logEvent("Email job enqueued", "email", {
      type: job.type,
      ticketId: job.ticketId,
      messageId: result.messageId,
    });
  } catch (error) {
    logEvent("Failed to enqueue email job", "email", { job }, "warning", error);
  }
}
