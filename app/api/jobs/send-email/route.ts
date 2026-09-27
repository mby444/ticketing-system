import { Receiver } from "@upstash/qstash";
import { sendJobEmail } from "@/lib/email";
import type { EmailJob } from "@/lib/qstash";
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
function isValidJob(value: unknown): value is EmailJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  if (typeof job.ticketId !== "number") return false;
  switch (job.type) {
    case "TICKET_CREATED":
      return true;
    case "STATUS_UPDATED":
      return typeof job.newStatus === "string";
    case "NEW_COMMENT":
      return typeof job.commentId === "number";
    default:
      return false;
  }
}

/**
 * QStash worker endpoint.
 *
 * Authentication = HMAC signature verification (`Upstash-Signature` header
 * checked against both signing keys, so key rotation never drops messages).
 * There is intentionally no session/cookie check here.
 *
 * Status-code contract with QStash retries:
 * - 200 → done (sent, or permanent no-op already logged to Sentry)
 * - 500 → transient failure → QStash retries with exponential backoff
 * - 401 → signature invalid → request rejected unprocessed
 */
export async function POST(request: Request) {
  const signature = request.headers.get("Upstash-Signature") ?? "";
  const rawBody = await request.text();

  let verified = false;
  try {
    verified = await receiver.verify({ signature, body: rawBody });
  } catch (error) {
    logEvent(
      "QStash signature verification threw",
      "email",
      { signature: signature.slice(0, 16) },
      "warning",
      error,
    );
  }

  if (!verified) {
    logEvent("Rejected email job: invalid QStash signature", "email", {}, "warning");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Authentic (signature verified) but unparseable → permanent, do not retry.
    logEvent("Email job dropped: body is not valid JSON", "email", {}, "error");
    return new Response("Malformed payload", { status: 200 });
  }

  if (!isValidJob(payload)) {
    logEvent(
      "Email job dropped: unknown or malformed event",
      "email",
      { payload },
      "warning",
    );
    return new Response("Unknown event", { status: 200 });
  }

  try {
    await sendJobEmail(payload);
    logEvent("Email job processed", "email", {
      type: payload.type,
      ticketId: payload.ticketId,
    });
    return new Response("OK", { status: 200 });
  } catch (error) {
    logEvent(
      "Email job failed — QStash will retry",
      "email",
      { type: payload.type, ticketId: payload.ticketId },
      "error",
      error,
    );
    return new Response("Email delivery failed", { status: 500 });
  }
}
