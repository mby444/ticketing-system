import { describe, expect, it } from "vitest";
import {
  ALL_DASHBOARD_SORTS,
  buildDashboardHref,
  DASHBOARD_SORT_FIELDS,
  DASHBOARD_SORT_INITIAL_DIRECTION,
  DASHBOARD_SORT_LABELS,
  DEFAULT_DASHBOARD_SORT,
  isAscending,
  nextSortFor,
  parseDashboardSort,
  PRIORITY_ORDER,
  sortDashboardTickets,
  sortFieldOf,
  STATUS_ORDER,
  type SortableTicket,
} from "@/lib/dashboard-sort";
import {
  DASHBOARD_FILTERS,
  DEFAULT_DASHBOARD_FILTER,
} from "@/lib/dashboard-filters";
import { PRIORITY_OPTIONS } from "@/lib/priority";
import {
  TicketPriority,
  TicketStatus,
} from "@/generated/prisma/client";

/**
 * `?sort=` is user-controlled, so the whitelist and its fallbacks are the
 * security-relevant part; the rest pins the ordering semantics so a future
 * "simplification" cannot quietly change what a sort means — in particular the
 * two properties `sortDashboardTickets` is documented to never lose.
 */

let nextId = 1;
const ticket = (over: Partial<SortableTicket> = {}): SortableTicket => ({
  id: nextId++,
  status: "Open" as TicketStatus,
  priority: "Medium" as TicketPriority,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  user: { name: "User" },
  assignedTo: { name: "Agent" },
  ...over,
});

const ids = (tickets: SortableTicket[]) => tickets.map((t) => t.id);

describe("parseDashboardSort", () => {
  it("falls back to the default for a missing value", () => {
    expect(parseDashboardSort(undefined)).toBe(DEFAULT_DASHBOARD_SORT);
  });

  it("accepts every advertised sort", () => {
    for (const option of ALL_DASHBOARD_SORTS) {
      expect(parseDashboardSort(option)).toBe(option);
    }
  });

  it("falls back rather than throwing on junk", () => {
    expect(parseDashboardSort("bogus")).toBe(DEFAULT_DASHBOARD_SORT);
    expect(parseDashboardSort("")).toBe(DEFAULT_DASHBOARD_SORT);
    expect(parseDashboardSort("'; DROP TABLE")).toBe(DEFAULT_DASHBOARD_SORT);
    // A field name without a direction, or with an unknown one.
    expect(parseDashboardSort("status")).toBe(DEFAULT_DASHBOARD_SORT);
    expect(parseDashboardSort("status_sideways")).toBe(DEFAULT_DASHBOARD_SORT);
    // A real field paired with a real direction that is not its own.
    expect(parseDashboardSort("status_priority_desc")).toBe(DEFAULT_DASHBOARD_SORT);
  });

  it("is case sensitive, so a typo does not silently match", () => {
    expect(parseDashboardSort("STATUS_ASC")).toBe(DEFAULT_DASHBOARD_SORT);
    expect(parseDashboardSort("Created_Desc")).toBe(DEFAULT_DASHBOARD_SORT);
  });

  it("rejects an unknown column", () => {
    expect(parseDashboardSort("subject_asc")).toBe(DEFAULT_DASHBOARD_SORT);
    expect(parseDashboardSort("updated_desc")).toBe(DEFAULT_DASHBOARD_SORT);
  });

  it("uses the first value of a repeated parameter and ignores a bad first", () => {
    expect(parseDashboardSort(["priority_desc", "status_asc"])).toBe("priority_desc");
    expect(parseDashboardSort(["bogus", "priority_desc"])).toBe(DEFAULT_DASHBOARD_SORT);
  });

  it("advertises exactly two options per column, each with a label", () => {
    expect(ALL_DASHBOARD_SORTS).toHaveLength(DASHBOARD_SORT_FIELDS.length * 2);
    for (const option of ALL_DASHBOARD_SORTS) {
      expect(DASHBOARD_SORT_LABELS[option]).toBeTruthy();
    }
    expect(new Set(ALL_DASHBOARD_SORTS).size).toBe(ALL_DASHBOARD_SORTS.length);
  });
});

describe("sort field and direction helpers", () => {
  it("splits every option into field and direction", () => {
    for (const option of ALL_DASHBOARD_SORTS) {
      expect(DASHBOARD_SORT_FIELDS).toContain(sortFieldOf(option));
      expect(isAscending(option)).toBe(option.endsWith("_asc"));
    }
  });

  it("starts each column in its triage-friendly direction", () => {
    // Most severe first, workflow order, newest first, then A-Z.
    expect(DASHBOARD_SORT_INITIAL_DIRECTION.priority).toBe("desc");
    expect(DASHBOARD_SORT_INITIAL_DIRECTION.status).toBe("asc");
    expect(DASHBOARD_SORT_INITIAL_DIRECTION.created).toBe("desc");
    expect(DASHBOARD_SORT_INITIAL_DIRECTION.assignee).toBe("asc");
    expect(DASHBOARD_SORT_INITIAL_DIRECTION.requester).toBe("asc");
  });
});

describe("nextSortFor", () => {
  it("reverses the active column", () => {
    expect(nextSortFor("status", "status_asc")).toBe("status_desc");
    expect(nextSortFor("status", "status_desc")).toBe("status_asc");
    expect(nextSortFor("created", "created_asc")).toBe("created_desc");
  });

  it("starts a different column in its initial direction", () => {
    expect(nextSortFor("priority", "status_asc")).toBe("priority_desc");
    expect(nextSortFor("assignee", "priority_asc")).toBe("assignee_asc");
    expect(nextSortFor("status", "created_desc")).toBe("status_asc");
  });

  it("always returns a valid option", () => {
    for (const field of DASHBOARD_SORT_FIELDS) {
      for (const current of ALL_DASHBOARD_SORTS) {
        expect(ALL_DASHBOARD_SORTS).toContain(nextSortFor(field, current));
      }
    }
  });
});

describe("explicit orders", () => {
  it("lists the workflow in the order active-first meant", () => {
    expect([...STATUS_ORDER]).toEqual([
      "Open",
      "In_Progress",
      "Resolved",
      "Closed",
    ]);
  });

  it("reuses the form's priority order, so _desc is most severe first", () => {
    // An earlier draft listed it most-severe-first, which made `priority_desc`
    // put Low on top: `asc`/`desc` are applied mechanically to the declared order.
    expect([...PRIORITY_ORDER]).toEqual(["Low", "Medium", "High", "Critical"]);
    expect(PRIORITY_ORDER).toBe(PRIORITY_OPTIONS);
  });

  it("covers the enums exactly", () => {
    expect(new Set(STATUS_ORDER)).toEqual(new Set(Object.values(TicketStatus)));
    expect(new Set(PRIORITY_ORDER)).toEqual(new Set(Object.values(TicketPriority)));
  });
});

describe("sortDashboardTickets", () => {
  it("never mutates the array it was given", () => {
    // The page shares one array across filtered/mine/others and the chip counts,
    // so an in-place sort would corrupt the other views.
    const a = ticket({ status: "Closed", priority: "Low" });
    const b = ticket({ status: "Open", priority: "Critical" });
    const input = [a, b];
    const snapshot = [...input];

    sortDashboardTickets(input, "priority_desc");

    expect(input).toEqual(snapshot);
    expect(ids(input)).toEqual(ids(snapshot));
  });

  it("returns a new array even when nothing needs reordering", () => {
    const input = [ticket()];
    expect(sortDashboardTickets(input, "status_asc")).not.toBe(input);
  });

  it("puts Open before Closed by default", () => {
    const closed = ticket({ status: "Closed" });
    const inProgress = ticket({ status: "In_Progress" });
    const open = ticket({ status: "Open" });
    const sorted = sortDashboardTickets([closed, inProgress, open], "status_asc");

    expect(sorted.map((t) => t.status)).toEqual([
      "Open",
      "In_Progress",
      "Closed",
    ]);
  });

  it("reverses the workflow order on status_desc", () => {
    const open = ticket({ status: "Open" });
    const closed = ticket({ status: "Closed" });
    const sorted = sortDashboardTickets([open, closed], "status_desc");

    expect(sorted.map((t) => t.status)).toEqual(["Closed", "Open"]);
  });

  it("puts Critical above Low on priority_desc", () => {
    const low = ticket({ priority: "Low" });
    const critical = ticket({ priority: "Critical" });
    const medium = ticket({ priority: "Medium" });

    expect(
      sortDashboardTickets([low, medium, critical], "priority_desc").map(
        (t) => t.priority,
      ),
    ).toEqual(["Critical", "Medium", "Low"]);
  });

  it("sorts newest and oldest first by createdAt", () => {
    const older = ticket({ createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = ticket({ createdAt: new Date("2026-06-01T00:00:00Z") });

    expect(
      ids(sortDashboardTickets([older, newer], "created_desc")),
    ).toEqual([newer.id, older.id]);
    expect(
      ids(sortDashboardTickets([older, newer], "created_asc")),
    ).toEqual([older.id, newer.id]);
  });

  it("produces a total order even when every sort key ties", () => {
    // The `id` tie-break is what stops two equally-prioritised tickets swapping
    // between renders.
    const a = ticket({ priority: "High" });
    const b = ticket({ priority: "High" });
    const c = ticket({ priority: "High" });
    const input = [c, a, b];

    const once = ids(sortDashboardTickets(input, "priority_desc"));
    const twice = ids(sortDashboardTickets([...input].reverse(), "priority_desc"));

    expect(once).toEqual([a.id, b.id, c.id]);
    // Same set, same order, regardless of the input order.
    expect(twice).toEqual(once);
  });

  it("breaks ties on recency within the same primary key", () => {
    const older = ticket({
      priority: "High",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = ticket({
      priority: "High",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });

    expect(
      ids(sortDashboardTickets([older, newer], "priority_desc")),
    ).toEqual([newer.id, older.id]);
  });

  it("sorts numeric names naturally, not lexicographically", () => {
    // Plain `<` puts "User Ke-10" before "User Ke-2", which is exactly what the
    // seeded requester names would do.
    const ten = ticket({ user: { name: "User Ke-10" } });
    const two = ticket({ user: { name: "User Ke-2" } });

    expect(ids(sortDashboardTickets([ten, two], "requester_asc"))).toEqual([
      two.id,
      ten.id,
    ]);
  });

  it("is case insensitive for names", () => {
    const upper = ticket({ assignedTo: { name: "anna" } });
    const lower = ticket({ assignedTo: { name: "Bob" } });

    expect(ids(sortDashboardTickets([lower, upper], "assignee_asc"))).toEqual([
      upper.id,
      lower.id,
    ]);
  });

  it("keeps unassigned tickets last in BOTH directions", () => {
    const assigned = ticket({ assignedTo: { name: "Agent Z" } });
    const unassigned = ticket({ assignedTo: null });

    // Ascending: unassigned would come first if nulls sorted naturally.
    expect(ids(sortDashboardTickets([unassigned, assigned], "assignee_asc"))).toEqual([
      assigned.id,
      unassigned.id,
    ]);
    // Descending: unassigned must stay last rather than jump to the front.
    expect(ids(sortDashboardTickets([assigned, unassigned], "assignee_desc"))).toEqual([
      assigned.id,
      unassigned.id,
    ]);
  });

  it("keeps a null requester name last in BOTH directions", () => {
    const named = ticket({ user: { name: "Zeta" } });
    const anonymous = ticket({ user: { name: null } });

    for (const sort of ["requester_asc", "requester_desc"] as const) {
      expect(ids(sortDashboardTickets([anonymous, named], sort))).toEqual([
        named.id,
        anonymous.id,
      ]);
    }
  });

  it("is deterministic across repeated runs", () => {
    const input = [
      ticket({ status: "Open", priority: "Low", createdAt: new Date("2026-03-01Z") }),
      ticket({ status: "Open", priority: "High", createdAt: new Date("2026-02-01Z") }),
      ticket({ status: "Closed", priority: "Critical", createdAt: new Date("2026-05-01Z") }),
    ];
    const first = ids(sortDashboardTickets(input, "status_asc"));
    for (let i = 0; i < 5; i++) {
      expect(ids(sortDashboardTickets(input, "status_asc"))).toEqual(first);
    }
  });

  it("handles an empty list", () => {
    expect(sortDashboardTickets([], "priority_desc")).toEqual([]);
  });

  it("handles a single ticket", () => {
    const only = ticket();
    expect(ids(sortDashboardTickets([only], "created_asc"))).toEqual([only.id]);
  });

  it("returns the same order for the whole option set", () => {
    const input = [
      ticket({ status: "Resolved", priority: "Low" }),
      ticket({ status: "Open", priority: "Critical" }),
      ticket({ status: "Closed", priority: "High" }),
      ticket({ status: "In_Progress", priority: "Medium" }),
    ];
    for (const sort of ALL_DASHBOARD_SORTS) {
      const sorted = sortDashboardTickets(input, sort);
      expect(sorted).toHaveLength(input.length);
      expect(new Set(ids(sorted)).size).toBe(input.length);
    }
  });
});

describe("buildDashboardHref", () => {
  it("is a bare /dashboard when both values are default", () => {
    expect(buildDashboardHref()).toBe("/dashboard");
    expect(buildDashboardHref({})).toBe("/dashboard");
    expect(
      buildDashboardHref({
        filter: DEFAULT_DASHBOARD_FILTER,
        sort: DEFAULT_DASHBOARD_SORT,
      }),
    ).toBe("/dashboard");
  });

  it("omits a default value and keeps a non-default one", () => {
    expect(buildDashboardHref({ filter: "unassigned" })).toBe(
      "/dashboard?filter=unassigned",
    );
    expect(buildDashboardHref({ sort: "priority_desc" })).toBe(
      "/dashboard?sort=priority_desc",
    );
  });

  it("keeps BOTH values when both are non-default", () => {
    const href = buildDashboardHref({ filter: "mine", sort: "created_asc" });
    expect(href).toContain("filter=mine");
    expect(href).toContain("sort=created_asc");
  });

  it("is stable enough to survive a click on either control", () => {
    // This is the regression that motivates the helper: FilterNav hardcoded its
    // own hrefs, so clicking a filter chip silently dropped the active sort.
    const withSort = buildDashboardHref({ filter: "open", sort: "assignee_desc" });
    const afterFilterClick = new URL(withSort, "http://x");
    expect(afterFilterClick.searchParams.get("sort")).toBe("assignee_desc");

    const withFilter = buildDashboardHref({ filter: "mine", sort: "status_desc" });
    const afterHeaderClick = new URL(withFilter, "http://x");
    expect(afterHeaderClick.searchParams.get("filter")).toBe("mine");
  });

  it("round-trips through parse for every combination", () => {
    for (const filter of DASHBOARD_FILTERS) {
      for (const sort of ALL_DASHBOARD_SORTS) {
        const url = new URL(buildDashboardHref({ filter, sort }), "http://x");
        // `searchParams.get` returns null for an omitted key, which is the real
        // shape the page receives, so an omitted default is asserted here too.
        const raw = url.searchParams.get("sort") ?? undefined;
        expect(parseDashboardSort(raw)).toBe(sort);
      }
    }
  });

  it("only ever emits values from the whitelists", () => {
    const href = buildDashboardHref({
      filter: "open",
      sort: "priority_asc",
    });
    const url = new URL(href, "http://x");
    expect(DASHBOARD_FILTERS).toContain(url.searchParams.get("filter"));
    expect(ALL_DASHBOARD_SORTS).toContain(url.searchParams.get("sort"));
  });
});