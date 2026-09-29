import { describe, expect, it } from "vitest";
import {
  countDashboardFilter,
  DASHBOARD_FILTERS,
  DASHBOARD_FILTER_LABELS,
  DEFAULT_DASHBOARD_FILTER,
  filterDashboardTickets,
  matchesDashboardFilter,
  parseDashboardFilter,
  type FilterableTicket,
} from "@/lib/dashboard-filters";
import type { TicketStatus } from "@/generated/prisma/client";

/**
 * The `?filter=` value is user-controlled, so the whitelist and the fallbacks
 * are the security-relevant part here; the rest pins the triage semantics so a
 * future "simplification" cannot quietly change what a filter means.
 */

const VIEWER = "agent-1";
const OTHER = "agent-2";

const ticket = (
  status: TicketStatus,
  assigneeId: string | null,
): FilterableTicket => ({ status, assigneeId });

describe("parseDashboardFilter", () => {
  it("falls back to the default for a missing value", () => {
    expect(parseDashboardFilter(undefined)).toBe(DEFAULT_DASHBOARD_FILTER);
  });

  it("accepts every advertised filter", () => {
    for (const option of DASHBOARD_FILTERS) {
      expect(parseDashboardFilter(option)).toBe(option);
    }
  });

  it("falls back rather than throwing on junk", () => {
    expect(parseDashboardFilter("bogus")).toBe("all");
    expect(parseDashboardFilter("")).toBe("all");
    expect(parseDashboardFilter("'; DROP TABLE")).toBe("all");
  });

  it("is case sensitive, so a typo does not silently match", () => {
    expect(parseDashboardFilter("Mine")).toBe("all");
    expect(parseDashboardFilter("UNASSIGNED")).toBe("all");
  });

  it("uses the first entry when the param is repeated", () => {
    expect(parseDashboardFilter(["mine", "all"])).toBe("mine");
    expect(parseDashboardFilter(["bogus", "mine"])).toBe("all");
  });
});

describe("matchesDashboardFilter — unassigned", () => {
  it("matches a ticket with nobody on it", () => {
    expect(matchesDashboardFilter(ticket("Open", null), "unassigned", VIEWER)).toBe(true);
  });

  it("does not match an assigned ticket", () => {
    expect(matchesDashboardFilter(ticket("Open", OTHER), "unassigned", VIEWER)).toBe(false);
  });

  it("does not match a ticket assigned to me", () => {
    expect(matchesDashboardFilter(ticket("Open", VIEWER), "unassigned", VIEWER)).toBe(false);
  });
});

describe("matchesDashboardFilter — mine", () => {
  it("matches a ticket assigned to me", () => {
    expect(matchesDashboardFilter(ticket("Open", VIEWER), "mine", VIEWER)).toBe(true);
  });

  it("does not match somebody else's ticket", () => {
    expect(matchesDashboardFilter(ticket("Open", OTHER), "mine", VIEWER)).toBe(false);
  });

  it("does not match an unassigned ticket", () => {
    expect(matchesDashboardFilter(ticket("Open", null), "mine", VIEWER)).toBe(false);
  });
});

describe("matchesDashboardFilter — open", () => {
  // "open" means not Closed, which is what the label promises.
  it.each(["Open", "In_Progress", "Resolved"] as TicketStatus[])(
    "includes %s",
    (status) => {
      expect(matchesDashboardFilter(ticket(status, null), "open", VIEWER)).toBe(true);
    },
  );

  it("excludes Closed", () => {
    expect(matchesDashboardFilter(ticket("Closed", null), "open", VIEWER)).toBe(false);
  });
});

describe("matchesDashboardFilter — all", () => {
  it("matches everything, including unassigned and closed", () => {
    for (const status of ["Open", "In_Progress", "Resolved", "Closed"] as TicketStatus[]) {
      for (const assigneeId of [null, VIEWER, OTHER]) {
        expect(matchesDashboardFilter(ticket(status, assigneeId), "all", VIEWER)).toBe(true);
      }
    }
  });
});

describe("filterDashboardTickets", () => {
  // Intersect rather than cast: a cast to FilterableTicket[] would strip `id`
  // and hide that the helper is generic and preserves the caller's shape.
  type Row = FilterableTicket & { id: number };

  const data: Row[] = [
    { id: 1, status: "Open", assigneeId: null },
    { id: 2, status: "Closed", assigneeId: null },
    { id: 3, status: "In_Progress", assigneeId: VIEWER },
    { id: 4, status: "Resolved", assigneeId: OTHER },
  ];

  it("keeps the input order", () => {
    expect(filterDashboardTickets(data, "unassigned", VIEWER).map((t) => t.id)).toEqual([1, 2]);
    expect(filterDashboardTickets(data, "mine", VIEWER).map((t) => t.id)).toEqual([3]);
    expect(filterDashboardTickets(data, "open", VIEWER).map((t) => t.id)).toEqual([1, 3, 4]);
  });

  it("returns everything for 'all'", () => {
    expect(filterDashboardTickets(data, "all", VIEWER)).toHaveLength(data.length);
  });

  it("does not mutate the array it was given", () => {
    const snapshot = data.map((t) => ({ ...t }));
    const result = filterDashboardTickets(data, "unassigned", VIEWER);

    expect(data).toEqual(snapshot);
    expect(result).not.toBe(data);
  });

  it("returns an empty array rather than throwing when nothing matches", () => {
    const noMine: Row[] = [{ id: 9, status: "Open", assigneeId: null }];
    expect(filterDashboardTickets(noMine, "mine", VIEWER)).toEqual([]);
  });
});

describe("countDashboardFilter", () => {
  it("tallies each filter independently of the default one", () => {
    const data: FilterableTicket[] = [
      { status: "Open", assigneeId: null },
      { status: "Closed", assigneeId: null },
      { status: "Open", assigneeId: VIEWER },
    ];
    expect(countDashboardFilter(data, "all", VIEWER)).toBe(3);
    expect(countDashboardFilter(data, "unassigned", VIEWER)).toBe(2);
    expect(countDashboardFilter(data, "mine", VIEWER)).toBe(1);
    // Open + Open, the Closed one is excluded.
    expect(countDashboardFilter(data, "open", VIEWER)).toBe(2);
  });
});

describe("label table", () => {
  it("has a label for every filter", () => {
    for (const option of DASHBOARD_FILTERS) {
      expect(DASHBOARD_FILTER_LABELS[option]).toBeTruthy();
    }
  });

  it("spells out that 'open' is not an exact status match", () => {
    expect(DASHBOARD_FILTER_LABELS.open).toContain("not closed");
  });
});
