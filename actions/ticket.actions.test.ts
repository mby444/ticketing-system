import { beforeEach, describe, expect, it, vi } from "vitest";
import { form, makeTicket, makeUser } from "@/test-utils/factories";

/**
 * Server-side authorization + side-effect contract for the ticket actions.
 *
 * These are the matrices that used to be one-off HTTP harnesses. The point of
 * mocking is that every branch below runs in-process: the assertions are about
 * what the action decided (writes, published jobs, revalidated paths), not
 * about a response code.
 */

// vi.mock factories are hoisted above the imports, so everything they close
// over has to be produced by vi.hoisted. Note the *async* form: a hoisted
// factory runs before imports are initialised, so it cannot call
// createPrismaMock() synchronously (that hits the temporal dead zone). The
// dynamic import inside the factory is what makes the shared helper usable.
const { prisma } = await vi.hoisted(async () => {
  const { createPrismaMock } = await import("@/test-utils/prisma-mock");
  return { prisma: createPrismaMock() };
});
const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const { publishJob } = vi.hoisted(() => ({ publishJob: vi.fn() }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
const { uploadAttachment, destroyAsset, validateAttachmentFile } = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
  destroyAsset: vi.fn(),
  validateAttachmentFile: vi.fn(() => null),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/qstash", () => ({ publishJob }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/utils/sentry", () => ({ logEvent }));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  MAX_FILES: 5,
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  validateAttachmentFile,
  uploadAttachment,
  destroyAsset,
}));

import { addTicketComment, assignTicket } from "@/actions/ticket.actions";

const OWNER = "owner-1";
const AGENT = "agent-1";
const OTHER_AGENT = "agent-2";

const client = makeUser({ id: OWNER, role: "CLIENT", email: "owner@example.com" });
const agent = makeUser({ id: AGENT, role: "SUPPORT_AGENT" });

const initial = { success: false, message: "" };

const commentForm = (over: Record<string, string | File> = {}) =>
  form({ ticketId: "1", body: "hello", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  validateAttachmentFile.mockReturnValue(null);
  // Default happy-path DB reads; individual tests override these.
  getCurrentUser.mockResolvedValue(client);
  prisma.ticket.findUnique.mockResolvedValue(makeTicket({ userId: OWNER, status: "Open" }));
  prisma.ticketComment.create.mockResolvedValue({ id: 900, body: "hello" });
  prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
});

/** Asserts an action refused *and* touched nothing. */
const expectNoSideEffects = () => {
  expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  expect(prisma.ticket.update).not.toHaveBeenCalled();
  expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  expect(publishJob).not.toHaveBeenCalled();
};

describe("addTicketComment — validation", () => {
  it("rejects an anonymous caller", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(addTicketComment(initial, commentForm())).resolves.toEqual({
      success: false,
      message: "You must be logged in to comment",
    });
    expectNoSideEffects();
  });

  it("requires a ticket id", async () => {
    const res = await addTicketComment(initial, form({ body: "hi" }));
    expect(res.message).toBe("Ticket ID is required");
    expectNoSideEffects();
  });

  it("rejects a non-numeric ticket id", async () => {
    const res = await addTicketComment(initial, commentForm({ ticketId: "abc" }));
    expect(res.message).toBe("Ticket ID is required");
    expectNoSideEffects();
  });

  it("rejects a whitespace-only body", async () => {
    const res = await addTicketComment(initial, commentForm({ body: "   \n\t " }));
    expect(res.message).toBe("Comment cannot be empty");
    expectNoSideEffects();
  });

  it("rejects a body over the limit", async () => {
    const res = await addTicketComment(
      initial,
      commentForm({ body: "x".repeat(5001) }),
    );
    expect(res.message).toBe("Comments are limited to 5000 characters");
    expectNoSideEffects();
  });

  it("reports a missing ticket", async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    const res = await addTicketComment(initial, commentForm());
    expect(res.message).toBe("Ticket not found");
    expectNoSideEffects();
  });
});

describe("addTicketComment — authorization", () => {
  it("denies a CLIENT somebody else's ticket", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: "somebody-else", status: "Open" }),
    );

    const res = await addTicketComment(initial, commentForm());

    expect(res.message).toBe("You are not allowed to comment on this ticket");
    expectNoSideEffects();
  });

  it.each(["SUPPORT_AGENT", "ADMIN"] as const)(
    "lets %s comment on any ticket",
    async (role) => {
      getCurrentUser.mockResolvedValue(makeUser({ id: "staff-1", role }));
      prisma.ticket.findUnique.mockResolvedValue(
        makeTicket({ userId: "somebody-else", status: "In_Progress" }),
      );

      const res = await addTicketComment(initial, commentForm());

      expect(res).toEqual({ success: true, message: "Comment posted" });
      expect(prisma.ticketComment.create).toHaveBeenCalledOnce();
    },
  );

  it.each(["CLIENT", "SUPPORT_AGENT", "ADMIN"] as const)(
    "refuses a comment on a Closed ticket for %s",
    async (role) => {
      getCurrentUser.mockResolvedValue(
        makeUser({ id: role === "CLIENT" ? OWNER : "staff-1", role }),
      );
      prisma.ticket.findUnique.mockResolvedValue(
        makeTicket({ userId: OWNER, status: "Closed" }),
      );

      const res = await addTicketComment(initial, commentForm());

      expect(res.message).toBe(
        "This ticket is closed — no new comments can be added",
      );
      expectNoSideEffects();
    },
  );
});

describe("addTicketComment — side effects", () => {
  it("creates the comment and publishes one NEW_COMMENT job for a client", async () => {
    const res = await addTicketComment(initial, commentForm());

    expect(res).toEqual({ success: true, message: "Comment posted" });
    expect(prisma.ticketComment.create).toHaveBeenCalledWith({
      data: { body: "hello", ticketId: 1, userId: OWNER },
    });
    expect(publishJob).toHaveBeenCalledExactlyOnceWith({
      type: "NEW_COMMENT",
      ticketId: 1,
      commentId: 900,
    });
  });

  it("does not bump status for a client reply", async () => {
    await addTicketComment(initial, commentForm());

    expect(prisma.ticket.update).not.toHaveBeenCalled();
    // No STATUS_UPDATED job either.
    expect(publishJob).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "NEW_COMMENT" }),
    );
  });

  it("bumps Open -> In_Progress when staff reply, and tells the owner", async () => {
    getCurrentUser.mockResolvedValue(agent);

    await addTicketComment(initial, commentForm());

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "In_Progress" },
    });
    expect(publishJob).toHaveBeenCalledWith({
      type: "NEW_COMMENT",
      ticketId: 1,
      commentId: 900,
    });
    expect(publishJob).toHaveBeenCalledWith({
      type: "STATUS_UPDATED",
      ticketId: 1,
      newStatus: "In_Progress",
    });
  });

  it("does not re-bump a ticket that is already In_Progress", async () => {
    getCurrentUser.mockResolvedValue(agent);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: "somebody-else", status: "In_Progress" }),
    );

    await addTicketComment(initial, commentForm());

    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(publishJob).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: "NEW_COMMENT" }),
    );
  });

  it("revalidates every path the UI reads", async () => {
    await addTicketComment(initial, commentForm());

    expect(revalidatePath).toHaveBeenCalledWith("/tickets");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    // Without this one the detail page keeps showing the stale thread.
    expect(revalidatePath).toHaveBeenCalledWith("/tickets/[id]", "page");
  });

  it("never sends the comment body to Sentry", async () => {
    await addTicketComment(
      initial,
      commentForm({ body: "my card number is 4111 1111 1111 1111" }),
    );

    // Assert the logger actually ran first. Without this, a regression that
    // stopped calling logEvent entirely would make the loop below pass
    // vacuously — the privacy guarantee would look intact while being
    // completely unverified.
    expect(logEvent).toHaveBeenCalled();
    expect(
      logEvent.mock.calls.some((call) =>
        JSON.stringify(call).includes("bodyLength"),
      ),
    ).toBe(true);

    for (const call of logEvent.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("4111");
    }
  });

  it("reports failure and writes nothing when the insert throws", async () => {
    prisma.ticketComment.create.mockRejectedValue(new Error("db down"));

    const res = await addTicketComment(initial, commentForm());

    expect(res).toEqual({ success: false, message: "Failed to post your comment" });
    expect(publishJob).not.toHaveBeenCalled();
  });
});

describe("assignTicket — authorization", () => {
  const assignForm = (assigneeId: string) =>
    form({ ticketId: "1", assigneeId });

  it("refuses a non-staff caller", async () => {
    getCurrentUser.mockResolvedValue(client);

    const res = await assignTicket(initial, assignForm(AGENT));

    expect(res.message).toBe("Only staff can assign tickets");
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("refuses to assign to a non-staff user", async () => {
    getCurrentUser.mockResolvedValue(agent);
    prisma.user.findUnique.mockResolvedValue({ id: OWNER, role: "CLIENT" });

    const res = await assignTicket(initial, assignForm(OWNER));

    expect(res.message).toBe("Cannot assign to this user");
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("reports a missing ticket", async () => {
    getCurrentUser.mockResolvedValue(agent);
    prisma.user.findUnique.mockResolvedValue({ id: AGENT, role: "SUPPORT_AGENT" });
    prisma.ticket.findUnique.mockResolvedValue(null);

    const res = await assignTicket(initial, assignForm(AGENT));

    expect(res.message).toBe("Ticket not found");
    expect(publishJob).not.toHaveBeenCalled();
  });
});

describe("assignTicket — notifications", () => {
  const assignForm = (assigneeId: string) =>
    form({ ticketId: "1", assigneeId });

  beforeEach(() => {
    getCurrentUser.mockResolvedValue(agent);
    prisma.user.findUnique.mockResolvedValue({ id: AGENT, role: "SUPPORT_AGENT" });
  });

  it("publishes one deduplicated job on a fresh assignment", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: null }),
    );

    const res = await assignTicket(initial, assignForm(AGENT));

    expect(res.message).toBe("Ticket assigned");
    expect(publishJob).toHaveBeenCalledExactlyOnceWith(
      { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT },
      { deduplicationId: `assigned_1_${AGENT}` },
    );
  });

  it("publishes both sides on a reassignment", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: OTHER_AGENT }),
    );
    prisma.user.findUnique.mockResolvedValue({ id: AGENT, role: "SUPPORT_AGENT" });

    await assignTicket(initial, assignForm(AGENT));

    expect(publishJob).toHaveBeenCalledTimes(2);
    expect(publishJob).toHaveBeenCalledWith(
      { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT },
      { deduplicationId: `assigned_1_${AGENT}` },
    );
    expect(publishJob).toHaveBeenCalledWith(
      { type: "TICKET_UNASSIGNED", ticketId: 1, previousAssigneeId: OTHER_AGENT },
      { deduplicationId: `unassigned_1_${OTHER_AGENT}` },
    );
  });

  it("publishes a TICKET_UNASSIGNED job when the select is cleared", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: AGENT }),
    );

    const res = await assignTicket(initial, assignForm(""));

    expect(res.message).toBe("Ticket unassigned");
    expect(publishJob).toHaveBeenCalledExactlyOnceWith(
      { type: "TICKET_UNASSIGNED", ticketId: 1, previousAssigneeId: AGENT },
      { deduplicationId: `unassigned_1_${AGENT}` },
    );
  });

  it("publishes nothing when the assignment is unchanged", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: AGENT }),
    );

    await assignTicket(initial, assignForm(AGENT));
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("publishes nothing when an unassigned ticket is cleared again", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: null }),
    );

    await assignTicket(initial, assignForm(""));
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("does not branch on the outcome of the enqueue", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: null }),
    );
    // publishJob is best-effort by contract: it resolves even when QStash is
    // down (it swallows the failure and reports it to Sentry). The action must
    // therefore never inspect its result. The swallow itself is covered in
    // lib/qstash.test.ts — asserting it here would only test the mock.
    publishJob.mockResolvedValue(undefined);

    await expect(assignTicket(initial, assignForm(AGENT))).resolves.toEqual({
      success: true,
      message: "Ticket assigned",
    });
    expect(prisma.ticket.updateMany).toHaveBeenCalledOnce();
  });

  it("revalidates the dashboard, the list and the detail page", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: null }),
    );

    await assignTicket(initial, assignForm(AGENT));

    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets/[id]", "page");
  });
});
