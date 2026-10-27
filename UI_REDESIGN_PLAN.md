# 🎨 Front-End UI Redesign Plan: QuickTicket Enterprise Support System

As Senior Front-End Developer, I have prepared a comprehensive UI redesign blueprint based on the design specifications and screen blueprints in the **Stitch MCP Project: "QuickTicket Enterprise Support System"** (`projects/14282060282669833810`).

This redesign transforms QuickTicket into a **modern, enterprise-grade, low-cognitive-load support platform** while strictly maintaining the existing Next.js 16 App Router architecture, Prisma 7 database invariants, Server Actions, authorization rules, and the 100% green Vitest test suite.

---

## 🔍 1. Stitch Design Reference & Token Alignment

### Stitch Source Project

- **Stitch Project:** `QuickTicket Enterprise Support System` (`projects/14282060282669833810`)
- **Design Archetype:** _Modern Enterprise Ticketing_ (Clean, border-first, data-dense, Indigo/Slate/Emerald/Amber/Rose semantic visual language)
- **Key Reference Screens in Stitch:**
  1. `Dashboard Desktop` (`d91fa32976904211a4a78d91e5974c3d`)
  2. `Ticket Details Desktop` (`15e8f271c2324a6d88a6e7640bddc20a`)
  3. `New Ticket Desktop` (`931abb2d527c470ca4bb99b475a3d5b5`)
  4. `Notification Desktop` (`4aec7173b9e742a3be99886f129b0931`)

### Stitch Design System Tokens

| Token Category                | Token / Class Name              | Value / Specification                                                                                        | Usage in UI                                  |
| :---------------------------- | :------------------------------ | :----------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| **Canvas & Surface**          | `surface` / `bg-app`            | `#FAF8FF` (`slate-50` / soft neutral canvas)                                                                 | Body & layout background                     |
| **Card & Container**          | `surface-container-lowest`      | `#FFFFFF` (`bg-white border border-slate-200 shadow-sm rounded-xl`)                                          | Content panels, tables, detail cards         |
| **Primary Brand**             | `primary` / `primary-container` | Indigo 600 (`#4F46E5`), Hover Indigo 700 (`#4338CA`)                                                         | Main CTAs, active filters, brand highlights  |
| **Slate Neutrals**            | `slate-50` to `slate-900`       | `#F8FAFC`, `#F1F5F9`, `#E2E8F0`, `#64748B`, `#334155`, `#0F172A`                                             | Typography, structural borders, dividers     |
| **Success (Resolved)**        | `emerald-600` / `bg-emerald-50` | `#059669` text, `#ECFDF5` bg, `#A7F3D0` border                                                               | Resolved/Closed badges & status indicators   |
| **Warning (Medium/Progress)** | `amber-600` / `bg-amber-50`     | `#D97706` text, `#FFFBEB` bg, `#FDE68A` border                                                               | In_Progress status, Medium priority badges   |
| **Danger (Critical/High)**    | `rose-600` / `bg-rose-50`       | `#E11D48` text, `#FFF1F2` bg, `#FECDD3` border                                                               | High/Critical priority badges, delete alerts |
| **Typography Scale**          | Inter Sans-Serif                | `headline-lg` (30px), `headline-md` (24px), `title-md` (16px), `body-md` (14px), `label-sm` (11px uppercase) | Clean typographic hierarchy                  |
| **Border Radius**             | `rounded-lg` / `rounded-xl`     | `8px` (inputs/buttons), `12px` (cards/tables), `9999px` (status/priority pills)                              | Consistent rounded corners                   |

---

## 🏗️ 2. Architectural Preservation Invariants

To guarantee that no existing functionality, security boundaries, or tests break during the UI overhaul, the implementation will strictly preserve:

1. **Routing & Server Actions Unchanged:**
   - All App Router paths (`/`, `/dashboard`, `/tickets`, `/tickets/[id]`, `/tickets/new`, `/notifications`, `/login`, `/register`, `/forgot-password`) retain their current route definitions.
   - Server Actions in `actions/*.ts` (`createTicket`, `updateTicketStatus`, `assignTicket`, `addTicketComment`, `deleteAttachment`, `deleteComment`, `markNotificationRead`, `loginUser`, `registerUser`, `resetPassword`) will remain untouched.
2. **RSC & Component Boundaries Preserved:**
   - Server Components remain Server Components (`app/dashboard/page.tsx`, `components/dashboard/TicketTable.tsx`, `components/AttachmentList.tsx`, `components/AttachmentGrid.tsx`, `app/tickets/[id]/comment-thread.tsx`).
   - Client Components keep their existing interactive hooks & state handling without causing `react-hooks/set-state-in-effect` warnings.
3. **Accessibility & URL State Contract:**
   - `?filter=` and `?sort=` URL query param handling on `/dashboard` with zero JS dependency, `aria-sort` on header links, `aria-current="page"` on filter tabs, and keyboard accessibility.
4. **Verification Chain Maintenance:**
   - `npm.cmd run lint` (0 errors) -> `npm.cmd run test` (353+ Vitest tests passing) -> `npx.cmd tsc --noEmit` -> `npm.cmd run build`.

---

## 🎨 3. Page-by-Page Redesign Blueprint

### Page 1: Navigation Header & Shell Layout (`components/Navbar.tsx` & `app/layout.tsx`)

- **Stitch Layout Concept:** Glassmorphism top bar (`backdrop-blur-md bg-white/80 border-b border-slate-200 sticky top-0 z-50`).
- **Brand Identity:** Deep Indigo logo mark (`#4F46E5`) with crisp typography and subtle role badge (`STAFF` / `ADMIN` pill with `border-slate-300 text-slate-700 bg-slate-50`).
- **Notification Bell & User Menu:** Refined `NotificationBell` with pill count badge in `bg-indigo-600 text-white animate-pulse-subtle` and popover matching Stitch `Notification Desktop` styling.

### Page 2: Staff Dashboard (`app/dashboard/page.tsx` & `components/dashboard/TicketTable.tsx`)

- **Stitch Layout Concept:** `Dashboard Desktop` (`d91fa32976904211a4a78d91e5974c3d`).
- **Header Section:** Dynamic greeting, quick statistics overview cards (Total Tickets, Unassigned, Mine, Open) with subtle Indigo/Slate accent borders.
- **Triage Filter Tabs:** Segmented tab control (`All`, `Unassigned`, `Assigned to me`, `Open`) styled as clean borderless buttons on a `bg-slate-100/80 p-1 rounded-xl` container.
- **DataTable Styling:** Clean border-first container (`bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden`).
  - Table Header: `bg-slate-50/80 text-slate-500 uppercase tracking-wider text-xs font-semibold border-b border-slate-200`.
  - Column Sorting (`aria-sort`): Subtle directional arrow indicators (`▲`/`▼`) with active column highlighted in Indigo (`text-indigo-600`).
  - Status Selectors & Assign Selectors: Enhanced custom styling with dot indicators (Emerald for Resolved, Amber for In Progress, Slate for Open) and clean focus rings.

### Page 3: Ticket Details & Live Conversation Thread (`app/tickets/[id]/page.tsx`, `comment-thread.tsx`, `comment-form.tsx`, `AttachmentGrid.tsx`)

- **Stitch Layout Concept:** `Ticket Details Desktop` (`15e8f271c2324a6d88a6e7640bddc20a`).
- **Two-Column Layout (`max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8`):**
  - **Left / Main Column (2/3 width):** Ticket header (title, author, metadata), description block with refined monospace/prose spacing, multi-file attachments grid (`AttachmentGrid`), and chronological comment discussion thread.
  - **Right Sidebar (1/3 width):** Sticky metadata card containing Status update dropdown, Assignee selector, Priority indicator pill, Requester info, and Ticket ID audit details.
- **Comment Thread Bubbles:**
  - Customer Comments: Left-aligned white cards with `border border-slate-200 shadow-sm rounded-2xl rounded-tl-sm`.
  - Support Staff Comments: Right-aligned soft Indigo cards (`bg-indigo-50/50 border border-indigo-100 rounded-2xl rounded-tr-sm`) with a distinct `SUPPORT STAFF` badge.
  - Soft-Deleted Comment: Light slate muted box (`bg-slate-100/60 border border-slate-200 text-slate-500 italic`) rendering "Comment removed by [User]".

### Page 4: New Ticket Form (`app/tickets/new/page.tsx` & `ticket-form.tsx`)

- **Stitch Layout Concept:** `New Ticket Desktop` (`931abb2d527c470ca4bb99b475a3d5b5`).
- **Container:** Centered single-column layout (`max-w-3xl mx-auto`). Card with `border border-slate-200 shadow-sm rounded-2xl p-8 bg-white`.
- **Form Controls:**
  - Priority Selector: Custom visual radio cards (Low, Medium, High, Critical) with color-coded border accents when selected instead of a plain dropdown.
  - Drag-and-Drop Attachment Zone: Modern upload dropzone with MIME type validation summary, file count tracker (up to 5 files, 5MB each), and instant preview thumbnails.

### Page 5: Notifications Page (`app/notifications/page.tsx` & `components/NotificationBell.tsx`)

- **Stitch Layout Concept:** `Notification Desktop` (`4aec7173b9e742a3be99886f129b0931`).
- **Grouping & Timeline:** Chronologically grouped by day (Today, Yesterday, Earlier) with distinct icon badges for event types (`TICKET_CREATED`, `NEW_COMMENT`, `TICKET_ASSIGNED`, `STATUS_UPDATED`).
- **Unread Row State:** Unread notifications styled with subtle Indigo border-l-4 (`border-indigo-600 bg-indigo-50/30`) that transitions smoothly to plain background once read.

### Page 6: Authentication Views (`/login`, `/register`, `/forgot-password`)

- **Stitch Layout Concept:** Enterprise Auth Cards (`max-w-md mx-auto py-16`).
- **Visual Style:** Brand logo header, clean input fields with floating label feel, clear error state callouts (`bg-rose-50 text-rose-700 border border-rose-200 rounded-lg p-3 text-sm`), and primary Indigo submit CTA with pending spinner state.

---

## 🚀 4. Execution Roadmap & Phases

The implementation plan is broken down into **5 logical execution phases**. Each phase is modular and self-contained to maintain continuous code quality.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          REDESIGN EXECUTION PHASES                          │
├─────────────┬─────────────┬─────────────┬───────────────────┬───────────────┤
│   PHASE 1   │   PHASE 2   │   PHASE 3   │      PHASE 4      │    PHASE 5    │
│ Foundation  │ Core Shell  │ Dashboard & │ Ticket Details &  │ Verification  │
│  & Tokens   │   & Auth    │ Ticket List │ Discussion Thread │  & Testing    │
└─────────────┴─────────────┴─────────────┴───────────────────┴───────────────┘
```

### Phase 1: Design Tokens & CSS Foundation Setup

1. **Extend Tailwind Config / CSS Variables:**
   - Update `app/globals.css` with Stitch design system tokens (Indigo `#4F46E5` primary, Slate palette, Emerald/Amber/Rose status & priority tokens).
   - Configure subtle custom shadow utilities (`shadow-card`, `shadow-popover`) and glassmorphism helpers (`backdrop-blur-md`).

### Phase 2: Navigation Shell, Header & Auth Screens Redesign

1. **Redesign Layout & Header (`components/Navbar.tsx`, `app/layout.tsx`):**
   - Implement sticky glassmorphism header bar with Indigo branding, role badge, navigation links, and refreshed `NotificationBell`.
2. **Redesign Auth Pages (`app/(auth)/*`):**
   - Apply Stitch enterprise card styling to `/login`, `/register`, and `/forgot-password` forms.

### Phase 3: Staff Dashboard & Ticket List Redesign

1. **Refactor Dashboard & Table (`app/dashboard/page.tsx`, `TicketTable.tsx`):**
   - Implement Stitch `Dashboard Desktop` UI layout with top metrics overview cards.
   - Restyle filter navigation tabs (`?filter=`) and column header sorting links (`?sort=`).
   - Enhance `StatusSelect` and `AssignSelect` per-row component styling without altering action triggers.
2. **Refactor Client Ticket List (`app/tickets/page.tsx` & `TicketItem.tsx`):**
   - Restyle customer ticket cards with clean border-first cards and status/priority pills.

### Phase 4: Ticket Detail Page, Comment Thread & Forms Redesign

1. **Redesign Ticket Detail Layout (`app/tickets/[id]/page.tsx`):**
   - Implement two-column sticky sidebar layout for metadata (Status, Assignee, Priority, Requester).
2. **Refactor Comment Discussion (`comment-thread.tsx`, `comment-form.tsx`):**
   - Update discussion bubbles (Customer vs. Support Staff styling, soft-deleted state rendering).
   - Restyle comment form and attachment uploader trigger.
3. **Refactor Attachments Grid (`AttachmentList.tsx`, `AttachmentGrid.tsx`):**
   - Restyle image thumbnail cards and PDF download rows with rounded borders and uploader badges.
4. **Redesign New Ticket Form (`app/tickets/new/ticket-form.tsx`):**
   - Upgrade form inputs, priority visual selectors, and drag-and-drop file attachment dropzone.
5. **Redesign Notifications History (`app/notifications/page.tsx`):**
   - Restyle full notifications page with date grouping and timeline markers.

### Phase 5: Verification, Accessibility & Build Audit

1. **Run Full Verification Chain:**
   - `npm.cmd run lint` — Confirm 0 lint warnings/errors.
   - `npm.cmd run test` — Ensure all 353+ Vitest unit tests pass without regressions.
   - `npx.cmd tsc --noEmit` — Confirm strict TypeScript compilation.
   - `npm.cmd run build` — Verify production build succeeds cleanly.
2. **Browser Visual & Responsive Audit:**
   - Validate desktop (1440px), tablet (768px), and mobile viewports.
   - Verify dark/light contrast legibility and focus rings for accessibility.

---

## 📋 5. Verification Checklist

- [ ] All Stitch design tokens (Indigo primary, Slate neutrals, Emerald/Amber/Rose status/priority) applied cleanly.
- [ ] No server actions, database schemas, or route handlers modified.
- [ ] Server Component / Client Component boundaries intact.
- [ ] URL-driven filter (`?filter=`) and sort (`?sort=`) functionality on `/dashboard` fully preserved.
- [ ] Form states (pending indicators, toasts, error messages) intact and styled.
- [ ] `npm.cmd run lint` -> 0 errors.
- [ ] `npm.cmd run test` -> 353/353 tests passing.
- [ ] `npx.cmd tsc --noEmit` -> 0 type errors.
- [ ] `npm.cmd run build` -> successful build.

---

## 💬 Next Steps & Plan Mode Notice

We are currently in **Plan Mode**. The redesign plan above details the visual strategy, token mappings, and execution phases based on the Stitch reference project **"QuickTicket Enterprise Support System"**.

If you would like to begin executing Phase 1 of this redesign plan, please switch agents out of Plan mode to proceed with implementation!
