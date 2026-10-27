import { Receiver } from "@upstash/qstash";
import { sendJobEmail } from "@/lib/email";
import { isValidJob } from "@/lib/qstash";
import { logEvent } from "@/utils/sentry";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

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
