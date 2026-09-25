<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository guide

Single Next.js 16 (App Router) app — a support ticket system ("QuickTicket"). Not a monorepo. No test framework, no CI, no pre-commit hooks. `CLAUDE.md` is just `@AGENTS.md`; this file is canonical.

## Structure

- `app/` — routes: `/`, `/tickets`, `/tickets/[id]`, `/tickets/new`. Server components call server actions directly.
- `actions/ticket.actions.ts` — every server action (`"use server"`); mutations call `revalidatePath("/tickets")`.
- `lib/prisma.ts` — Prisma singleton; `lib/auth.ts` — jose JWT + `auth-token` cookie helpers; `utils/sentry.ts` — `logEvent()` wrapper used throughout instead of raw Sentry calls.
- Path alias `@/*` → repo root (see `tsconfig.json`).

## Commands

- On this machine PowerShell blocks `npm.ps1`/`npx.ps1` (execution policy) — use **`npm.cmd` / `npx.cmd`** or commands fail immediately.
- Dev: `npm.cmd run dev` · Lint: `npm.cmd run lint` (flat ESLint + `eslint-config-next`, lints the whole repo).
- Typecheck has no script: `npx.cmd tsc --noEmit`.
- There are no tests. Verification = lint → typecheck → `npm.cmd run build`.
- Reset + reseed DB: `db_fresh.bat` (= `prisma migrate reset && prisma db seed && prisma generate`). **Destructive**: the seed (`prisma/seed.ts`) deletes all users and tickets, and `migrate reset` re-runs the seed anyway. `*.bat` files are gitignored.
- Run a one-off script: `npx.cmd tsx <file>` — `tsx` is **not** installed locally; npx downloads it on first use (also required by the configured seed command, so seeding needs network).

## Prisma 7 (differs from Prisma ≤6 defaults)

- Config file is **`prisma7.config.ts`** (not `prisma.config.ts`) — holds the datasource URL and the seed command. Trust it over `PRISMA7_SETUP.md`, which is just a saved copy of the Prisma docs guide.
- Client is generated from `prisma/schema.prisma` into **`generated/prisma/`** — gitignored. Import it as `@/generated/prisma/client`. After a fresh clone or any schema change run `npx.cmd prisma generate` (also wired to `postinstall`); missing/stale generated files cause confusing TS errors.
- Postgres via driver adapter: `lib/prisma.ts` builds a `pg.Pool` from `DATABASE_URL` and passes `PrismaPg` to `PrismaClient`. The schema has no `url` — don't add one.
- Schema changes: `npx.cmd prisma migrate dev --name <name>` (migrations live in `prisma/migrations/`).
- Prisma reference skills are pinned by hash in `skills-lock.json` and mirrored into `.agents/skills/`, `.claude/skills/`, `.windsurf/skills/` (all tracked). Use them for Prisma questions; don't hand-edit the mirrors.

## Environment

`.env` is gitignored but present locally; required vars: `DATABASE_URL`, `AUTH_SECRET`, `SENTRY_AUTH_TOKEN`. Sentry DSN is hardcoded in `sentry.*.config.ts`; `next.config.ts` wraps the build with `withSentryConfig` (tunnel route `/monitoring`), so builds attempt source-map upload.

## Known state — don't assume you caused these

- **Baseline is green** (verified): `npm.cmd run lint` (0 problems), `npx.cmd tsc --noEmit`, and `npm.cmd run build` all pass. New failures are yours, not pre-existing.
- **Auth is wired end-to-end**: `actions/auth.actions.ts` (register/login/logout), `lib/current-user.ts` (`getCurrentUser()` — returns `id, email, name, role`), routes under `app/(auth)/`. Ticket pages guard with `requireUser()` from `lib/authorization.ts`; every ticket action requires a session, and ownership/role checks are enforced server-side: `getTicketById` returns `null` → 404 for a CLIENT's foreign ticket, `closeTicket` denies non-owners.
- `getCurrentUser()` calls `unstable_rethrow(error)` before logging in its catch — Next.js control-flow errors (`cookies()` during prerender) must escape. Removing that line floods the build log with `Dynamic server usage` errors.
- **RBAC is implemented and verified**: migration `20260925000000_add_rbac` (hand-written via `migrate diff` + `migrate deploy` because `migrate dev` is non-interactive here) added `Role`/`TicketStatus` enums, `User.role`, `Ticket.assigneeId` + `assignedTo`, and converted `status` text → enum with a `USING` mapping (`'In Progress'` → `'In_Progress'`) so no data was lost; it backfills `user1@example.com` → ADMIN, `user2`/`user3` → SUPPORT_AGENT (`prisma/seed.ts` matches: 1 ADMIN, 2 SUPPORT_AGENT, 17 CLIENT; seed tickets unassigned). App code: `lib/authorization.ts` (`requireUser`, `requireRole`, `isStaff`, `canAccessTicket`, `STAFF_ROLES`), staff-only actions in `actions/ticket.actions.ts` (`getAllTickets`, `listAgents`, `updateTicketStatus`, `assignTicket` — both staff roles may assign, invalid enum/assignee rejected server-side), dashboard at `/dashboard`, Navbar shows Dashboard link + role chip for staff. Verified 2026-09-25 by HTTP role matrix: 9 page/redirect cases + 11 action-level authz cases, all passing (test artifacts cleaned up).
- **After `npx.cmd prisma generate`, restart `next dev`**: Turbopack hot reload does NOT pick up the regenerated client in `generated/prisma`. A running server keeps the stale schema, so `getCurrentUser()`'s `select` on a new field throws `PrismaClientValidationError` which its catch swallows → every page 307s to `/login` despite a valid cookie.
- `app/sentry-example-page/` and `app/api/sentry-example-api/` are leftover Sentry scaffold, not real features.
- `script.ts` is a scratch file for experimenting with the Prisma client.

## RBAC backlog — intentionally not implemented (recorded 2026-09-25)

Do not treat these as bugs; they were scoped out when RBAC shipped:

1. Assignee not shown on ticket detail/list pages — only on `/dashboard`.
2. No in-app role management (promote to SUPPORT_AGENT/ADMIN) — seed or SQL only; open decision: who may promote (suggest ADMIN-only).
3. Dashboard has no filter/search/pagination/sort (e.g., "unassigned" triage filter) and no bulk actions.
4. No status/assignment audit trail in the DB — changes only reach Sentry via `logEvent`.
5. No status transition rules — staff may set any status, including reopening Closed.
6. `priority` is still `String` (deliberate small-diff choice): no `TicketPriority` enum; the new-ticket form offers Low/Medium/High but the seed can create `Critical` (unstyled by `getPriorityClass`); priority not editable from the dashboard.
7. No DB indexes on the `Ticket.userId` / `Ticket.assigneeId` foreign keys (Prisma does not add them automatically).
8. No automated tests (repo has no test framework; RBAC was verified with a one-off HTTP role matrix — 9 page cases + 11 action cases — that is not reproducible from the repo).
9. No explicit 403 UX — non-staff opening `/dashboard` are silently redirected to `/tickets`.
10. No notifications when a ticket is assigned.
