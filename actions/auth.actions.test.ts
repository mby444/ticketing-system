import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const mocks = vi.hoisted(() => ({
  publishJob: vi.fn(),
  logEvent: vi.fn(),
  signAuthToken: vi.fn(),
  setAuthCookie: vi.fn(),
  removeAuthCookie: vi.fn(),
}));

// Async form: a hoisted factory runs before imports initialise, so it cannot
// call createPrismaMock() synchronously (temporal dead zone).
const { prisma } = await vi.hoisted(async () => {
  const { createPrismaMock } = await import("@/test-utils/prisma-mock");
  return { prisma: createPrismaMock() };
});

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/qstash", () => ({ publishJob: mocks.publishJob }));
vi.mock("@/utils/sentry", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/auth", () => ({
  signAuthToken: mocks.signAuthToken,
  setAuthCookie: mocks.setAuthCookie,
  removeAuthCookie: mocks.removeAuthCookie,
}));

import {
  registerUser,
  requestPasswordResetOtp,
  resetPassword,
} from "@/actions/auth.actions";
import { encryptOtp, OTP_MAX_ATTEMPTS } from "@/lib/otp";
import { form } from "@/test-utils/factories";

const initial = { success: false, message: "" };

const USER = { id: "user-1", email: "user1@example.com" };
const CODE = "123456";
const EMAIL = "user1@example.com";

/** Builds the DB row the action will find, encrypted with a known code. */
const makeOtpRow = (
  overrides: Partial<{
    id: string;
    userId: string;
    codeEncrypted: string;
    expiresAt: Date;
    attempts: number;
  }> = {},
) => ({
  id: "otp-1",
  userId: USER.id,
  codeEncrypted: encryptOtp(CODE)!,
  expiresAt: new Date(Date.now() + 60_000),
  attempts: 0,
  ...overrides,
});

/** FormData for the second step, with the given code. */
const resetForm = (code = CODE, password = "newpassword1") =>
  form({
    email: EMAIL,
    code,
    password,
    confirmPassword: password,
  });

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clear wipes call history but leaves
  // mockResolvedValue/mockRejectedValue implementations behind, so one test
  // that forces a rejection silently poisons every test after it.
  vi.resetAllMocks();
  mocks.publishJob.mockResolvedValue(undefined);
  mocks.logEvent.mockReturnValue(undefined);
  mocks.setAuthCookie.mockResolvedValue(undefined);

  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    ...USER,
  } as never);
  vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(
    makeOtpRow() as never,
  );
  vi.mocked(prisma.passwordResetOtp.upsert).mockResolvedValue({
    id: "otp-1",
  } as never);
  vi.mocked(prisma.passwordResetOtp.delete).mockResolvedValue({} as never);
  vi.mocked(prisma.passwordResetOtp.deleteMany).mockResolvedValue({
    count: 0,
  } as never);
  vi.mocked(prisma.passwordResetOtp.update).mockResolvedValue({} as never);
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);

  vi.unstubAllEnvs();
});

describe("requestPasswordResetOtp — no user enumeration", () => {
  it("returns success for a registered address", async () => {
    const result = await requestPasswordResetOtp(
      initial,
      form({ email: EMAIL }),
    );

    expect(result.success).toBe(true);
    expect(mocks.publishJob).toHaveBeenCalledOnce();
  });

  it("returns the IDENTICAL state for an unknown address", async () => {
    // A different message, a different `success`, or a different presence of a
    // published job would all turn this endpoint into an account-enumeration
    // oracle.
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const known = await requestPasswordResetOtp(initial, form({ email: EMAIL }));
    const unknown = await requestPasswordResetOtp(
      initial,
      form({ email: "nobody@example.com" }),
    );

    expect(unknown).toEqual(known);
  });

  it("publishes nothing for an unknown address", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await requestPasswordResetOtp(initial, form({ email: "nobody@example.com" }));

    expect(mocks.publishJob).not.toHaveBeenCalled();
  });

  it("spends a bcrypt compare on the unknown-user branch", async () => {
    // Message equality is not enough: a measurably faster response for an
    // unregistered address enumerates accounts just as effectively.
    const spy = vi.spyOn(bcrypt, "compare");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await requestPasswordResetOtp(initial, form({ email: "nobody@example.com" }));

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("normalises the address before lookup", async () => {
    await requestPasswordResetOtp(
      initial,
      form({ email: "  USER1@Example.com " }),
    );

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: EMAIL } }),
    );
  });

  it("rejects a malformed address outright", async () => {
    // A missing "@" is a client error, not an enumeration signal — there is no
    // account to learn about.
    const result = await requestPasswordResetOtp(
      initial,
      form({ email: "not-an-email" }),
    );

    expect(result.success).toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe("requestPasswordResetOtp — payload hygiene", () => {
  it("publishes ids only, never the code or the address", async () => {
    await requestPasswordResetOtp(initial, form({ email: EMAIL }));

    const [job] = mocks.publishJob.mock.calls[0];
    expect(job).toEqual({
      type: "PASSWORD_RESET_OTP",
      userId: USER.id,
      otpId: "otp-1",
    });
    // The QStash dashboard retains message bodies, so a live credential in the
    // payload would be readable by anyone with broker access.
    expect(JSON.stringify(job)).not.toContain(EMAIL);
    expect(Object.values(job)).not.toContain(
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it("upserts, so requesting twice replaces the code instead of stacking rows", async () => {
    await requestPasswordResetOtp(initial, form({ email: EMAIL }));

    expect(prisma.passwordResetOtp.upsert).toHaveBeenCalled();
    expect(prisma.passwordResetOtp.create).not.toHaveBeenCalled();
    // The update arm resets the attempt counter: a new code must start fresh,
    // otherwise a user who burned 5 guesses would be locked out of the code
    // they just requested.
    expect(prisma.passwordResetOtp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ attempts: 0 }) }),
    );
  });

  it("sweeps expired rows so the table cannot grow without bound", async () => {
    await requestPasswordResetOtp(initial, form({ email: EMAIL }));

    expect(prisma.passwordResetOtp.deleteMany).toHaveBeenCalled();
  });

  it("fails loudly when AUTH_SECRET is unusable", async () => {
    // A missing secret is a configuration fault. Returning the generic success
    // here would tell a real user their code is on its way when nothing was
    // ever encrypted.
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    try {
      const result = await requestPasswordResetOtp(
        initial,
        form({ email: EMAIL }),
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("unavailable");
      expect(mocks.publishJob).not.toHaveBeenCalled();
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});

describe("requestPasswordResetOtp — dev reveal", () => {
  it("omits the code by default", async () => {
    const result = await requestPasswordResetOtp(initial, form({ email: EMAIL }));

    expect(result.devCode).toBeUndefined();
  });

  it("reveals it when the flag is set outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTP_DEV_REVEAL", "1");

    const result = await requestPasswordResetOtp(initial, form({ email: EMAIL }));

    expect(result.devCode).toMatch(/^\d{6}$/);
  });

  it("never reveals it in production, even with the flag set", async () => {
    // Both conditions are required, so a stray env var in production is inert.
    // Without the NODE_ENV check this would ship a live credential on screen.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OTP_DEV_REVEAL", "1");

    const result = await requestPasswordResetOtp(initial, form({ email: EMAIL }));

    expect(result.devCode).toBeUndefined();
  });

  it("never reveals it for an unknown address", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTP_DEV_REVEAL", "1");
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await requestPasswordResetOtp(
      initial,
      form({ email: "nobody@example.com" }),
    );

    expect(result.devCode).toBeUndefined();
  });
});

describe("resetPassword — brute-force ceiling", () => {
  it("accepts the correct code", async () => {
    const result = await resetPassword(initial, resetForm());

    expect(result.success).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledOnce();
  });

  it("burns an attempt on a wrong code", async () => {
    const result = await resetPassword(initial, resetForm("999999"));

    expect(result.success).toBe(false);
    expect(prisma.passwordResetOtp.update).toHaveBeenCalledWith({
      where: { userId: USER.id },
      data: { attempts: { increment: 1 } },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses every further guess once the ceiling is reached", async () => {
    // The 6th guess must fail even if it is the RIGHT code: a row at the cap is
    // dead and only a fresh request revives it.
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(
      makeOtpRow({ attempts: OTP_MAX_ATTEMPTS }) as never,
    );

    const result = await resetPassword(initial, resetForm(CODE));

    expect(result.success).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("still accepts a correct code one guess below the ceiling", async () => {
    // Proves the ceiling is a bound and not an off-by-one that locks the user
    // out before the real limit.
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(
      makeOtpRow({ attempts: OTP_MAX_ATTEMPTS - 1 }) as never,
    );

    const result = await resetPassword(initial, resetForm(CODE));

    expect(result.success).toBe(true);
  });

  it("does not burn an attempt on a malformed code", async () => {
    // Rejecting on shape first costs the attacker nothing and never reaches the
    // counter, so a 3-character guess is not a free oracle either.
    const result = await resetPassword(initial, resetForm("12"));

    expect(result.success).toBe(false);
    expect(prisma.passwordResetOtp.update).not.toHaveBeenCalled();
  });

  it("tolerates whitespace around the code", async () => {
    const result = await resetPassword(initial, resetForm(" 123456 "));

    expect(result.success).toBe(true);
  });
});

describe("resetPassword — expiry and single use", () => {
  it("refuses an expired code and deletes the row", async () => {
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(
      makeOtpRow({ expiresAt: new Date(Date.now() - 1000) }) as never,
    );

    const result = await resetPassword(initial, resetForm());

    expect(result.success).toBe(false);
    expect(prisma.passwordResetOtp.delete).toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses when no code was ever requested", async () => {
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(null);

    const result = await resetPassword(initial, resetForm());

    expect(result.success).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses a replay of a spent code", async () => {
    await resetPassword(initial, resetForm());
    expect(prisma.passwordResetOtp.delete).toHaveBeenCalledWith({
      where: { userId: USER.id },
    });

    // The row is gone, so the second attempt finds nothing. Deleting on use is
    // the only thing that makes an OTP a one-time code.
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(null);
    const replay = await resetPassword(initial, resetForm());

    expect(replay.success).toBe(false);
  });

  it("deletes the code BEFORE writing the password", async () => {
    const order: string[] = [];
    vi.mocked(prisma.passwordResetOtp.delete).mockImplementation(async () => {
      order.push("delete");
      return {} as never;
    });
    vi.mocked(prisma.user.update).mockImplementation(async () => {
      order.push("update");
      return {} as never;
    });

    await resetPassword(initial, resetForm());

    // The reverse order would leave a live code if the password write failed —
    // a credential outliving the password it was meant to replace.
    expect(order).toEqual(["delete", "update"]);
  });

  it("refuses a code the server cannot decrypt", async () => {
    // A row from before an AUTH_SECRET rotation must fail closed.
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(
      makeOtpRow({ codeEncrypted: "iv:tag:data" }) as never,
    );

    const result = await resetPassword(initial, resetForm());

    expect(result.success).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("resetPassword — password handling", () => {
  it("stores a bcrypt hash, never the plaintext", async () => {
    await resetPassword(initial, resetForm(CODE, "brandnewpass9"));

    const [{ where, data }] = vi.mocked(prisma.user.update).mock.calls[0];
    expect(where).toEqual({ id: USER.id });
    expect(data.password).not.toBe("brandnewpass9");
    // The assertion that matters: the stored value actually verifies.
    await expect(bcrypt.compare("brandnewpass9", data.password)).resolves.toBe(
      true,
    );
  });

  it("rejects a password that does not match its confirmation", async () => {
    const result = await resetPassword(
      initial,
      form({
        email: EMAIL,
        code: CODE,
        password: "newpassword1",
        confirmPassword: "newpassword2",
      }),
    );

    expect(result.success).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("applies the same minimum as registration", async () => {
    const result = await resetPassword(initial, resetForm(CODE, "short"));

    expect(result.success).toBe(false);
    expect(result.message).toContain("at least");
  });

  it("issues NO session, because a stateless JWT cannot be revoked", async () => {
    await resetPassword(initial, resetForm());

    // Claiming otherwise would be dishonest: the old 7-day cookie stays valid
    // until it expires, so the honest behaviour is to require a fresh login.
    expect(mocks.signAuthToken).not.toHaveBeenCalled();
    expect(mocks.setAuthCookie).not.toHaveBeenCalled();
  });
});

describe("resetPassword — no user enumeration", () => {
  it("gives an unregistered address the same refusal as a wrong code", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const unknown = await resetPassword(
      initial,
      form({
        email: "nobody@example.com",
        code: CODE,
        password: "newpassword1",
        confirmPassword: "newpassword1",
      }),
    );

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...USER,
    } as never);
    vi.mocked(prisma.passwordResetOtp.findUnique).mockResolvedValue(null);
    const wrongCode = await resetPassword(initial, resetForm("999999"));

    expect(unknown).toEqual(wrongCode);
  });
});

describe("credential hygiene — the code never reaches Sentry", () => {
  it("does not log the code on the request path", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OTP_DEV_REVEAL", "1");

    const result = await requestPasswordResetOtp(initial, form({ email: EMAIL }));
    const code = result.devCode!;

    const logged = JSON.stringify(mocks.logEvent.mock.calls);
    expect(code).toBeTruthy();
    expect(logged).not.toContain(code);
  });

  it("does not log the code on a rejected reset", async () => {
    await resetPassword(initial, resetForm("999999"));

    const logged = JSON.stringify(mocks.logEvent.mock.calls);
    expect(logged).not.toContain("999999");
    expect(logged).not.toContain(CODE);
  });

  it("does not log the new password", async () => {
    await resetPassword(initial, resetForm(CODE, "supersecret99"));

    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain(
      "supersecret99",
    );
  });
});

describe("registerUser — shares the reset password policy", () => {
  it("applies the same minimum, so the two entry points cannot drift", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await registerUser(
      initial,
      form({ name: "New User", email: "new@example.com", password: "short" }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("at least");
  });

  it("still registers a password that satisfies the policy", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: "user-9" } as never);

    const result = await registerUser(
      initial,
      form({ name: "New User", email: "new@example.com", password: "goodpassword1" }),
    );

    expect(result.success).toBe(true);
  });
});