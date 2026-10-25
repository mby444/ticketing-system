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
 *
 * The switch is on `type` FIRST, with the field checks inside each arm. An
 * earlier version checked `typeof job.ticketId === "number"` before the switch,
 * which silently excluded every ticketless job — PASSWORD_RESET_OTP has no
 * ticket and was rejected as malformed before the worker ever saw it.
 *
 * Exported so the contract can be locked down in a test. A shape check that
 * rejects a valid payload fails *silently*: QStash gets a 200, nothing is sent,
 * and the only symptom is a code that never arrives.
 */
export function isValidJob(value: unknown): value is EmailJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;

  switch (job.type) {
    case "TICKET_CREATED":
      return typeof job.ticketId === "number";
    case "STATUS_UPDATED":
      return typeof job.ticketId === "number" && typeof job.newStatus === "string";
    case "NEW_COMMENT":
      return typeof job.ticketId === "number" && typeof job.commentId === "number";
    case "TICKET_ASSIGNED":
      return typeof job.ticketId === "number" && typeof job.assigneeId === "string";
    case "TICKET_UNASSIGNED":
      return (
        typeof job.ticketId === "number" &&
        typeof job.previousAssigneeId === "string"
      );
    case "PASSWORD_RESET_OTP":
      // Deliberately no ticketId, and deliberately no code: the worker reads
      // both the address and the credential from the database.
      return typeof job.userId === "string" && typeof job.otpId === "string";
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

  // `ticketId` is absent on PASSWORD_RESET_OTP, so the log carries whichever
  // identifiers the job actually has.
  const jobRef =
    payload.type === "PASSWORD_RESET_OTP"
      ? { userId: payload.userId, otpId: payload.otpId }
      : { ticketId: payload.ticketId };

  try {
    await sendJobEmail(payload);
    logEvent("Email job processed", "email", { type: payload.type, ...jobRef });
    return new Response("OK", { status: 200 });
  } catch (error) {
    logEvent(
      "Email job failed — QStash will retry",
      "email",
      { type: payload.type, ...jobRef },
      "error",
      error,
    );
    return new Response("Email delivery failed", { status: 500 });
  }
}
