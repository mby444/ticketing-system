import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";

/**
 * OTP generation, encryption and comparison for password reset.
 *
 * Pure and dependency-free (no Next, no Prisma) so the security-relevant parts
 * are unit tested in milliseconds — the same trade-off already made for
 * `lib/attachment-limits.ts` and `lib/notifications.ts`.
 *
 * WHY ENCRYPTED RATHER THAN HASHED, which is the non-obvious choice here:
 * a normal password is hashed because the server only ever *compares* it. An OTP
 * has the opposite requirement — the QStash worker must *recover* the code to
 * render it into the email. A one-way hash makes that impossible, which would
 * force the plaintext code through the message broker and the action's return
 * value. So the row stores a reversible ciphertext that only the server can
 * read, and the credential never leaves the process boundary.
 *
 * The key is derived from AUTH_SECRET via HKDF with a fixed, versioned salt.
 * No new environment variable is introduced, and rotating AUTH_SECRET
 * invalidates every outstanding OTP for free — the old rows simply fail to
 * decrypt, which `decryptOtp` reports as `null` rather than throwing.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT = "quickticket:otp:v1";

/**
 * Derives the AES key from AUTH_SECRET.
 *
 * Returns null when AUTH_SECRET is absent or too short, so the caller can fail
 * with a clear message instead of a cryptic OpenSSL error at encrypt time.
 */
const deriveKey = (): Buffer | null => {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) return null;
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from(SALT), Buffer.from(SALT), KEY_BYTES),
  );
};

/**
 * A 6-digit zero-padded code from a CSPRNG.
 *
 * `crypto.randomInt`, never `Math.random`: the seeded RNG in `prisma/seed-data.ts`
 * is fine for reproducible demo data, and this is not that — a predictable reset
 * code is a takeover.
 */
export const generateOtpCode = (): string =>
  randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");

/** AES-256-GCM. Returns `iv:authTag:ciphertext`, each base64url. */
export const encryptOtp = (code: string): string | null => {
  const key = deriveKey();
  if (!key) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);

  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(":");
};

/**
 * Reverses `encryptOtp`.
 *
 * Returns **null** for any failure — wrong key, tampered ciphertext, truncated
 * input — rather than throwing. A stale row from before a secret rotation must
 * degrade to "this code does not verify", never to a 500 inside the QStash
 * worker where it would be retried five times.
 */
export const decryptOtp = (payload: string): string | null => {
  const key = deriveKey();
  if (!key) return null;

  const parts = payload.split(":");
  if (parts.length !== 3) return null;

  try {
    const [iv, authTag, ciphertext] = parts.map((part) =>
      Buffer.from(part, "base64url"),
    );
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
};

/**
 * Length-safe constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared
 * first — and the comparison short-circuits *before* any early return on the
 * content, so a wrong guess reveals nothing about how much of the code was
 * right. A naive `===` would leak a timing oracle that recovers the code digit
 * by digit.
 */
export const otpMatches = (candidate: string, expected: string): boolean => {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

/** A code the UI can show in dev; never logs or emails anything itself. */
export const isOtpCode = (value: string): boolean =>
  new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);