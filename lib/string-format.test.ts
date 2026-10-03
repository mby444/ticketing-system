import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/string-format";

/**
 * Frozen clock: this helper is pure but reads "now", so the tests pin the
 * reference point rather than tolerating a slow run shifting a boundary.
 */
const NOW = new Date("2026-10-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("rounds down to whole units, so it never claims more time has passed", () => {
    // 90 minutes is one and a half hours; saying "2h ago" would be a lie for
    // someone comparing the badge against a clock.
    expect(formatRelativeTime(ago(90 * MINUTE), NOW)).toBe("1h ago");
    expect(formatRelativeTime(ago(59 * MINUTE), NOW)).toBe("59m ago");
  });

  it.each([
    ["under a minute", 30 * SECOND, "just now"],
    ["exactly a minute", MINUTE, "1m ago"],
    ["under an hour", 59 * MINUTE, "59m ago"],
    ["an hour", HOUR, "1h ago"],
    ["under a day", 23 * HOUR, "23h ago"],
    ["a day", DAY, "1d ago"],
    ["under a week", 6 * DAY, "6d ago"],
    ["a week", 7 * DAY, "1w ago"],
    ["weeks", 20 * DAY, "2w ago"],
    ["a month", 35 * DAY, "1mo ago"],
    ["months", 200 * DAY, "6mo ago"],
    ["a year", 400 * DAY, "1y ago"],
  ])("%s", (_label, ms, expected) => {
    expect(formatRelativeTime(ago(ms as number), NOW)).toBe(expected);
  });

  it("accepts a string as well as a Date", () => {
    // Server components hand over serialised values in some paths, and a string
    // that silently rendered "Invalid Date" would be hard to spot in a list.
    expect(formatRelativeTime(ago(2 * HOUR).toISOString(), NOW)).toBe("2h ago");
  });
});