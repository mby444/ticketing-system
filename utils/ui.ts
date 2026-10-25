import type { TicketPriority } from "@/generated/prisma/client";

/**
 * Pastel pill badge classes for ticket priority, per DESIGN.md.
 * High/Critical → rose (danger), Medium → amber (warning), Low → emerald (success).
 * Critical keeps darker text so the top severity stays distinct from High.
 */
export const getPriorityClass = (priority: TicketPriority) => {
  const base =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border";
  switch (priority) {
    case "High":
      return `${base} bg-rose-100 text-rose-700 border-rose-200`;
    case "Critical":
      return `${base} bg-rose-100 text-rose-800 border-rose-200`;
    case "Medium":
      return `${base} bg-amber-100 text-amber-700 border-amber-200`;
    case "Low":
      return `${base} bg-emerald-100 text-emerald-700 border-emerald-200`;
  }
};

/**
 * Pill badge classes for ticket status, per DESIGN.md badge style.
 * Resolved/Closed → emerald/slate (success/neutral); Open → amber; In_Progress → blue.
 */
export const getStatusClass = (status: string) => {
  const base =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border";
  switch (status) {
    case "Open":
      return `${base} bg-amber-100 text-amber-700 border-amber-200`;
    case "In_Progress":
      return `${base} bg-blue-100 text-blue-700 border-blue-200`;
    case "Resolved":
      return `${base} bg-emerald-100 text-emerald-700 border-emerald-200`;
    case "Closed":
      return `${base} bg-slate-100 text-slate-700 border-slate-200`;
  }
};
