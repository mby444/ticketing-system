# QuickTicket

**Fast and simple support ticket management.** QuickTicket is a full-stack support ticketing
system where customers file tickets with attachments, support staff triage them on a dashboard,
and both sides converse in a two-way comment thread with email and in-app notifications.

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Security](#security)
- [How to Contribute?](#how-to-contribute)
- [What's Next?](#whats-next)
- [License](#license)
- [Acknowledgements](#acknowledgements)
- [Author](#author)

---

## About

QuickTicket ("Quick Ticket Support") is a support ticket system built for a small support team
and their customers. A customer opens a ticket with a subject, description, priority, and optional
attachments; staff see it on a triage dashboard, change its status, assign it to an agent, and
reply in a comment thread. Every meaningful event (ticket created, status changed, comment
posted, ticket assigned/unassigned) is pushed asynchronously through an email + in-app
notification pipeline so the request never waits on delivery.

The project is a single Next.js app (not a monorepo), uses PostgreSQL via Prisma 7, and ships
with a Vitest suite (431 tests, ~2 s, no database or network).

---

## Features

- **Tickets.** Create with subject, description, a whitelisted priority (`Low`/`Medium`/`High`/
  `Critical`), and up to 5 attachments (≤ 5 MB each; JPG/PNG/WebP/PDF). Priorities and statuses
  are enums, validated server-side against a whitelist — not a truthiness check.
- **Role-based access (RBAC).** `STAFF_ROLES = [SUPPORT_AGENT, ADMIN]`. Staff see and act on
  every ticket; a `CLIENT` only ever sees their own, and a foreign ticket id returns `404` (not
  `403`) so existence is not leaked.
- **Attachments.** All-or-nothing per operation: validate every file → upload every file → one
  transaction writing the parent row and the attachment rows. Any failure destroys already-
  uploaded Cloudinary assets. Hard delete removes the row first, then the asset. PDFs upload as
  `resource_type: "raw"` (download link only); images get a 240×240 `c_fill` thumbnail served
  through `/_next/image`.
- **Comments.** Flat chronological thread. Body is always mandatory (the email template renders
  it). A staff reply to an `Open` ticket flips it to `In_Progress` in the same transaction (a
  client can never bump their own ticket); new comments on a `Closed` ticket are rejected for
  every role. Deletion is soft (`deletedAt` + `deletedById`) so a two-way thread never shows a
  hole where a support reply used to be. Comment attachments live in their own table with their
  own budget (`MAX_COMMENT_FILES`), independent of the ticket's `MAX_FILES`.
- **Staff dashboard.** One `getAllTickets()` query partitioned into "Assigned to me" and "Other
  tickets". Triage filters (`?filter=all|unassigned|mine|open`) and column sorting (`?sort=`,
  ten options over five columns) are plain `<Link>`s driven by URL params — bookmarkable,
  JS-free, with `aria-sort` on the active column.
- **In-app notifications.** Bell + unread badge in the navbar, newest-20 panel grouped by day,
  plus `/notifications` for full history, with mark-read and mark-all-read.
- **Email pipeline.** Async, fire-and-forget: ticket created, status updated, new comment,
  ticket assigned/unassigned. Templates: ticket created, status updated, new comment, ticket
  assigned.
- **Password reset.** Two-step OTP flow (`/forgot-password`): request a code by email, then
  enter code + new password. Encrypted (AES-256-GCM) code, 5 attempts, 10-minute TTL, single
  use; no user enumeration.
- **Uploader traceability.** Every attachment records `uploadedById`; a staff upload onto a
  client-owned ticket is badged `SUPPORT STAFF` in the UI.
- **Author-or-staff delete.** Attachments and comments can be deleted by their author or by
  staff — never by "the ticket owner" alone.

---

## Tech Stack

| Layer     | Choice                                                            |
| --------- | ----------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19                                 |
| Language  | TypeScript 5                                                      |
| Styling   | Tailwind CSS 4                                                    |
| Database  | PostgreSQL via Prisma 7 (`pg` driver adapter; no ORM-managed URL) |
| Auth      | `jose` JWT in an `auth-token` cookie, `bcryptjs` password hashing |
| Files     | Cloudinary (signed server-side upload, thumbnails, destroy)       |
| Email     | Resend + `@react-email/components` templates                      |
| Queue     | Upstash QStash (`@upstash/qstash` v2)                             |
| Errors    | Sentry (`@sentry/nextjs`), wrapped in `utils/sentry.ts`           |
| Tests     | Vitest 5                                                          |
| Hosting   | Vercel-style `next build`; Sentry tunnel route `/monitoring`      |

---

## Architecture

A single Next.js App Router app. Server components call server actions directly; there is no
separate API for the UI (the only HTTP endpoints are the QStash worker routes and the Sentry
tunnel).

```
Browser
  │
  ▼
Next.js App Router (server components + server actions in actions/*.ts)
  │
  ├── Prisma 7 ──► PostgreSQL   (pg driver adapter)
  ├── Cloudinary                (signed server-side upload / destroy / thumbnails)
  │
  └── publishJob / publishNotificationJob  (lib/qstash.ts)  ──►  Upstash QStash
                                                                  │
                                                                  ▼
                                                    HMAC-signed POST ──► ${APP_URL}/api/jobs/send-email
                                                                         ${APP_URL}/api/jobs/create-notification
                                                                  │
                                                                  ▼
                                                    lib/email.ts  → React Email template → Resend
                                                    worker       → Notification rows (skipDuplicates)
```

Key design points:

- **No PII in the broker.** `EmailJob`/`NotificationJob` payloads carry ids (`ticketId`,
  `commentId`, `assigneeId`); the worker re-reads recipients from the database.
- **A QStash outage must never fail a ticket action.** Every publish failure is logged (Sentry)
  and swallowed inside `lib/qstash.ts`.
- **One job per recipient**, so a retry after a partial success cannot re-deliver the first
  email.
- **Status contract with QStash:** `200` = done or permanent no-op (logged, not retried);
  `401` = bad signature; `500` = transient, retried 5× with exponential backoff.
- **Retry safety** is enforced in the database (`skipDuplicates` + a unique index on
  `(userId, type, ticketId, dedupeKey)`), not only by QStash-level dedup.
- **Pure, dependency-free modules** (`lib/roles.ts`, `lib/notifications.ts`,
  `lib/dashboard-filters.ts`, `lib/dashboard-sort.ts`, `lib/otp.ts`, `lib/password.ts`, …) hold
  the security-relevant decision logic so it is unit-testable without a database or request
  context. `lib/cloudinary.ts` and `@/generated/prisma/client` (as a value) are deliberately
  never imported from client components.

---

## Project Structure

```
app/                     routes
  (auth)/login|register  auth pages (client forms + server actions)
  (auth)/forgot-password two-step OTP reset
  tickets/               list, new, [id] detail (thread, attachments, assign)
  dashboard/             staff-only triage view
  notifications/         full in-app notification history
  api/jobs/              QStash worker endpoints (send-email, create-notification)
actions/                 every server action ("use server")
  ticket.actions.ts      13 actions — the app's entire data API
  auth.actions.ts        register / login / logout / requestPasswordResetOtp / resetPassword
  notification.actions.ts bell panel data + read mutations
lib/                     domain logic (pure modules + cloudinary + prisma singleton)
components/              shared UI (Navbar, bell, tables, selects, delete button…)
emails/                  React Email templates + shared layout
utils/                   ui.ts (status/priority classes), string-format.ts, sentry.ts
prisma/                  schema, migrations, seed (data planner + file generators + writer)
test-utils/              prisma-mock, factories, cloudinary stub, safety-rail test
generated/prisma/        generated client — gitignored (import as @/generated/prisma/client)
```

Path alias: `@/*` → repo root. See `PROJECT_SUMMARY.md` for the full data model and the
deliberate `onDelete` semantics.

---

## Getting Started

**Prerequisites:** Node.js 24+, PostgreSQL, and (for attachments/seed) Cloudinary credentials.

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
npm install

# 2. Configure environment (see Configuration)
#    create a .env from the table below

# 3. Apply migrations + generate client
npx prisma migrate deploy
npx prisma generate

# 4. (optional) seed the database — destructive, ~100 s (mostly Cloudinary uploads)
#    db_fresh.bat  (= migrate reset + seed + generate)
npx prisma db seed

# 5. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Verification chain (all must be green before a change is "done"):**

```bash
npm run lint
npm run test
npx tsc --noEmit
npm run build
```

> After `prisma generate`, **restart `next dev`**. Turbopack does not pick up the regenerated
> client in `generated/prisma`; a stale client makes `getCurrentUser()` throw inside a swallowed
> catch, and every page 307s to `/login` despite a valid cookie.

---

## Configuration

`.env` is gitignored but must be present locally.

| Variable                                                                                           | Purpose                                                                                                               |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                     | Postgres connection string (Prisma 7 config: `prisma7.config.ts`)                                                     |
| `AUTH_SECRET`                                                                                      | signs the `jose` JWT                                                                                                  |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET`                                               | ticket + comment attachments                                                                                          |
| `QSTASH_URL` / `_TOKEN` / `_CURRENT_SIGNING_KEY` / `_NEXT_SIGNING_KEY`                             | worker queue + HMAC verification (both keys, so rotation is safe)                                                     |
| `RESEND_API_KEY` / `EMAIL_FROM` / `APP_URL`                                                        | email delivery; `APP_URL` must be reachable by QStash (use an ngrok tunnel while testing locally)                     |
| `OTP_DEV_REVEAL`                                                                                   | dev-only OTP echo on screen (`1` + `NODE_ENV !== production`); Resend testing mode only delivers to the account owner |
| `SEED_USERS` / `SEED_TICKETS_PER_USER` / `SEED_STAFF` / `SEED_RANDOM_SEED` / `SEED_NO_ATTACHMENTS` | optional seed tuning                                                                                                  |

Sentry's DSN is hardcoded in `sentry.*.config.ts`. Resend's `onboarding@resend.dev` only delivers
to the Resend account owner's address — a verified domain is required for real use. QStash
publishes to `${APP_URL}/api/jobs/send-email`, so `APP_URL` must be a tunnel (e.g. ngrok) when
testing locally.

---

## Security

- **Server-side authorization on every action.** Every server action re-derives the session and
  re-checks role/ownership; nothing trusts what the client rendered. A `CLIENT` opening a foreign
  ticket gets `404`, not `403`.
- **No PII in the message broker.** Queue payloads carry ids only; recipients are re-read from
  the database in the worker.
- **Password policy shared by both entry points** (`lib/password.ts`): min 8, max 72 bytes
  (bcrypt truncates at 72 bytes). Used by `registerUser` and `resetPassword`.
- **OTP brute-force defence lives on the row:** 5 attempts + 10-minute TTL + single use, with
  attempts incremented only on a wrong-but-well-formed code. No throttle on _requesting_ a code
  (known gap — see What's Next).
- **No user enumeration** on password reset: identical message whether or not the address exists,
  a dummy `bcrypt.compare` on the not-found path, and the reset form carries the typed email
  rather than a server-returned `userId`.
- **Attachment trust boundary:** server-side MIME + size + count checks plus Cloudinary; no
  virus/content scanning (known gap).
- **Audit-preserving deletes:** `uploadedById` has no `onDelete` (`RESTRICT`) so deleting a user
  who once attached a file is blocked rather than silently erasing it; `deletedById` is `SetNull`.
- **Safety rail in tests:** `vitest.setup.ts` overrides `DATABASE_URL` to a dead socket, so a
  test that forgets to mock Prisma fails instantly instead of touching the live database.

---

## How to Contribute?

1. Fork the repo and create a feature branch.
2. Install deps: `npm install`.
3. Copy `.env` values per the Configuration table; run migrations + (optionally) seed.
4. Make your change. Keep changes consistent with the surrounding structure, naming, and
   patterns; treat unfamiliar files as potential user work and investigate before deleting.
5. Run the full verification chain: `lint` → `test` → `tsc --noEmit` → `build`. All four must
   pass.
6. If you touched the schema, add a migration (`npx prisma migrate dev --name <name>`) and
   verify drift with
   `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.
7. Open a pull request with a clear description and the verification output.

Notes for contributors:

- `lib/cloudinary.ts` and `@/generated/prisma/client` (as a value) must never be imported from
  a client component.
- `deleteMany()` without a `where` clause is forbidden outside `prisma/seed.ts`.
- After `prisma generate`, restart `next dev`.

---

## What's Next?

Known gaps, scoped out deliberately (not regressions). Full rationale lives in `AGENTS.md`.

- **Dashboard:** no text search, no pagination, no bulk actions; priority is not editable
  post-creation (the most visible remaining triage gap).
- **RBAC:** no in-app role management; non-staff hitting `/dashboard` are silently redirected
  rather than shown a 403; no audit trail for status/assignment changes.
- **Comments:** flat thread (no nesting), no editing, no pagination, no rate limiting.
- **Attachments:** no PDF preview, no replace-after-upload, no counts on list pages, no scanning.
- **Notifications:** server-rendered count refreshed on mutation — no polling, so a badge can go
  stale.
- **Auth:** no throttle on _requesting_ a reset code; existing sessions are not revoked by a
  reset (stateless JWT, no session table); no in-app role management.
- **Ops:** no CI running the test suite; `getTicketById` swallows errors as `404`, so a failing
  sub-query takes down the whole detail page.

---

## License

No license has been specified for this project yet. All rights reserved by the author.

---

## Acknowledgements

- [Next.js](https://nextjs.org) — App Router framework.
- [Prisma](https://www.prisma.io) — ORM and migrations (Prisma 7 driver adapter).
- [Tailwind CSS](https://tailwindcss.com) — styling.
- [Cloudinary](https://cloudinary.com) — file storage and thumbnails.
- [Upstash QStash](https://upstash.com/docs/qstash) — async job queue.
- [Resend](https://resend.com) — transactional email.
- [React Email](https://react.email) — email templates.
- [Sentry](https://sentry.io) — error tracking.
- [Vitest](https://vitest.dev) — testing.
- [jose](https://github.com/panva/jose) / [bcryptjs](https://github.com/dcodeIO/bcrypt.js) — auth.

---

## Author

**mby444**
