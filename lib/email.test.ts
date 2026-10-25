import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Recipient resolution for every job type. This is the rule set that decides
 * who hears about what — and the one place where a mistake means emailing the
 * wrong person or nobody at all.
 */

// A single hoisted block rather than several: with one awaited hoisted call
// followed by sync ones, the ordering between them is easy to get wrong. One
// block has no ordering to get wrong.
const { prisma, send, logEvent } = await vi.hoisted(async () => {
  const { createPrismaMock } = await import("@/test-utils/prisma-mock");
  return { prisma: createPrismaMock(), send: vi.fn(), logEvent: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/utils/sentry", () => ({ logEvent }));
// `function`, not an arrow: lib/email.ts does `new Resend(...)` at module scope.
vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send } };
  }),
}));

import { sendJobEmail } from "@/lib/email";
import { encryptOtp } from "@/lib/otp";

const OWNER = { id: "owner-1", email: "owner@example.com" };

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 72,
  subject: "Broken dashboard",
  priority: "High",
  status: "Open",
  user: OWNER,
  assignedTo: null,
  ...over,
});

/** The address Resend was actually asked to deliver to. */
const recipient = (): string | undefined =>
  (send.mock.calls[0]?.[0] as { to?: string } | undefined)?.to;

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ data: { id: "resend-1" }, error: null });
  prisma.ticket.findUnique.mockResolvedValue(ticket());
  prisma.ticketComment.findUnique.mockResolvedValue({
    id: 5,
    body: "Any update?",
    user: { id: "agent-1", name: "Agent One", email: "agent1@example.com", role: "SUPPORT_AGENT" },
  });
  prisma.user.findUnique.mockResolvedValue({
    id: "agent-2",
    name: "Agent Two",
    email: "agent2@example.com",
  });
});

describe("sendJobEmail — recipient rules", () => {
  it("always sends TICKET_CREATED to the ticket owner", async () => {
    await sendJobEmail({ type: "TICKET_CREATED", ticketId: 72 });
    expect(recipient()).toBe(OWNER.email);
  });

  it("always sends STATUS_UPDATED to the ticket owner", async () => {
    await sendJobEmail({
      type: "STATUS_UPDATED",
      ticketId: 72,
      newStatus: "In_Progress",
    });
    expect(recipient()).toBe(OWNER.email);
  });

  it("sends a staff comment to the ticket owner", async () => {
    prisma.ticketComment.findUnique.mockResolvedValue({
      id: 5,
      body: "On it",
      user: { id: "agent-1", name: "Agent One", email: "agent1@example.com", role: "SUPPORT_AGENT" },
    });

    await sendJobEmail({ type: "NEW_COMMENT", ticketId: 72, commentId: 5 });
    expect(recipient()).toBe(OWNER.email);
  });

  it("sends a customer comment to the assignee", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({ assignedTo: { id: "agent-1", name: "Agent One", email: "agent1@example.com" } }),
    );
    prisma.ticketComment.findUnique.mockResolvedValue({
      id: 6,
      body: "Any news?",
      user: { id: OWNER.id, name: "Owner", email: OWNER.email, role: "CLIENT" },
    });

    await sendJobEmail({ type: "NEW_COMMENT", ticketId: 72, commentId: 6 });
    expect(recipient()).toBe("agent1@example.com");
  });

  it("skips a customer comment when nobody is assigned", async () => {
    prisma.ticketComment.findUnique.mockResolvedValue({
      id: 6,
      body: "Any news?",
      user: { id: OWNER.id, name: "Owner", email: OWNER.email, role: "CLIENT" },
    });

    await sendJobEmail({ type: "NEW_COMMENT", ticketId: 72, commentId: 6 });

    expect(send).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "Email job skipped: customer reply on an unassigned ticket",
      "email",
      expect.anything(),
      "warning",
    );
  });
});

describe("sendJobEmail — TICKET_ASSIGNED", () => {
  it("notifies the assignee", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({ assignedTo: { id: "agent-1", name: "Agent One", email: "agent1@example.com" } }),
    );

    await sendJobEmail({
      type: "TICKET_ASSIGNED",
      ticketId: 72,
      assigneeId: "agent-1",
    });
    expect(recipient()).toBe("agent1@example.com");
  });

  it("skips a stale job when the ticket has since been reassigned", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({ assignedTo: { id: "agent-2", name: "Agent Two", email: "agent2@example.com" } }),
    );

    await sendJobEmail({
      type: "TICKET_ASSIGNED",
      ticketId: 72,
      assigneeId: "agent-1",
    });

    expect(send).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "Email job skipped: ticket has since been reassigned",
      "email",
      expect.anything(),
      "warning",
    );
  });

  it("skips when the ticket is unassigned by the time the job runs", async () => {
    await sendJobEmail({
      type: "TICKET_ASSIGNED",
      ticketId: 72,
      assigneeId: "agent-1",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when the assignee owns the ticket", async () => {
    // Admin assigning a ticket they own to themselves: nobody to tell.
    prisma.ticket.findUnique.mockResolvedValue(
      ticket({
        user: { id: "admin-1", email: "admin@example.com" },
        assignedTo: { id: "admin-1", name: "Admin", email: "admin@example.com" },
      }),
    );

    await sendJobEmail({
      type: "TICKET_ASSIGNED",
      ticketId: 72,
      assigneeId: "admin-1",
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendJobEmail — TICKET_UNASSIGNED", () => {
  it("notifies the former assignee", async () => {
    await sendJobEmail({
      type: "TICKET_UNASSIGNED",
      ticketId: 72,
      previousAssigneeId: "agent-2",
    });
    expect(recipient()).toBe("agent2@example.com");
  });

  it("skips when the former assignee no longer exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await sendJobEmail({
      type: "TICKET_UNASSIGNED",
      ticketId: 72,
      previousAssigneeId: "ghost",
    });

    expect(send).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      "Email job skipped: previous assignee is gone or owns the ticket",
      "email",
      expect.anything(),
      "warning",
    );
  });

  it("skips when the former assignee owns the ticket", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: OWNER.id,
      name: "Owner",
      email: OWNER.email,
    });

    await sendJobEmail({
      type: "TICKET_UNASSIGNED",
      ticketId: 72,
      previousAssigneeId: OWNER.id,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendJobEmail — permanent failures", () => {
  it("acknowledges silently when the ticket is gone", async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    await sendJobEmail({ type: "TICKET_CREATED", ticketId: 999 });
    expect(send).not.toHaveBeenCalled();
  });

  it("acknowledges silently when the comment is gone", async () => {
    prisma.ticketComment.findUnique.mockResolvedValue(null);

    await sendJobEmail({ type: "NEW_COMMENT", ticketId: 72, commentId: 999 });
    expect(send).not.toHaveBeenCalled();
  });

  it("throws when Resend reports an error, so QStash retries", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field" },
    });

    await expect(sendJobEmail({ type: "TICKET_CREATED", ticketId: 72 })).rejects.toThrow(
      /Resend send failed \[validation_error\]/,
    );
  });
});

describe("sendJobEmail — PASSWORD_RESET_OTP", () => {
  const OTP_USER = { id: "user-1", email: "user1@example.com", name: "User One" };
  const CODE = "123456";

  const otpJob = { type: "PASSWORD_RESET_OTP" as const, userId: "user-1", otpId: "otp-1" };

  const liveOtp = (over: Record<string, unknown> = {}) => ({
    id: "otp-1",
    userId: "user-1",
    codeEncrypted: encryptOtp(CODE)!,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    attempts: 0,
    ...over,
  });

  it("sends the code to the address the payload resolves to", async () => {
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp());

    await sendJobEmail(otpJob);
    expect(recipient()).toBe(OTP_USER.email);
  });

  it("never looks up a ticket", async () => {
    // The job has no ticketId. A ticket lookup here would read `undefined` and,
    // under the old isValidJob shape, the message would have been rejected as
    // malformed before it ever arrived here.
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp());

    await sendJobEmail(otpJob);
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("renders the decrypted code into the email", async () => {
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp());

    await sendJobEmail(otpJob);
    const [arg] = send.mock.calls[0] as [{ react: unknown }];
    // Walking the tree is what proves the recovered code reached the template;
    // asserting on the element's props alone would not catch a template that
    // ignored it.
    expect(JSON.stringify(arg.react)).toContain(CODE);
  });

  it("acknowledges silently when the code row is gone", async () => {
    // This is exactly what a used or swept code looks like on a QStash retry.
    // Retrying would re-send a dead credential five times.
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(null);

    await sendJobEmail(otpJob);
    expect(send).not.toHaveBeenCalled();
  });

  it("acknowledges silently when the user is gone", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp());

    await sendJobEmail(otpJob);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a row belonging to a different user", async () => {
    // Guards against a payload that pairs one user's id with another's code.
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp({ userId: "user-2" }));

    await sendJobEmail(otpJob);
    expect(send).not.toHaveBeenCalled();
  });

  it("acknowledges silently when the code expired before delivery", async () => {
    // A dead code emailed to a waiting user is worse than silence.
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(
      liveOtp({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    await sendJobEmail(otpJob);
    expect(send).not.toHaveBeenCalled();
  });

  it("acknowledges silently when the code cannot be decrypted", async () => {
    // A row from before an AUTH_SECRET rotation. Permanent, so returning rather
    // than throwing stops QStash retrying five times against an unfixable row.
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(
      liveOtp({ codeEncrypted: "iv:tag:data" }),
    );

    await sendJobEmail(otpJob);
    expect(send).not.toHaveBeenCalled();
  });

  it("never logs the code", async () => {
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp());

    await sendJobEmail(otpJob);
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain(CODE);
  });

  it("throws when Resend rejects it, so QStash retries", async () => {
    prisma.user.findUnique.mockResolvedValue(OTP_USER);
    prisma.passwordResetOtp.findUnique.mockResolvedValue(liveOtp());
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field" },
    });

    await expect(sendJobEmail(otpJob)).rejects.toThrow(/validation_error/);
  });
});
