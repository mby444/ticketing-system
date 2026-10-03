/**
 * Attachment limits, in a module with no dependencies.
 *
 * These used to live in `lib/cloudinary.ts`, which imports the Cloudinary SDK
 * and `@/utils/sentry` (and therefore `@sentry/nextjs`). That made the values
 * unusable from a plain test: importing them cost about 12 seconds because the
 * whole Sentry SDK loaded with them. `prisma/seed-data.ts` also needs the same
 * bounds to stay inside what the app accepts, and it must stay importable from a
 * test that runs in about a second.
 *
 * `lib/cloudinary.ts` re-exports everything here, so every existing import site
 * keeps working unchanged.
 */

/** MIME types accepted for attachments. */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** Max 5 MB per file. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Max attachments per ticket (bounds the request body to ~30MB, see next.config.ts). */
export const MAX_FILES = 5;

/**
 * Max attachments per comment.
 *
 * Deliberately a separate budget from `MAX_FILES` rather than a share of it: a
 * comment lives in its own table (`CommentAttachment`), so a long thread cannot
 * exhaust the ticket's allowance, and a customer replying with a screenshot is
 * never blocked because support already put three files on the ticket. The
 * per-request ceiling is unchanged — 5 files x 5MB still fits the 30MB
 * bodySizeLimit.
 */
export const MAX_COMMENT_FILES = 5;