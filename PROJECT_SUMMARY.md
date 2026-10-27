# QuickTicket — Project Summary

A support ticket system ("QuickTicket"): customers file tickets with attachments, staff triage
them on a dashboard, and both sides converse in a two-way comment thread with email and in-app
notifications.

> This file is a **human-readable overview**. `AGENTS.md` remains canonical for agent-facing
> rules, verified-state history and every hard-won gotcha. Where the two disagree, `AGENTS.md`
> wins.

---

## 1. Stack

| Layer     | Choice                                                            |
| --------- | ----------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19                                 |
| Language  | TypeScript 5                                                      |
| Styling   | Tailwind CSS 4                                                    |
| Database  | PostgreSQL via Prisma 7 (`pg` driver adapter, no ORM-managed URL) |
| Auth      | `jose` JWT in an `auth-token` cookie, `bcryptjs` password hashing |
| Files     | Cloudinary (signed server-side upload, thumbnails, destroy)       |
| Email     | Resend + `@react-email/components` templates                      |
| Queue     | Upstash QStash (`@upstash/qstash` v2)                             |
| Errors    | Sentry (`@sentry/nextjs`), wrapped in `utils/sentry.ts`           |
| Tests     | Vitest 5                                                          |
| Hosting   | Vercel-style `next build`; Sentry tunnel route `/monitoring`      |

Not a monorepo. No CI, no pre-commit hooks, no test coverage tooling.

---

## 2. Commands

> On Windows/PowerShell the execution policy blocks `npm.ps1`/`npx.ps1` — **use `npm.cmd` / `npx.cmd`**
> or the command fails immediately.

| Purpose                  | Command                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| Dev server               | `npm.cmd run dev`                                                       |
| Lint                     | `npm.cmd run lint`                                                      |
| Test                     | `npm.cmd run test` (`vitest run`) · `npm.cmd run test:watch`            |
| Typecheck                | `npx.cmd tsc --noEmit` (no script exists)                               |
| Build                    | `npm.cmd run build`                                                     |
| Regenerate Prisma client | `npx.cmd prisma generate` (also runs on `postinstall`)                  |
| New migration            | `npx.cmd prisma migrate dev --name <name>`                              |
| Full DB reset + seed     | `db_fresh.bat` — **destructive**, ~100 s (mostly Cloudinary uploads)    |
| One-off script           | `npx.cmd tsx <file>` (`tsx` is not installed locally; npx downloads it) |

**Verification chain: `lint` → `test` → `tsc --noEmit` → `build`.** All four must pass before a
change is considered done.

**Current baseline (2026-10-25):** all four green. Tests: **431 across 20 files** in ~2 s.
Working tree clean at `da94165` plus the uncommitted password-reset work.

> After `prisma generate`, **restart `next dev`**. Turbopack does not pick up the regenerated
> client in `generated/prisma`; a stale client makes `getCurrentUser()` throw inside a catch that
> swallows it, and every page 307s to `/login` despite a valid cookie.

---

## 3. Layout

```
app/                     routes
  (auth)/login|register  auth pages (client forms + server actions)
  (auth)/forgot-password two-step OTP reset (request code, then code + new password)
  tickets/               list, new, [id] detail (thread, attachments, assign)
  dashboard/             staff-only triage view
  notifications/         full in-app notification history
  api/jobs/              QStash worker endpoints (send-email, create-notification)
actions/                 every server action ("use server")
  ticket.actions.ts      13 actions — the app's entire data API
  auth.actions.ts        register / login / logout / requestPasswordResetOtp / resetPassword
  notification.actions.ts bell panel data + read mutations
lib/                     domain logic (see §5)
components/              shared UI (Navbar, bell, tables, selects, delete button…)
emails/                  React Email templates + shared layout
utils/                   ui.ts (status/priority classes), string-format.ts, sentry.ts
prisma/                  schema, migrations, seed (data planner + file generators + writer)
test-utils/              prisma-mock, factories, cloudinary stub, safety-rail test
generated/prisma/        generated client — gitignored, import as @/generated/prisma/client
```

Path alias `@/*` → repo root.

### Routes and access control

| Route                 | Guard                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| `/`                   | public landing page                                                        |
| `/login`, `/register` | public                                                                     |
| `/tickets`            | `requireUser()` — own tickets only for CLIENT                              |
| `/tickets/new`        | `requireUser()`                                                            |
| `/tickets/[id]`       | `requireUser()` + server-side ownership; foreign ticket → `404` for CLIENT |
| `/dashboard`          | `requireRole(SUPPORT_AGENT, ADMIN)`; CLIENT → redirect `/tickets`          |
| `/notifications`      | `requireUser()`                                                            |
| `/api/jobs/*`         | HMAC signature verification (QStash), not session auth                     |
| `/monitoring`         | Sentry tunnel                                                              |

---

## 4. Data model

`User → Ticket → TicketComment → CommentAttachment`, with `TicketAttachment` and `Notification`
attached to the ticket.

```
User ──< Ticket (owner)            userId        no onDelete
     ──< Ticket (assignee)         assigneeId    no onDelete
     ──< TicketComment             author       Cascade
     ──< TicketComment             deletedBy    SetNull
     ──< TicketAttachment          uploadedBy   RESTRICT (audit data)
     ──< CommentAttachment         uploadedBy   RESTRICT (audit data)
     ──< Notification              user         Cascade
     ──< PasswordResetOtp          user         Cascade (one active row per user, unique on userId)
```

Enums: `Role` (CLIENT / ADMIN / SUPPORT_AGENT), `TicketStatus` (Open / In_Progress / Resolved /
Closed), `TicketPriority` (Low / Medium / High / Critical), `NotificationType` (5 values).
`PasswordResetOtp` stores an **encrypted** code (AES-256-GCM, key from `AUTH_SECRET` via HKDF) —
not a hash — because the worker must _recover_ it to render the email. One row per user
(unique on `userId`), upserted on request, deleted on success/expiry/exhaustion.

**The delete semantics are deliberate and load-bearing — do not "simplify" them:**

- Attachments and comments **cascade** with the ticket: destroy the ticket, lose the subtree.
- `uploadedById` has **no** `onDelete`. Prisma's default for a required relation is
  `ON DELETE RESTRICT`, and that is the point — the uploader is audit data, so deleting a user who
  once attached a file is _blocked_ rather than silently erasing it from a ticket they may not own.
- `deletedById` is **SetNull**: removing the moderator must not erase the record of the removal.
- `CommentAttachment` rows survive a comment's **soft** delete (the thread is frozen, not erased),
  which is exactly why `deleteCommentAttachment` refuses to touch them.

`Notification` carries a unique index on `(userId, type, ticketId, dedupeKey)`. That index — not
QStash-level dedup — is what makes a worker retry a no-op instead of a duplicate row.

`TicketComment.id` is an `Int @autoincrement()` on purpose, not a cuid: the QStash `NEW_COMMENT`
payload contract is `commentId: number`.

---

## 5. Where the logic lives

### Pure, dependency-free modules (unit tested directly)

These exist because the decision-making inside them is _security-relevant_; extracting it is what
makes it testable without a database or a request context.

| Module                            | Responsibility                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/roles.ts`                    | `STAFF_ROLES`, `isStaff` — no `next/*` imports, so the QStash worker can use it without pulling `next/headers` into the route bundle |
| `lib/authorization.ts`            | `requireUser`, `requireRole`, `canAccessTicket` (re-exports `lib/roles.ts`)                                                          |
| `lib/notifications.ts`            | in-app recipient matrix + copy + dedupe keys                                                                                         |
| `lib/email.ts`                    | email recipient resolution + Resend dispatch (worker side)                                                                           |
| `lib/assignment-notifications.ts` | which assignment events produce jobs (no-op guard lives here)                                                                        |
| `lib/delete-permissions.ts`       | `canDeleteUserContent` — author **or** staff, never "the ticket owner"                                                               |
| `lib/dashboard-filters.ts`        | `?filter=` whitelist + match/count (unassigned / mine / open)                                                                        |
| `lib/dashboard-sort.ts`           | `?sort=` whitelist + comparator, total order, non-mutating                                                                           |
| `lib/priority.ts`                 | `PRIORITY_OPTIONS` — hand-written, `satisfies readonly TicketPriority[]`                                                             |
| `lib/attachment-limits.ts`        | MIME/size/count limits, importable without pulling the Cloudinary SDK                                                                |
| `lib/otp.ts`                      | OTP generation, AES-256-GCM encrypt/decrypt, constant-time compare (pure, `node:crypto` only)                                        |
| `lib/password.ts`                 | shared password policy (min 8, max 72 bytes) used by register and reset                                                              |

### The two "never import me from a client component" modules

- **`lib/cloudinary.ts`** pulls the Cloudinary SDK (and, via `utils/sentry.ts`, `@sentry/nextjs`).
  Client forms duplicate the small limit constants instead. It re-exports everything from
  `lib/attachment-limits.ts` so server-side import sites have a single source.
- **`@/generated/prisma/client`** as a _value_ (e.g. `Object.values(TicketPriority)`) would pull
  the Prisma runtime into the browser bundle. Hence the hand-written `PRIORITY_OPTIONS`, which
  `lib/priority.test.ts` asserts equals the enum exactly so the duplication cannot drift.

### Server actions (`actions/ticket.actions.ts`)

`createTicket`, `getTickets`, `getTicketById`, `getAllTickets`, `listAgents`, `updateTicketStatus`,
`assignTicket`, `closeTicket`, `addAttachments`, `deleteAttachment`, `addTicketComment`,
`deleteComment`, `deleteCommentAttachment`.

Every one re-derives the session and re-checks role/ownership server-side. Nothing trusts what the
client rendered. Mutations call `revalidatePath` for each affected view — the list of paths is not
optional, and forgetting one is a visible bug (assigning from the detail page originally saved but
did not re-render until a manual refresh).

---

## 6. The async notification pipeline

Two parallel flows, both **fire-and-forget** from the request's point of view.

```
server action
   └─ publishJob / publishNotificationJob   ← awaits only the enqueue; failures swallowed + Sentry-logged
        └─ QStash → HMAC-signed POST → ${APP_URL}/api/jobs/send-email
                                       └─> ${APP_URL}/api/jobs/create-notification
             ├─ lib/email.ts  re-reads fresh data → React Email template → Resend
             └─ worker       inserts Notification rows with skipDuplicates
```

Design points worth preserving:

- **No PII in the broker.** `EmailJob` payloads carry ids (`ticketId`, `commentId`, `assigneeId`);
  the worker re-reads recipients from the database.
- **A QStash outage must never fail a ticket action** — every publish failure is logged and
  swallowed inside `lib/qstash.ts`.
- **One job per recipient**, not one job with two emails: a single job mailing two people
  re-delivers the first email whenever a retry lands after it succeeded.
- **Status contract:** `200` = done _or_ a permanent no-op (unknown type, deleted ticket,
  malformed-but-authentic body — logged, deliberately not retried); `401` = bad signature;
  `500` = transient, retried 5× with exponential backoff.
- **Retry safety** is enforced in the database (`skipDuplicates` + the unique index), not only by
  QStash `deduplicationId`, so there is one retention window to reason about.

### Email vs in-app recipients — intentionally different

This divergence is the design, not a bug. `lib/notifications.ts` documents it as a table; read it
before "fixing" an inconsistency.

| Event                  | Email                     | In-app                               | Why                                                                                                                           |
| ---------------------- | ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `TICKET_CREATED`       | owner (a receipt)         | **all staff**                        | staff triage new work; the filer knows                                                                                        |
| `STATUS_UPDATED`       | owner                     | owner **+ assignee**                 | the assignee is working it                                                                                                    |
| `NEW_COMMENT` (staff)  | owner                     | owner                                | same                                                                                                                          |
| `NEW_COMMENT` (client) | assignee, else **nobody** | assignee, else **all staff**         | an unassigned ticket has no address to mail, but an in-app row needs none — this is where email backlog #2 stops being a hole |
| `TICKET_ASSIGNED`      | assignee                  | assignee, unless they own the ticket | never ping someone about their own ticket                                                                                     |
| `TICKET_UNASSIGNED`    | previous assignee         | previous assignee                    |                                                                                                                               |

Invariants: the **actor is never notified**; a **soft-deleted comment notifies nobody** (the
message is retracted, so announcing it would be untrue).

---

## 7. Features

**Tickets.** Create with subject, description, whitelisted priority, and up to 5 attachments
(≤5 MB each; JPG/PNG/WebP/PDF). Priority and status are enums, validated server-side against a
whitelist — not a truthiness check.

**RBAC.** `STAFF_ROLES = [SUPPORT_AGENT, ADMIN]`. Staff see and act on every ticket; a CLIENT only
ever their own (enforced in the action, and a foreign id yields `404`, not `403`).

**Attachments.** All-or-nothing per operation: validate every file → upload every file → one
transaction writing the parent row and the attachment rows. Any failure destroys already-uploaded
Cloudinary assets. Hard delete removes the **row first**, then the asset, so a failed asset destroy
leaves only an invisible orphan rather than a broken thumbnail. PDFs upload as `resource_type:
"raw"` (download link only); images get a 240×240 `c_fill` thumbnail served through
`/_next/image`.

**Comments.** Flat chronological thread. Body is **always** mandatory — the email template renders
it, so an attachment-only comment would mail a blank quote block. A **staff** reply to an `Open`
ticket flips it to `In_Progress` in the same transaction (a client can never bump their own
ticket); new comments on a `Closed` ticket are rejected for every role. Deletion is **soft**
(`deletedAt` + `deletedById`): the row survives so a two-way thread never shows a hole where a
support reply used to be, and the body is withheld once deleted. Comment attachments live in their
own table with their own budget (`MAX_COMMENT_FILES`, independent of the ticket's `MAX_FILES`) and
are frozen when the comment is soft-deleted.

**Staff dashboard.** One `getAllTickets()` query partitioned into "Assigned to me" and "Other
tickets". Triage filters (`?filter=all|unassigned|mine|open`) and column sorting (`?sort=`, ten
options over five columns) are plain `<Link>`s driven by URL params — bookmarkable, JS-free, with
`aria-sort` on the active column. Filtering and sorting are pure functions so the user-controlled
query values are unit tested rather than buried in JSX.

**In-app notifications.** Bell + unread badge in the Navbar, newest-20 panel grouped by day, plus
`/notifications` for full history, with mark-read and mark-all-read. Recipients resolve at _publish_
time to concrete user ids; the worker is a dumb writer.

---

## 8. Testing

**431 tests / 20 files, ~2 seconds, no database and no network.**

Strategy: mock `@/lib/prisma` rather than run Postgres. The bug class this repo actually produces —
authorization decisions, validation branches, no-op guards, `revalidatePath` targets, notification
recipient resolution, published job payloads — is covered in milliseconds with no infrastructure.

| File                                                                                              | Covers                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `actions/ticket.actions.test.ts`                                                                  | `addTicketComment` (validation, full role/closed matrix, upload + transaction paths), `assignTicket`, `createTicket`, both delete actions |
| `actions/auth.actions.test.ts`                                                                    | reset flow: no enumeration (message + timing + publish), attempt ceiling, expiry, single use, no session issued, credential hygiene       |
| `app/route-shape.test.ts`                                                                         | `isValidJob` shape gate, incl. the ticketless `PASSWORD_RESET_OTP` case                                                                   |
| `lib/email.test.ts`                                                                               | recipient resolution for every job type, "notify nobody" rules, Resend error → throw so QStash retries                                    |
| `lib/notifications.test.ts`                                                                       | in-app recipient matrix, content, dedupe keys                                                                                             |
| `lib/dashboard-sort.test.ts`                                                                      | total order, non-mutation, nulls-last in both directions, numeric collation                                                               |
| `lib/dashboard-filters.test.ts`                                                                   | whitelist parsing, exact `open` semantics, non-mutation                                                                                   |
| `lib/authorization.test.ts`, `lib/delete-permissions.test.ts`                                     | the security primitives                                                                                                                   |
| `lib/assignment-notifications.test.ts`, `lib/qstash.test.ts`                                      | job construction and the best-effort swallow                                                                                              |
| `prisma/seed-data.test.ts`, `prisma/seed-files.test.ts`                                           | planner invariants + generated bytes vs declared MIME                                                                                     |
| `utils/ui.test.ts`, `lib/priority.test.ts`, `lib/cloudinary.test.ts`, `lib/string-format.test.ts` | exhaustive enum styling, option-list drift, validation                                                                                    |
| `test-utils/safety-rail.test.ts`                                                                  | keeps the dead-socket `DATABASE_URL` override from being deleted                                                                          |

Safety rails and non-obvious mechanics:

- `vitest.setup.ts` imports `dotenv/config` itself (the real chain vanishes the moment a test mocks
  `@/lib/prisma`) and **overrides `DATABASE_URL` to a dead socket**. Any test that forgets to mock
  Prisma fails instantly instead of quietly hitting the live database.
- `test-utils/prisma-mock.ts` is a **hand-written** Prisma surface. A missing method fails loudly
  rather than as `undefined is not a function` deep in the code under test — but it must be
  re-audited whenever an action gains a new Prisma call.
- `^cloudinary$` is aliased to `test-utils/stubs/cloudinary.ts`. Only the SDK is stubbed; the
  validation logic under test is real. This took the suite from ~35 s to ~2 s.
- `vi.resetAllMocks()` (not `clearAllMocks`) in the action tests: `clear` wipes call history but
  leaves a previously installed `mockRejectedValue` behind, silently poisoning later tests.

**Not covered, and not coverable with a mocked DB:** wrong `onDelete` referential actions, bad
migrations, schema drift. Those rely on review discipline plus manual
`npx.cmd prisma migrate status` and
`npx.cmd prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.
Page-level behavior (renders, redirects, 404s, UI copy) is also still unverified by tests — the old
one-off HTTP harnesses were deleted, and only the logic they exercised was re-expressed.

---

## 9. Seed data

Three files, split so the invariants are testable without infrastructure:

- `prisma/seed-data.ts` — **pure planner**. Deterministic (`mulberry32` seeded from
  `SEED_RANDOM_SEED`, no `Math.random()`), so two runs are byte-identical and a seeded bug is
  reproducible.
- `prisma/seed-files.ts` — **file generators**, including a hand-rolled PNG encoder (signature +
  IHDR + `zlib.deflateSync` IDAT + IEND) and a minimal valid PDF with a correct xref table. Only
  PNG and PDF: JPEG/WebP would need real encoders, and listing them anyway was a real bug (rows
  claiming `image/webp` carrying PNG bytes).
- `prisma/seed.ts` — **thin writer**, resolving the plan against the three things it cannot fake:
  the database, the password hash, and Cloudinary.

The plan guarantees subject/description coherence, status-driven age and assignment, `createdAt`
correlated with status, and — importantly — that it only generates states **reachable through the
UI** (no staff reply on an `Open` ticket, because that auto-bumps to `In_Progress`; assignees drawn
only from staff indices, because `listAgents()` filters on `STAFF_ROLES`).

Notifications are derived by **calling** `buildNotificationJobs`, not re-planned, so there is one
implementation of the recipient rules rather than two that can drift.

Tunable via environment variables (all optional): `SEED_USERS` (30), `SEED_TICKETS_PER_USER` as
`min:max` (1:8), `SEED_STAFF` (4), `SEED_RANDOM_SEED` (`quickticket`), and
`SEED_NO_ATTACHMENTS=1` to skip Cloudinary entirely. Missing/failing Cloudinary config is
non-fatal — it warns and seeds a usable database without attachments.

Seed uploads go to their own folder, `quickticket/seed`, so a re-seed can sweep exactly them and
never touch real uploads in `quickticket/tickets`.

> **`deleteMany()` without a `where` clause is the one thing that can wipe this project.** A
> throwaway verification script once did exactly that and lost real data that could not be
> recovered. The bare `deleteMany()` in `prisma/seed.ts` is the only correct use — it is the
> seed, wiping on purpose, in a deliberate `ticket` → `user` order so cascades empty the
> attachment tables first.

---

## 10. Environment

`.env` is gitignored but populated locally.

| Variable                                                               | Purpose                                                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                         | Postgres connection string (Prisma 7 config: `prisma7.config.ts`)                                                     |
| `AUTH_SECRET`                                                          | signs the `jose` JWT                                                                                                  |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET`                   | ticket + comment attachments                                                                                          |
| `QSTASH_URL` / `_TOKEN` / `_CURRENT_SIGNING_KEY` / `_NEXT_SIGNING_KEY` | worker queue + HMAC verification (both keys, so rotation is safe)                                                     |
| `RESEND_API_KEY` / `EMAIL_FROM` / `APP_URL`                            | email delivery; `APP_URL` must be reachable by QStash (use an ngrok tunnel while testing locally)                     |
| `OTP_DEV_REVEAL`                                                       | dev-only OTP echo on screen (`1` + `NODE_ENV !== production`); Resend testing mode only delivers to the account owner |

Sentry's DSN is hardcoded in `sentry.*.config.ts`. Resend's `onboarding@resend.dev` only delivers
to the Resend account owner's address — a verified domain is required for real use.

---

## 11. Known gaps

Scoped out deliberately, not regressions. Full lists with rationale live in `AGENTS.md`.

- **Dashboard:** no text search, no pagination, no bulk actions. Priority is not editable
  post-creation, which is the most visible remaining triage gap.
- **RBAC:** no in-app role management; non-staff hitting `/dashboard` are silently redirected
  rather than shown a 403; no audit trail for status/assignment changes.
- **Comments:** flat thread (no nesting), no editing, no pagination, no rate limiting.
- **Attachments:** no PDF preview, no replace-after-upload, no counts on list pages, no scanning.
- **Notifications:** server-rendered count refreshed on mutation — no polling, so a badge can go
  stale; a staff comment on someone else's ticket generates two emails (comment + status) by
  design.
- **Auth:** no throttle on _requesting_ a reset code (bounds guessing, not sending); existing
  sessions are not revoked by a reset (stateless JWT, no session table); no in-app role
  management. See the Auth backlog in `AGENTS.md`.
- **Ops:** no CI running the test suite; `getTicketById` swallows errors as `404`, so a failing
  sub-query takes down the whole detail page.

---

## 12. Repository notes

- `AGENTS.md` is canonical; `CLAUDE.md` is just `@AGENTS.md`.
- `app/sentry-example-page/` and `app/api/sentry-example-api/` are leftover scaffolding, not
  features.
- `script.ts` is a scratch file for experimenting with the Prisma client.
- `generated/` is gitignored — run `npx.cmd prisma generate` after a fresh clone or a schema
  change, and restart the dev server afterwards.
- Several migrations are **hand-written** (`20260925000000_add_rbac`, the `TicketPriority` enum,
  `uploadedById` backfill, `CommentAttachment`, `Notification`, `PasswordResetOtp`). `migrate dev`
  is non-interactive in this environment, and some of these changes (text→enum column conversion,
  adding `NOT NULL` to a populated table) would be generated destructively or would fail outright.
  Verify drift with `migrate diff --exit-code` after any hand-written migration.
