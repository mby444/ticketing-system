import type { TicketPriority, TicketStatus } from "@/generated/prisma/client";
import {
  DEFAULT_DASHBOARD_FILTER,
  type DashboardFilter,
} from "@/lib/dashboard-filters";
import { PRIORITY_OPTIONS } from "@/lib/priority";

/**
 * Dashboard column sorting.
 *
 * Deliberately free of any Next.js or Prisma-client *value* import so it stays a
 * pure module: the page reads `searchParams` and hands the raw value over, and
 * the comparator is directly testable. That matters because `?sort=` is
 * user-controlled and silently falls back to the default when unrecognised —
 * exactly the same contract as `?filter=`.
 */

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

/** The columns a user may sort by. "Ticket" is absent: no subject sort. */
export const DASHBOARD_SORT_FIELDS = [
  "priority",
  "status",
  "created",
  "assignee",
  "requester",
] as const;

export type DashboardSortField = (typeof DASHBOARD_SORT_FIELDS)[number];

export type DashboardSort = `${DashboardSortField}_${"asc" | "desc"}`;

/**
 * The direction each column starts in when it is clicked for the first time.
 * Not cosmetic: for triage the useful direction differs per column — severity
 * wants most-critical first, dates want newest first, names want A-Z.
 */
export const DASHBOARD_SORT_INITIAL_DIRECTION: Record<
  DashboardSortField,
  "asc" | "desc"
> = {
  priority: "desc",
  status: "asc",
  created: "desc",
  assignee: "asc",
  requester: "asc",
};

/**
 * The default is the Status column ascending, tie-broken by newest first.
 *
 * This deliberately replaces the previous behaviour, which sorted "Assigned to
 * me" as active-before-Closed but left "Other tickets" in plain createdAt order.
 * `STATUS_ORDER` already lists the workflow in the order that "active first"
 * meant, so the old special case was exactly `status_asc` plus a createdAt
 * tie-break. Expressing it as one sort removes the per-section branch and gives
 * every view a column to mark with `aria-sort`.
 */
export const DEFAULT_DASHBOARD_SORT: DashboardSort = "status_asc";

/** Every valid option, derived so the list cannot drift from the types above. */
export const ALL_DASHBOARD_SORTS: readonly DashboardSort[] =
  DASHBOARD_SORT_FIELDS.flatMap((field) => [
    `${field}_asc`,
    `${field}_desc`,
  ] as DashboardSort[]);

export const isDashboardSort = (value: unknown): value is DashboardSort =>
  typeof value === "string" && ALL_DASHBOARD_SORTS.includes(value as DashboardSort);

export const DASHBOARD_SORT_LABELS: Record<DashboardSort, string> = {
  priority_desc: "Highest priority",
  priority_asc: "Lowest priority",
  status_asc: "Status (workflow order)",
  status_desc: "Status (reverse)",
  created_desc: "Newest first",
  created_asc: "Oldest first",
  assignee_asc: "Assignee (A-Z)",
  assignee_desc: "Assignee (Z-A)",
  requester_asc: "Requester (A-Z)",
  requester_desc: "Requester (Z-A)",
};

/**
 * Whitelist the raw `?sort=` value. Anything unrecognised falls back to the
 * default rather than throwing or rendering an unknown aria-sort.
 */
export const parseDashboardSort = (
  raw: string | string[] | undefined,
): DashboardSort => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isDashboardSort(value) ? value : DEFAULT_DASHBOARD_SORT;
};

export const sortFieldOf = (sort: DashboardSort): DashboardSortField =>
  sort.slice(0, sort.lastIndexOf("_")) as DashboardSortField;

export const isAscending = (sort: DashboardSort): boolean =>
  sort.endsWith("_asc");

/**
 * The sort a column header should link to: the same column reversed if it is
 * already active, otherwise that column's initial direction.
 */
export const nextSortFor = (
  field: DashboardSortField,
  current: DashboardSort,
): DashboardSort => {
  if (sortFieldOf(current) === field) {
    return isAscending(current)
      ? (`${field}_desc` as DashboardSort)
      : (`${field}_asc` as DashboardSort);
  }
  return `${field}_${DASHBOARD_SORT_INITIAL_DIRECTION[field]}` as DashboardSort;
};

// ---------------------------------------------------------------------------
// Explicit orders
// ---------------------------------------------------------------------------

/**
 * Hand-written rather than derived from the generated enum, for the same reason
 * `lib/priority.ts` does it: importing the Prisma client as a value would pull
 * its runtime into the browser bundle. `satisfies` ties the list to the enum at
 * compile time and the test below asserts it covers the enum exactly.
 */
export const STATUS_ORDER = [
  "Open",
  "In_Progress",
  "Resolved",
  "Closed",
] as const satisfies readonly TicketStatus[];

/**
 * Priority is NOT re-declared: `PRIORITY_OPTIONS` is already exactly this order,
 * already `satisfies` the enum, and already has a test asserting it equals the
 * enum. Reusing it avoids a third copy of the same list.
 *
 * Note the direction: least severe first, so `_desc` — the direction the column
 * starts in — yields most severe first. An earlier draft listed it most-severe
 * first, which made `_desc` produce Low on top, because `asc`/`desc` are applied
 * mechanically to whatever order is declared here.
 */
export const PRIORITY_ORDER = PRIORITY_OPTIONS;

const statusRank = new Map<string, number>(
  STATUS_ORDER.map((status, index) => [status, index]),
);
const priorityRank = new Map<string, number>(
  PRIORITY_ORDER.map((priority, index) => [priority, index]),
);

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

/**
 * The minimum a ticket must expose for sorting. `DashboardTicket` from
 * `getAllTickets()` satisfies it structurally.
 */
export type SortableTicket = {
  id: number;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: Date;
  user: { name: string | null };
  assignedTo: { name: string | null } | null;
};

/**
 * Name comparison. `numeric` is not a nicety: requester names are "User Ke-2"
 * and "User Ke-10", and a plain `<` comparison puts "User Ke-10" first. The
 * locale and sensitivity are pinned so the server and the browser cannot
 * disagree about the order.
 */
const compareNames = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  // A missing name sorts last in BOTH directions. Reversing the whole comparison
  // would move nulls to the front on ascending sorts, so "unassigned" would jump
  // position every time the direction was flipped.
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
};

const compareByField = (
  a: SortableTicket,
  b: SortableTicket,
  field: DashboardSortField,
  direction: 1 | -1,
): number => {
  switch (field) {
    case "status":
      return (
        direction *
        ((statusRank.get(a.status) ?? 0) - (statusRank.get(b.status) ?? 0))
      );
    case "priority":
      return (
        direction *
        ((priorityRank.get(a.priority) ?? 0) - (priorityRank.get(b.priority) ?? 0))
      );
    case "created":
      return direction * (a.createdAt.getTime() - b.createdAt.getTime());
    case "assignee": {
      const aName = a.assignedTo?.name ?? null;
      const bName = b.assignedTo?.name ?? null;
      // A missing name stays last in BOTH directions, so the direction must not
      // be applied to it. Multiplying blindly would move unassigned tickets to
      // the front on ascending sorts, so "unassigned" would jump position every
      // time the direction flipped.
      if (aName === null || bName === null) return compareNames(aName, bName);
      return direction * compareNames(aName, bName);
    }
    case "requester": {
      const aName = a.user.name;
      const bName = b.user.name;
      if (aName === null || bName === null) return compareNames(aName, bName);
      return direction * compareNames(aName, bName);
    }
  }
};

/**
 * Orders tickets by `sort`.
 *
 * Two properties this function must never lose:
 *
 * 1. **Total order.** Every comparison ends in `createdAt` then `id`, so two
 *    tickets with an identical sort key can never swap places between renders.
 *    Without the `id` tie-break, a stable sort is only "stable for one input
 *    order", and the page's own partitioning decides that order.
 * 2. **Non-mutating.** The caller shares one array across `filtered`, `mine`,
 *    `others` and the filter counts, so an in-place `.sort()` here would quietly
 *    corrupt the unfiltered view. `[...tickets].sort()` is deliberate.
 *
 * The `createdAt desc` tie-break in the middle is what keeps the default view
 * unchanged within each status group, and degenerates to the `id` tie-break for
 * the date sorts.
 */
export const sortDashboardTickets = <T extends SortableTicket>(
  tickets: readonly T[],
  sort: DashboardSort,
): T[] => {
  const field = sortFieldOf(sort);
  const direction: 1 | -1 = isAscending(sort) ? 1 : -1;

  return [...tickets].sort((a, b) => {
    const primary = compareByField(a, b, field, direction);
    if (primary !== 0) return primary;

    const recency = b.createdAt.getTime() - a.createdAt.getTime();
    if (recency !== 0) return recency;
    return a.id - b.id;
  });
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Builds a dashboard URL that preserves both the filter and the sort.
 *
 * This exists because `FilterNav` hardcodes its own hrefs. Without this helper,
 * clicking a filter chip would drop the active sort from the URL and silently
 * reset the view — the two controls would quietly fight each other.
 *
 * Default values are omitted so the common view stays a clean `/dashboard`, and
 * the result is built from the whitelisted constants rather than from the raw
 * query values.
 */
export const buildDashboardHref = ({
  filter = DEFAULT_DASHBOARD_FILTER,
  sort = DEFAULT_DASHBOARD_SORT,
}: {
  filter?: DashboardFilter;
  sort?: DashboardSort;
} = {}): string => {
  const params = new URLSearchParams();
  if (filter !== DEFAULT_DASHBOARD_FILTER) params.set("filter", filter);
  if (sort !== DEFAULT_DASHBOARD_SORT) params.set("sort", sort);
  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
};