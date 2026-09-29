import { describe, expect, it } from "vitest";
import { getPriorityClass, getStatusClass } from "@/utils/ui";
import { formatStatus } from "@/utils/string-format";
import { TicketPriority } from "@/generated/prisma/client";

/**
 * `getStatusClass` and `formatStatus` are still `switch` statements with no
 * `default` and a `string` parameter, so an unrecognised value silently yields
 * undefined — that remaining looseness is tracked as its own backlog item.
 * `getPriorityClass` no longer has the problem: its parameter is the
 * `TicketPriority` enum and a test below walks every enum value.
 */

describe("getStatusClass", () => {
  it.each([
    "Open",
    "In_Progress",
    "Resolved",
    "Closed",
  ] as const)("styles %s", (status) => {
    expect(getStatusClass(status)).toBeTruthy();
  });

  it("returns undefined for an unknown status", () => {
    expect(getStatusClass("Escalated")).toBeUndefined();
  });
});

describe("formatStatus", () => {
  it("humanises the enum for display", () => {
    expect(formatStatus("In_Progress")).toBe("In Progress");
  });

  it.each(["Open", "Resolved", "Closed"] as const)("passes %s through", (s) => {
    expect(formatStatus(s)).toBe(s);
  });
});

describe("getPriorityClass", () => {
  it("styles Low, Medium, High and Critical", () => {
    expect(getPriorityClass("Low")).toBeTruthy();
    expect(getPriorityClass("Medium")).toBeTruthy();
    expect(getPriorityClass("High")).toBeTruthy();
    expect(getPriorityClass("Critical")).toBeTruthy();
  });

  it("gives Critical a class distinct from High's", () => {
    // Critical used to fall through this switch and render unstyled, because
    // `priority` was a plain String with no enum to make it exhaustive.
    expect(getPriorityClass("Critical")).not.toBe(getPriorityClass("High"));
  });

  it("styles every value of the enum", () => {
    // The regression guard that was missing: if a fifth priority is ever added
    // to the enum and this switch is not updated, this fails.
    for (const value of Object.values(TicketPriority)) {
      expect(getPriorityClass(value), `${value} has no style`).toBeTruthy();
    }
  });
});
