import { describe, expect, it, vi } from "vitest";

/**
 * The worker's payload gate.
 *
 * This exists because the gate failed *silently*. The previous `isValidJob`
 * checked `typeof job.ticketId === "number"` before switching on type, which
 * rejected every ticketless job — including PASSWORD_RESET_OTP — with a 200 and
 * a log line, so a valid message was dropped and the only symptom was a reset
 * code that never arrived.
 */

vi.mock("@upstash/qstash", () => ({ Receiver: vi.fn(function () { return { verify: vi.fn() }; }) }));
vi.mock("@/lib/email", () => ({ sendJobEmail: vi.fn() }));
vi.mock("@/utils/sentry", () => ({ logEvent: vi.fn() }));

import { isValidJob } from "@/app/api/jobs/send-email/route";

describe("isValidJob — ticketless jobs", () => {
  it("accepts PASSWORD_RESET_OTP", () => {
    expect(
      isValidJob({ type: "PASSWORD_RESET_OTP", userId: "user-1", otpId: "otp-1" }),
    ).toBe(true);
  });

  it("rejects it without a userId", () => {
    expect(isValidJob({ type: "PASSWORD_RESET_OTP", otpId: "otp-1" })).toBe(false);
  });

  it("rejects it without an otpId", () => {
    expect(isValidJob({ type: "PASSWORD_RESET_OTP", userId: "user-1" })).toBe(false);
  });

  it("does not require a ticketId", () => {
    // The regression that motivated this whole file. A shared ticketId
    // precondition before the switch would make this payload invalid.
    expect(
      isValidJob({ type: "PASSWORD_RESET_OTP", userId: "u", otpId: "o" }),
    ).toBe(true);
    // And the shape itself genuinely carries no ticket.
    expect(
      "ticketId" in { type: "PASSWORD_RESET_OTP", userId: "u", otpId: "o" },
    ).toBe(false);
  });
});

describe("isValidJob — ticket-scoped jobs still validate their own fields", () => {
  it("accepts a well-formed TICKET_CREATED", () => {
    expect(isValidJob({ type: "TICKET_CREATED", ticketId: 72 })).toBe(true);
  });

  it("rejects TICKET_CREATED with a non-numeric ticketId", () => {
    // Per-type checks replace the shared precondition, so each arm has to keep
    // doing its own job.
    expect(isValidJob({ type: "TICKET_CREATED", ticketId: "72" })).toBe(false);
  });

  it("requires newStatus on STATUS_UPDATED", () => {
    expect(isValidJob({ type: "STATUS_UPDATED", ticketId: 1 })).toBe(false);
    expect(
      isValidJob({ type: "STATUS_UPDATED", ticketId: 1, newStatus: "Closed" }),
    ).toBe(true);
  });

  it("requires commentId on NEW_COMMENT", () => {
    expect(isValidJob({ type: "NEW_COMMENT", ticketId: 1 })).toBe(false);
    expect(isValidJob({ type: "NEW_COMMENT", ticketId: 1, commentId: 5 })).toBe(
      true,
    );
  });

  it("requires assigneeId on TICKET_ASSIGNED", () => {
    expect(isValidJob({ type: "TICKET_ASSIGNED", ticketId: 1 })).toBe(false);
    expect(
      isValidJob({ type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: "u1" }),
    ).toBe(true);
  });

  it("requires previousAssigneeId on TICKET_UNASSIGNED", () => {
    expect(isValidJob({ type: "TICKET_UNASSIGNED", ticketId: 1 })).toBe(false);
    expect(
      isValidJob({
        type: "TICKET_UNASSIGNED",
        ticketId: 1,
        previousAssigneeId: "u1",
      }),
    ).toBe(true);
  });
});

describe("isValidJob — rejections", () => {
  it("rejects an unknown type", () => {
    expect(isValidJob({ type: "SOMETHING_NEW", ticketId: 1 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidJob(null)).toBe(false);
    expect(isValidJob("TICKET_CREATED")).toBe(false);
    expect(isValidJob(42)).toBe(false);
    expect(isValidJob(undefined)).toBe(false);
  });

  it("rejects a payload with no type at all", () => {
    expect(isValidJob({ ticketId: 1 })).toBe(false);
  });
});