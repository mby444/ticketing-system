import { Receiver } from "@upstash/qstash";
import { prisma } from "@/lib/prisma";
import type { NotificationJob } from "@/lib/qstash";
import { logEvent } from "@/utils/sentry";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

/**
 * Shape check for an already-authenticated payload. Anything unexpected
 * (unknown type, wrong field types) is a permanent error — acknowledging it
 * with 200 keeps QStash from retrying a message that can never succeed.
 */
function isValidJob(value: unknown): value is NotificationJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  if (typeof job.userId !== "string") return false;
  if (typeof job.ticketId !== "number") return false;
  if (typeof job.title !== "string") return false;
  if (typeof job.dedupeKey !== "string") return false;
  if (job.body !== undefined && typeof job.body !== "string") return false;
  const validTypes = [
    "TICKET_CREATED",
    "STATUS_UPDATED",
    "NEW_COMMENT",
    "TICKET_ASSIGNED",
    "TICKET_UNASSIGNED",
  ];
  return validTypes.includes(job.type as string);
}

/**
 * QStash worker endpoint for in-app notifications.
 *
 * Authentication = HMAC signature verification (`Upstash-Signature` header
 * checked against both signing keys, so key rotation never drops messages).
 * There is intentionally no session/cookie check here.
 *
 * Status-code contract with QStash retries:
 * - 200 -> done (inserted, or permanent no-op already logged to Sentry)
 * - 500 -> transient failure -> QStash retries with exponential backoff
 * - 401 -> signature invalid -> request rejected unprocessed
 *
 * Unlike the email worker, this route does NOT re-read recipient logic.
 * The publisher (ticket actions) computes recipients and publishes one job
 * per recipient. This worker simply inserts the row. The unique index on
 * (userId, type, ticketId, dedupeKey) with skipDuplicates is what collapses
 * QStash retries — a retry becomes a silent no-op rather than a 500 that
 * retries forever.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("Upstash-Signature") ?? "";
  const rawBody = await request.text();

  let verified = false;
  try {
    verified = await receiver.verify({ signature, body: rawBody });
  } catch (error) {
    logEvent(
      "QStash signature verification threw (notification)",
      "notification",
      { signature: signature.slice(0, 16) },
      "warning",
      error,
    );
  }

  if (!verified) {
    logEvent(
      "Rejected notification job: invalid QStash signature",
      "notification",
      {},
      "warning",
    );
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Authentic (signature verified) but unparseable -> permanent, do not retry.
    logEvent(
      "Notification job dropped: body is not valid JSON",
      "notification",
      {},
      "error",
    );
    return new Response("Malformed payload", { status: 200 });
  }

  if (!isValidJob(payload)) {
    logEvent(
      "Notification job dropped: unknown or malformed event",
      "notification",
      { payload },
      "warning",
    );
    return new Response("Unknown event", { status: 200 });
  }

  try {
    // The ticket must still exist for the notification to be meaningful.
    // If it's gone, this is a permanent no-op (nothing left to notify about).
    const ticket = await prisma.ticket.findUnique({
      where: { id: payload.ticketId },
      select: { id: true },
    });

    if (!ticket) {
      logEvent(
        "Notification job skipped: ticket no longer exists",
        "notification",
        { type: payload.type, ticketId: payload.ticketId },
        "warning",
      );
      return new Response("OK", { status: 200 });
    }

    // skipDuplicates, not `create`. This is load-bearing, not defensive: QStash
    // retries on a 500, and the unique index on (userId, type, ticketId,
    // dedupeKey) means the FIRST attempt raises a unique-constraint error, which
    // would become a 500, which QStash would retry — and every retry would fail
    // the same way. skipDuplicates makes the replay a no-op counted as success.
    const { count } = await prisma.notification.createMany({
      data: [
        {
          userId: payload.userId,
          type: payload.type,
          ticketId: payload.ticketId,
          title: payload.title,
          body: payload.body,
          dedupeKey: payload.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });

    logEvent("Notification job processed", "notification", {
      type: payload.type,
      ticketId: payload.ticketId,
      userId: payload.userId,
      // 0 means this was a replay of a job already applied.
      inserted: count,
    });
    return new Response("OK", { status: 200 });
  } catch (error) {
    logEvent(
      "Notification job failed — QStash will retry",
      "notification",
      { type: payload.type, ticketId: payload.ticketId, userId: payload.userId },
      "error",
      error,
    );
    return new Response("Notification insert failed", { status: 500 });
  }
}