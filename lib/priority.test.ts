import { describe, expect, it } from "vitest";
import { isTicketPriority, PRIORITY_OPTIONS } from "@/lib/priority";
import { TicketPriority } from "@/generated/prisma/client";

/**
 * PRIORITY_OPTIONS is hand-written so client components can import it without
 * dragging the generated Prisma client into the browser bundle. That trade is
 * only safe while a test guarantees the list and the enum stay identical — this
 * file is that guarantee.
 */

describe("PRIORITY_OPTIONS", () => {
  it("covers every value of the enum", () => {
    expect([...PRIORITY_OPTIONS].sort()).toEqual(
      Object.values(TicketPriority).sort(),
    );
  });

  it("has no duplicates", () => {
    expect(new Set(PRIORITY_OPTIONS).size).toBe(PRIORITY_OPTIONS.length);
  });

  it("keeps a sensible display order, lowest first", () => {
    expect(PRIORITY_OPTIONS).toEqual(["Low", "Medium", "High", "Critical"]);
  });
});

describe("isTicketPriority", () => {
  it.each(Object.values(TicketPriority))("accepts %s", (value) => {
    expect(isTicketPriority(value)).toBe(true);
  });

  it("rejects anything outside the enum", () => {
    // A plain loop rather than it.each: the mixed value/label tuples do not
    // type-check against Vitest's each signature, and this also puts the reason
    // into the failure message.
    const rejected: [unknown, string][] = [
      ["low", "wrong case"],
      ["Critical ", "trailing space"],
      ["", "empty"],
      ["Urgent", "unknown word"],
      [null, "null"],
      [undefined, "undefined"],
      [42, "number"],
      [["Low"], "array"],
      [{ toString: () => "Low" }, "object that stringifies to a valid value"],
    ];

    for (const [value, reason] of rejected) {
      expect(isTicketPriority(value), `${reason} should be rejected`).toBe(false);
    }
  });
});
