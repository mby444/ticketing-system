import type { TicketStatus } from "@/generated/prisma/client";

/**
 * Dashboard triage filters.
 *
 * Deliberately free of any Next.js or Prisma-client import so it stays a pure
 * module: the page only has to read `searchParams` and hand the raw value over.
 * That also makes every rule below directly testable, which matters because the
 * filter value is user-controlled and silently falls back to the default when it
 * is not recognised.
 */
export const DASHBOARD_FILTERS = [
  "all",
  "unassigned",
  "mine",
  "open",
] as const;

export type DashboardFilter = (typeof DASHBOARD_FILTERS)[number];

export const DEFAULT_DASHBOARD_FILTER: DashboardFilter = "all";

export const DASHBOARD_FILTER_LABELS: Record<DashboardFilter, string> = {
  all: "All",
  unassigned: "Unassigned",
  mine: "Assigned to me",
  // `open` means "not Closed", so it also includes In_Progress and Resolved —
  // matching the sort's "active statuses before Closed". The label says so
  // rather than promising an exact status match.
  open: "Open (not closed)",
};

/**
 * Whitelist the raw `?filter=` value. Anything unrecognised (typo, hand-typed
 * URL, `?filter=a&filter=b` with a bad first entry) falls back to the default
 * instead of throwing or rendering an unknown label.
 */
export const parseDashboardFilter = (
  raw: string | string[] | undefined,
): DashboardFilter => {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return DASHBOARD_FILTERS.includes(value as DashboardFilter)
    ? (value as DashboardFilter)
    : DEFAULT_DASHBOARD_FILTER;
};

/** The minimum a ticket needs to expose for the rules above. */
export type FilterableTicket = {
  status: TicketStatus;
  assigneeId: string | null;
};

export const matchesDashboardFilter = (
  ticket: FilterableTicket,
  filter: DashboardFilter,
  viewerId: string,
): boolean => {
  switch (filter) {
    case "all":
      return true;
    case "unassigned":
      return ticket.assigneeId === null;
    case "mine":
      return ticket.assigneeId === viewerId;
    case "open":
      return ticket.status !== "Closed";
  }
};

/**
 * Order-preserving and non-mutating: the caller already sorts its own slices,
 * and a filter that reordered or mutated the array it was given would quietly
 * corrupt the unfiltered view.
 */
export const filterDashboardTickets = <T extends FilterableTicket>(
  tickets: T[],
  filter: DashboardFilter,
  viewerId: string,
): T[] =>
  tickets.filter((ticket) => matchesDashboardFilter(ticket, filter, viewerId));

/** Tally for the filter chips, so counts are visible before you click. */
export const countDashboardFilter = (
  tickets: FilterableTicket[],
  filter: DashboardFilter,
  viewerId: string,
): number => tickets.filter((t) => matchesDashboardFilter(t, filter, viewerId))
  .length;
