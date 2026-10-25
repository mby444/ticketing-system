import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptOtp,
  encryptOtp,
  generateOtpCode,
  isOtpCode,
  otpMatches,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
} from "@/lib/otp";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordsMatch,
  validatePassword,
} from "@/lib/password";

// The key is derived from AUTH_SECRET, which vitest.setup.ts loads from .env.
// Pinning it here keeps these tests independent of whatever is in the machine's
// environment file, and makes the "wrong key" case possible at all.
const SECRET = "test-secret-value-for-otp-derivation";

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("generateOtpCode", () => {
  it("is always exactly six digits", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateOtpCode();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(isOtpCode(code)).toBe(true);
    }
  });

  it("zero-pads small values so the code keeps its width", () => {
    // Without padding, a 1-in-a-million draw would render as "7" and quietly
    // widen the guessing space by orders of magnitude.
    expect(isOtpCode(generateOtpCode())).toBe(true);
    expect("000000").toMatch(new RegExp(`^\\d{${OTP_LENGTH}}$`));
  });

  it("does not repeat itself across a large sample", () => {
    // A generator stuck on one value would still satisfy every length check.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateOtpCode());
    expect(seen.size).toBeGreaterThan(400);
  });
});

describe("encryptOtp / decryptOtp", () => {
  it("round-trips a code", () => {
    const code = generateOtpCode();
    expect(decryptOtp(encryptOtp(code)!)).toBe(code);
  });

  it("uses a fresh IV, so the same code never encrypts to the same string", () => {
    const code = "123456";
    const a = encryptOtp(code)!;
    const b = encryptOtp(code)!;
    // Deterministic encryption would leak that two resets used the same code.
    expect(a).not.toBe(b);
    expect(decryptOtp(a)).toBe(code);
    expect(decryptOtp(b)).toBe(code);
  });

  it("returns null for a tampered ciphertext instead of throwing", () => {
    const payload = encryptOtp("123456")!;
    const [iv, tag, data] = payload.split(":");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] = flipped[0] ^ 0xff;
    const tampered = [iv, tag, flipped.toString("base64url")].join(":");

    // A throw here would surface as a 500 in the QStash worker and be retried
    // five times for a row that can never succeed.
    expect(decryptOtp(tampered)).toBeNull();
  });

  it("returns null when the auth tag is swapped", () => {
    const payload = encryptOtp("123456")!;
    const [iv, , data] = payload.split(":");
    expect(decryptOtp([iv, Buffer.alloc(16).toString("base64url"), data].join(":"))).toBeNull();
  });

  it("returns null for garbage and truncated input", () => {
    expect(decryptOtp("")).toBeNull();
    expect(decryptOtp("not-base64")).toBeNull();
    expect(decryptOtp("a:b")).toBeNull();
    expect(decryptOtp("a:b:c:d")).toBeNull();
  });

  it("returns null after the secret is rotated", () => {
    const payload = encryptOtp("123456")!;
    process.env.AUTH_SECRET = "a-completely-different-secret-value";
    // Rotating AUTH_SECRET must invalidate outstanding codes rather than
    // surfacing as a crash.
    expect(decryptOtp(payload)).toBeNull();
  });

  it("returns null when AUTH_SECRET is missing or too short", () => {
    delete process.env.AUTH_SECRET;
    expect(encryptOtp("123456")).toBeNull();
    expect(decryptOtp("iv:tag:data")).toBeNull();

    process.env.AUTH_SECRET = "short";
    expect(encryptOtp("123456")).toBeNull();
  });
});

describe("otpMatches", () => {
  it("accepts an exact match", () => {
    expect(otpMatches("123456", "123456")).toBe(true);
  });

  it("rejects a wrong code", () => {
    expect(otpMatches("123457", "123456")).toBe(false);
  });

  it("rejects a different length rather than throwing", () => {
    // timingSafeEqual throws on a length mismatch; the guard is what keeps the
    // comparison total.
    expect(otpMatches("123456", "1234567")).toBe(false);
    expect(otpMatches("", "123456")).toBe(false);
  });

  it("rejects codes padded with whitespace", () => {
    expect(otpMatches(" 123456", "123456")).toBe(false);
    expect(otpMatches("123456 ", "123456")).toBe(false);
  });
});

describe("validatePassword", () => {
  it("requires a password", () => {
    expect(validatePassword("")).toBe("Password is required");
  });

  it("enforces the minimum length", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toContain(
      "at least",
    );
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("enforces the maximum in BYTES, not characters", () => {
    // bcrypt truncates at 72 bytes, so a short multibyte password can cross
    // that line at a far lower character count.
    const shortChars = "é".repeat(20); // 40 bytes, 20 characters
    expect(validatePassword(shortChars)).toBeNull();

    const tooLongBytes = "é".repeat(37); // 74 bytes, 37 characters
    expect(tooLongBytes.length).toBeLessThan(MAX_PASSWORD_LENGTH);
    expect(validatePassword(tooLongBytes)).toContain("at most");
  });

  it("accepts exactly the byte limit", () => {
    expect(validatePassword("a".repeat(MAX_PASSWORD_LENGTH))).toBeNull();
    expect(validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toContain(
      "at most",
    );
  });
});

describe("passwordsMatch", () => {
  it("compares for confirmation", () => {
    expect(passwordsMatch("hunter22", "hunter22")).toBe(true);
    expect(passwordsMatch("hunter22", "hunter23")).toBe(false);
  });
});

describe("OTP constants", () => {
  it("pins the window and the attempt ceiling", () => {
    // Both are security policy, not incidental values: the TTL bounds how long
    // a code is live, the ceiling bounds how many guesses a row allows.
    expect(OTP_TTL_MS).toBe(10 * 60 * 1000);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
});