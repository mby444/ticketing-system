"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { logEvent } from "@/utils/sentry";
import { signAuthToken, setAuthCookie, removeAuthCookie } from "@/lib/auth";
import { publishJob } from "@/lib/qstash";
import {
  decryptOtp,
  encryptOtp,
  generateOtpCode,
  isOtpCode,
  otpMatches,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
} from "@/lib/otp";
import { passwordsMatch, validatePassword } from "@/lib/password";

type ResponseResult = {
  success: boolean;
  message: string;
  /** Dev-only echo of the OTP; never set outside the gated reveal below. */
  devCode?: string;
};

/**
 * ONE message for every outcome of a reset request, whether or not the address
 * exists. Anything else turns this endpoint into a free account-enumeration
 * oracle: "no such user" vs "we emailed you" tells an attacker which addresses
 * are registered.
 */
const RESET_REQUESTED_MESSAGE =
  "If an account exists for that address, we sent a 6-digit code to it.";

/** The same generic failure for every rejected code, for the same reason. */
const RESET_FAILED_MESSAGE = "That code is invalid or has expired. Request a new one.";

/**
 * A real bcrypt hash of a value nobody knows, used to spend the same CPU on the
 * "user does not exist" branch that the "user exists" branch spends on a real
 * compare. Without it the response time alone discloses which addresses are
 * registered, even though the message is identical.
 */
const DECOY_PASSWORD_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/**
 * Only reveal the code on screen in development, and only when explicitly
 * asked. Resend's testing mode refuses to deliver to anyone but the account
 * owner, so without this the flow cannot be clicked through locally. Both
 * conditions are required, so a stray env var in production is inert.
 */
const shouldRevealOtp = (): boolean =>
  process.env.NODE_ENV !== "production" && process.env.OTP_DEV_REVEAL === "1";

/** Removes codes that can no longer be used, so the table cannot grow forever. */
const sweepExpiredOtps = async () => {
  await prisma.passwordResetOtp.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
};

// Register new user
export async function registerUser(
  prevState: ResponseResult,
  formData: FormData,
): Promise<ResponseResult> {
  try {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    if (!name || !email || !password) {
      logEvent(
        "Validation error: Missing register fields",
        "auth",
        { name, email },
        "warning",
      );

      return { success: false, message: "All fields are required" };
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      logEvent(
        `Registration failed: User already exists - ${email}`,
        "auth",
        { email },
        "warning",
      );

      return { success: false, message: "User already exists" };
    }

    // Validated here as well as on reset, so the two entry points cannot
    // drift apart on how strong a password has to be.
    const passwordError = validatePassword(password);
    if (passwordError) {
      return { success: false, message: passwordError };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    // Sign and set auth token
    const token = await signAuthToken({ userId: user.id });
    await setAuthCookie(token);

    logEvent(
      `User registered succcessfully: ${email}`,
      "auth",
      { userId: user.id, email },
      "info",
    );

    return { success: true, message: "Registration" };
  } catch (error) {
    logEvent(
      "Unexpected error during registration",
      "auth",
      {},
      "error",
      error,
    );
    return {
      success: false,
      message: "Something went wrong, please try again",
    };
  }
}

// Log user out and remove auth cookie
export async function logoutUser(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await removeAuthCookie();

    logEvent("User logged out successfully", "auth", {}, "info");

    return { success: true, message: "Logout Successful" };
  } catch (error) {
    logEvent("Unexpected error during logout", "auth", {}, "error", error);

    return { success: false, message: "Logout failed. Please try again" };
  }
}

// Log user in
export async function loginUser(
  prevState: ResponseResult,
  formData: FormData,
): Promise<ResponseResult> {
  try {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    if (!email || !password) {
      logEvent(
        "Validation error: Missing login fields",
        "auth",
        { email },
        "warning",
      );
      return { success: false, message: "Email and password are required" };
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      logEvent(
        `Login Failed: User not found - ${email}`,
        "auth",
        { email },
        "warning",
      );

      return { success: false, message: "Invalid email or password" };
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      logEvent(
        "Login Failed: Incorrect password",
        "auth",
        { email },
        "warning",
      );

      return { success: false, message: "Invalid email or password" };
    }

    const token = await signAuthToken({ userId: user.id });
    await setAuthCookie(token);

    return { success: true, message: "Login successful" };
  } catch (error) {
    logEvent("Unexpected error during login", "auth", {}, "error", error);

    return { success: false, message: "Error during log in" };
  }
}

/**
 * Starts a password reset: issues a 6-digit code and queues the email.
 *
 * Returns the SAME success state whether or not the address is registered —
 * see RESET_REQUESTED_MESSAGE. The unknown-user branch still spends a bcrypt
 * compare so the two paths take comparable time.
 */
export async function requestPasswordResetOtp(
  prevState: ResponseResult,
  formData: FormData,
): Promise<ResponseResult> {
  try {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return { success: false, message: "Enter a valid email address" };
    }

    await sweepExpiredOtps();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      // Constant-ish time: without this compare the response is measurably
      // faster for an unknown address, which enumerates accounts just as
      // effectively as a different error message would.
      await bcrypt.compare("not-a-real-password", DECOY_PASSWORD_HASH);

      logEvent(
        "Password reset requested for an unknown address",
        "auth",
        {},
        "warning",
      );
      return { success: true, message: RESET_REQUESTED_MESSAGE };
    }

    const code = generateOtpCode();
    const codeEncrypted = encryptOtp(code);

    if (!codeEncrypted) {
      // AUTH_SECRET missing or too short. This is a configuration fault, not a
      // user error, and it must be loud rather than silently skipping the mail.
      logEvent(
        "Password reset could not encrypt a code (AUTH_SECRET missing?)",
        "auth",
        { userId: user.id },
        "error",
      );
      return {
        success: false,
        message: "Password reset is unavailable right now. Try again later.",
      };
    }

    // upsert, not create: the unique index on userId means requesting a new
    // code REPLACES any outstanding one, so an old code cannot be used after a
    // resend.
    const otp = await prisma.passwordResetOtp.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        codeEncrypted,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      update: {
        codeEncrypted,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        attempts: 0,
      },
      select: { id: true },
    });

    // Only the two ids travel. The code stays in the row and is decrypted by
    // the worker, so no live credential is ever written into the broker.
    await publishJob({
      type: "PASSWORD_RESET_OTP",
      userId: user.id,
      otpId: otp.id,
    });

    logEvent(
      "Password reset code issued",
      "auth",
      { userId: user.id, otpId: otp.id },
      "info",
    );

    return {
      success: true,
      message: RESET_REQUESTED_MESSAGE,
      ...(shouldRevealOtp() ? { devCode: code } : {}),
    };
  } catch (error) {
    logEvent(
      "Unexpected error requesting a password reset",
      "auth",
      {},
      "error",
      error,
    );
    return { success: false, message: "Could not start the reset. Try again." };
  }
}

/**
 * Completes a password reset: verifies the code and sets a new password.
 *
 * Bounded by `attempts` on the row, which is the brute-force ceiling — a 6-digit
 * code is only ~1M values, so an unlimited guess endpoint is a takeover. Every
 * rejection returns one identical message and consumes an attempt; exhausting
 * them deletes the row, forcing a new request.
 *
 * On success the row is deleted BEFORE the password is written. The reverse
 * order would leave a usable code if the update failed, and a code that outlives
 * the password it was meant to replace is exactly the window an attacker wants.
 *
 * No session is issued: the auth cookie is a stateless 7-day JWT with no server
 * -side session table, so there is nothing here to revoke. The user signs in
 * again, and that is an honest description of what changed rather than a claim
 * that old sessions were killed.
 */
export async function resetPassword(
  prevState: ResponseResult,
  formData: FormData,
): Promise<ResponseResult> {
  try {
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const code = String(formData.get("code") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    if (!email || !isOtpCode(code)) {
      return { success: false, message: RESET_FAILED_MESSAGE };
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return { success: false, message: passwordError };
    }

    if (!passwordsMatch(password, confirm)) {
      return { success: false, message: "Passwords do not match" };
    }

    // The form carries the EMAIL the visitor typed, not a userId handed back
    // by the request step. Returning the id there would confirm that an account
    // exists — the exact thing RESET_REQUESTED_MESSAGE exists to withhold.
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      // Spend a compare so an unregistered address is not distinguishable by
      // response time either.
      await bcrypt.compare("not-a-real-password", DECOY_PASSWORD_HASH);
      return { success: false, message: RESET_FAILED_MESSAGE };
    }

    const userId = user.id;

    const otp = await prisma.passwordResetOtp.findUnique({ where: { userId } });

    if (!otp) {
      logEvent(
        "Password reset rejected: no outstanding code",
        "auth",
        { userId },
        "warning",
      );
      return { success: false, message: RESET_FAILED_MESSAGE };
    }

    if (otp.expiresAt.getTime() < Date.now()) {
      // Dead code, and the row is now worthless: remove it rather than leaving
      // a row that only fails.
      await prisma.passwordResetOtp.delete({ where: { userId } });
      logEvent("Password reset rejected: code expired", "auth", { userId }, "info");
      return { success: false, message: RESET_FAILED_MESSAGE };
    }

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await prisma.passwordResetOtp.delete({ where: { userId } });
      logEvent(
        "Password reset rejected: attempt limit reached",
        "auth",
        { userId, attempts: otp.attempts },
        "warning",
      );
      return { success: false, message: RESET_FAILED_MESSAGE };
    }

    const expected = decryptOtp(otp.codeEncrypted);
    if (!expected || !otpMatches(code, expected)) {
      // Burn one attempt. This increment is the entire brute-force bound.
      await prisma.passwordResetOtp.update({
        where: { userId },
        data: { attempts: { increment: 1 } },
      });
      logEvent(
        "Password reset rejected: wrong code",
        "auth",
        { userId, attempts: otp.attempts + 1 },
        "warning",
      );
      return { success: false, message: RESET_FAILED_MESSAGE };
    }

    // Row first: a live code surviving a failed password write is the worst
    // outcome available here.
    await prisma.passwordResetOtp.delete({ where: { userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(password, 10) },
    });

    // Metadata only — never the code, exactly as a comment body never reaches
    // Sentry.
    logEvent("Password reset completed", "auth", { userId }, "info");

    return {
      success: true,
      message: "Your password has been reset. Sign in with your new password.",
    };
  } catch (error) {
    logEvent(
      "Unexpected error resetting a password",
      "auth",
      {},
      "error",
      error,
    );
    return { success: false, message: "Could not reset your password." };
  }
}
