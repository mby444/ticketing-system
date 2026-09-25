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
- **Auth is wired end-to-end**: `actions/auth.actions.ts` (register/login/logout), `lib/current-user.ts` (`getCurrentUser()`), routes under `app/(auth)/`. Ticket pages guard with `getCurrentUser()` + `redirect("/login")`; every ticket action requires a session. **Not done yet**: ownership checks — the list is scoped to your own tickets, but `/tickets/[id]` and `closeTicket` accept any logged-in user's ticket (part of the RBAC phase).
- `getCurrentUser()` calls `unstable_rethrow(error)` before logging in its catch — Next.js control-flow errors (`cookies()` during prerender) must escape. Removing that line floods the build log with `Dynamic server usage` errors.
- **RBAC schema is migrated and live**: `20260925000000_add_rbac` (hand-written because `migrate dev` is non-interactive here) added `Role`/`TicketStatus` enums, `User.role`, `Ticket.assigneeId` + `assignedTo`, and converted `status` text → enum with a `USING` mapping (`'In Progress'` → `'In_Progress'`) so no data was lost. It also backfills `user1@example.com` → ADMIN, `user2`/`user3` → SUPPORT_AGENT. `prisma/seed.ts` matches (1 ADMIN, 2 SUPPORT_AGENT, 17 CLIENT; enum statuses). App-level RBAC (authz helpers, role-aware UI, dashboard) not built yet.
- `app/sentry-example-page/` and `app/api/sentry-example-api/` are leftover Sentry scaffold, not real features.
- `script.ts` is a scratch file for experimenting with the Prisma client.
