# UI/UX Design Guidelines: Modern Enterprise Ticketing System

## 1. Core Visual Identity

- **Design Philosophy:** Clean, functional, data-first, and low cognitive load.
- **Color Palette:**
  - **Primary:** Deep Indigo (`#4F46E5` / `bg-indigo-600`)
  - **Secondary/Neutral:** Cool Slate (`slate-50` to `slate-900`)
  - **Success (Resolved/Closed):** Emerald (`emerald-600` / `bg-emerald-50`)
  - **Warning (Medium Priority / Pending):** Amber (`amber-500` / `bg-amber-50`)
  - **Danger (High Priority / Urgent / Failed):** Rose (`rose-600` / `bg-rose-50`)
- **Typography:** Sans-serif crisp typography (Inter / System UI).
  - Headings: Bold, slate-900
  - Body: Regular/Medium, slate-700
  - Captions/Metadata: Slate-500, `text-xs` or `text-sm`

## 2. Layout & Structure

- **Container Strategy:** Max-width constrained (`max-w-7xl` for dashboards, `max-w-4xl` for form/ticket details) centered with auto margins.
- **Card Design:** Border-first design over heavy shadows (`border border-slate-200 bg-white shadow-sm rounded-xl p-6`).
- **Header Navigation:** Sticky top navbar with glassmorphism blur effect (`backdrop-blur-md bg-white/80 border-b border-slate-200`).

## 3. Ticketing Component Standards

- **Priority Badges:** Rounded pills with soft pastel background + solid text.
  - _High:_ `bg-rose-100 text-rose-700 font-semibold border border-rose-200`
  - _Medium:_ `bg-amber-100 text-amber-700 font-semibold border border-amber-200`
  - _Low:_ `bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200`
- **Status Badges:** Dot-indicator style (e.g., `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium`).
- **Interactive States:** Subtle hover transitions (`hover:border-slate-300 transition-all duration-200`).

## 4. Forms & Inputs

- **Inputs & Textareas:** Clean borders with distinct focus ring (`border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-lg`).
- **Buttons:**
  - _Primary Action:_ `bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg px-4 py-2 shadow-sm transition`
  - _Secondary Action:_ `bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg px-4 py-2 transition`
  - _Loading State:_ Disabled with a smooth spinner and low opacity (`opacity-60 cursor-not-allowed`).
