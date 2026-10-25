/**
 * Password rules, in a pure module so register and password-reset cannot drift
 * apart.
 *
 * The 72-byte maximum is not arbitrary: bcrypt silently truncates its input at
 * 72 bytes, so anything past that is ignored. Accepting a longer password and
 * hashing it creates the false impression that the extra characters are
 * protecting the account when they contribute nothing.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;

/** Returns an error message, or null when the password is acceptable. */
export const validatePassword = (password: string): string | null => {
  if (!password) return "Password is required";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  // Count bytes, not characters: bcrypt truncates bytes, so a short multibyte
  // password can exceed the limit at a far lower character count.
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} bytes`;
  }
  return null;
};

/** True when two entries match. Used to require confirmation on both forms. */
export const passwordsMatch = (a: string, b: string): boolean => a === b;