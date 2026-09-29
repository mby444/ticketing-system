import { describe, expect, it } from "vitest";
import { getPriorityClass, getStatusClass } from "@/utils/ui";
import { formatStatus } from "@/utils/string-format";

/**
 * These are `switch` statements with no `default`, so TypeScript infers
 * `string | undefined` and an unrecognised value silently returns undefined.
 * That is exactly the shape of RBAC #6 (`priority` is still a `String` and the
 * seed can produce "Critical"), so it is pinned here rather than fixed.
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

describe("getPriorityClass — known gap (RBAC #6)", () => {
  it("styles Low, Medium and High", () => {
    expect(getPriorityClass("Low")).toBeTruthy();
    expect(getPriorityClass("Medium")).toBeTruthy();
    expect(getPriorityClass("High")).toBeTruthy();
  });

  it("has no style for Critical, which the seed can produce", () => {
    // Not a todo: this documents the *current* broken behaviour so that fixing
    // RBAC #6 is a deliberate, visible test change rather than a silent one.
    expect(getPriorityClass("Critical")).toBeUndefined();
  });
});
