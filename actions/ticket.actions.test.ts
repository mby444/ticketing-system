import { beforeEach, describe, expect, it, vi } from "vitest";
import { form, makeFile, makeTicket, makeUser } from "@/test-utils/factories";

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
const { publishJob, publishNotificationJob } = vi.hoisted(() => ({
  publishJob: vi.fn(),
  publishNotificationJob: vi.fn(),
}));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
const { uploadAttachment, destroyAsset, validateAttachmentFile } = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
  destroyAsset: vi.fn(),
  // Typed as the real contract (an error message or null) rather than
  // `() => null`, which would make mockReturnValue of an error a type error.
  validateAttachmentFile: vi.fn<() => string | null>(() => null),
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/qstash", () => ({ publishJob, publishNotificationJob }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/utils/sentry", () => ({ logEvent }));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/cloudinary", () => ({
  MAX_FILES: 5,
  MAX_COMMENT_FILES: 5,
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  validateAttachmentFile,
  uploadAttachment,
  destroyAsset,
}));

import {
  addTicketComment,
  assignTicket,
  createTicket,
  deleteAttachment,
  deleteComment,
  deleteCommentAttachment,
} from "@/actions/ticket.actions";

const OWNER = "owner-1";
const AGENT = "agent-1";
const OTHER_AGENT = "agent-2";

const client = makeUser({ id: OWNER, role: "CLIENT", email: "owner@example.com" });
const agent = makeUser({ id: AGENT, role: "SUPPORT_AGENT" });

const initial = { success: false, message: "" };

const commentForm = (over: Record<string, string | File> = {}) =>
  form({ ticketId: "1", body: "hello", ...over });

const ticketForm = (over: Record<string, string | File> = {}) =>
  form({ subject: "Broken", description: "It broke", priority: "Low", ...over });

const ATT_ID = "att-1";
const COMMENT_ID = 900;

/** A row the delete actions can read: ownership is the whole permission story. */
const attachmentRow = (uploadedById: string) => ({
  id: ATT_ID,
  ticketId: 1,
  fileName: "shot.png",
  publicId: "quickticket/tickets/abc",
  resourceType: "image",
  uploadedById,
});

const commentRow = (userId: string, deletedAt: Date | null = null) => ({
  id: COMMENT_ID,
  ticketId: 1,
  userId,
  deletedAt,
});

/** What `uploadAttachment` resolves to, one per file. */
const uploadResult = (fileName: string) => ({
  fileName,
  mimeType: "image/png",
  size: 1024,
  url: `https://res.cloudinary.com/demo/${fileName}`,
  publicId: `quickticket/tickets/${fileName}`,
  resourceType: "image",
});

/**
 * A comment form with `count` distinct image files under the repeated
 * `attachments` key, which is what `<input multiple>` actually submits.
 */
const commentFormWithFiles = (count: number, body = "see attached") => {
  const files = Array.from({ length: count }, (_, i) =>
    makeFile(`shot-${i}.png`, "image/png"),
  );
  return form({ ticketId: "1", body, attachments: files });
};

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clear only wipes call history, so any
  // mockResolvedValue/mockRejectedValue set by a previous test survives and
  // silently poisons the next one. Defaults are re-established below, after
  // the reset.
  vi.resetAllMocks();
  validateAttachmentFile.mockReturnValue(null);
  uploadAttachment.mockResolvedValue({} as never);
  // destroyAsset is best-effort and never throws in production; the default has
  // to resolve so a single test that forces a rejection cannot leak.
  destroyAsset.mockResolvedValue(undefined);
  getCurrentUser.mockResolvedValue(client);
  prisma.ticket.findUnique.mockResolvedValue(makeTicket({ userId: OWNER, status: "Open", subject: "Test ticket" }));
  prisma.ticketComment.create.mockResolvedValue({ id: 900, body: "hello" });
  prisma.ticket.updateMany.mockResolvedValue({ count: 1 });
  prisma.user.findMany.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
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

describe("createTicket — priority validation", () => {
  // `priority` used to be read as `formData.get("priority") as string` and only
  // checked for truthiness, so any string could be written to the database.
  beforeEach(() => {
    prisma.ticket.create.mockResolvedValue({ id: 1 });
  });

  it.each(["Urgent", "low", "Critical ", "", "High; DROP TABLE Ticket"])(
    "rejects %j",
    async (priority) => {
      const res = await createTicket(initial, ticketForm({ priority }));

      expect(res.success).toBe(false);
      expect(res.message).toMatch(/Invalid priority|All fields are required/);
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    },
  );

  it("reports the rejection to Sentry", async () => {
    await createTicket(initial, ticketForm({ priority: "Urgent" }));

    expect(logEvent).toHaveBeenCalledWith(
      "Ticket creation rejected: invalid priority",
      "ticket",
      expect.objectContaining({ priority: "Urgent" }),
      "warning",
    );
  });

  it.each(["Low", "Medium", "High", "Critical"])(
    "accepts %s and persists it",
    async (priority) => {
      const res = await createTicket(initial, ticketForm({ priority }));

      expect(res.success).toBe(true);
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority }),
        }),
      );
    },
  );

  it("still requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await createTicket(initial, ticketForm());

    expect(res.message).toBe("You must be logged in to create a ticket");
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });
});

describe("addTicketComment — attachments", () => {
  beforeEach(() => {
    uploadAttachment.mockImplementation(async (file: File) =>
      uploadResult(file.name),
    );
  });

  it("posts a comment with no files at all", async () => {
    const res = await addTicketComment(initial, commentForm());

    expect(res).toEqual({ success: true, message: "Comment posted" });
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(prisma.commentAttachment.createMany).not.toHaveBeenCalled();
  });

  it("writes each uploaded file against the new comment", async () => {
    await addTicketComment(initial, commentFormWithFiles(2));

    expect(prisma.commentAttachment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          commentId: COMMENT_ID,
          fileName: "shot-0.png",
          publicId: "quickticket/tickets/shot-0.png",
        }),
        expect.objectContaining({ commentId: COMMENT_ID, fileName: "shot-1.png" }),
      ],
    });
  });

  it("records the uploader from the session, never from form data", async () => {
    getCurrentUser.mockResolvedValue(agent);

    await addTicketComment(initial, commentFormWithFiles(1));

    expect(prisma.commentAttachment.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ uploadedById: AGENT })],
    });
  });

  it("rejects more files than the per-comment budget", async () => {
    const res = await addTicketComment(initial, commentFormWithFiles(6));

    // The wording is asserted too, and deliberately: MAX_FILES and
    // MAX_COMMENT_FILES are both 5 today, so the numeric limit alone cannot tell
    // the two budgets apart. If someone pointed this check at the ticket-level
    // constant it would keep passing while silently re-coupling the budgets; the
    // message would then say "per ticket" and fail here. The seed-data test
    // ("respects the per-comment budget, which is separate") covers the
    // independence itself.
    expect(res.message).toBe("Maximum 5 attachments per comment");
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  });

  it("rejects a file that fails validation, uploading nothing", async () => {
    validateAttachmentFile.mockReturnValue("Unsupported file type");

    const res = await addTicketComment(initial, commentFormWithFiles(1));

    expect(res.message).toBe("Unsupported file type");
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  });

  it("sweeps already-uploaded assets when a later upload fails", async () => {
    // All-or-nothing: a partial comment would show a body promising files that
    // are not there.
    uploadAttachment
      .mockResolvedValueOnce(uploadResult("shot-0.png") as never)
      .mockRejectedValueOnce(new Error("Cloudinary down"));

    const res = await addTicketComment(initial, commentFormWithFiles(2));

    expect(res.success).toBe(false);
    expect(destroyAsset).toHaveBeenCalledExactlyOnceWith(
      "quickticket/tickets/shot-0.png",
      "image",
    );
    expect(prisma.ticketComment.create).not.toHaveBeenCalled();
  });

  it("sweeps the uploaded assets when the transaction fails", async () => {
    prisma.ticketComment.create.mockRejectedValue(new Error("db down"));

    const res = await addTicketComment(initial, commentFormWithFiles(2));

    expect(res.message).toBe("Failed to post your comment");
    expect(destroyAsset).toHaveBeenCalledTimes(2);
  });

  it("still requires a body when files are attached", async () => {
    // The NEW_COMMENT worker renders comment.body into the email template, so an
    // attachment-only comment would mail a blank quote block.
    const res = await addTicketComment(
      initial,
      form({
        ticketId: "1",
        body: "   ",
        attachments: [makeFile("shot-0.png", "image/png")],
      }),
    );

    expect(res.message).toBe("Comment cannot be empty");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("never puts a file name in Sentry", async () => {
    await addTicketComment(initial, commentFormWithFiles(1, "my secret text"));

    const logged = logEvent.mock.calls.flatMap(([, , data]) => [data ?? {}]);
    expect(JSON.stringify(logged)).not.toContain("shot-0.png");
    expect(JSON.stringify(logged)).not.toContain("my secret text");
  });

  it("rejects a Closed ticket before uploading anything", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Closed" }),
    );

    const res = await addTicketComment(initial, commentFormWithFiles(2));

    expect(res.success).toBe(false);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("denies a foreign ticket before uploading anything", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: "somebody-else", status: "Open" }),
    );

    const res = await addTicketComment(initial, commentFormWithFiles(2));

    expect(res.success).toBe(false);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("reports the attachment count on success", async () => {
    const res = await addTicketComment(initial, commentFormWithFiles(1));

    expect(res.message).toBe("Comment posted with 1 attachment");
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
  beforeEach(() => {
    prisma.user.findMany.mockResolvedValue([
      { id: "staff-1" },
      { id: "staff-2" },
    ]);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Open", subject: "Test ticket" }),
    );
  });

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
    prisma.user.findMany.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: "owner-1", status: "Open", subject: "Test ticket" }),
    );

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
    prisma.user.findMany.mockResolvedValue([{ id: "staff-1" }, { id: "staff-2" }]);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: "somebody-else", status: "In_Progress", subject: "Test ticket" }),
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
      makeTicket({ userId: OWNER, assigneeId: null, subject: "Test ticket" }),
    );
    prisma.user.findMany.mockResolvedValue([
      { id: "staff-1" },
      { id: "staff-2" },
    ]);

    const res = await assignTicket(initial, assignForm(AGENT));

    expect(res.message).toBe("Ticket assigned");
    expect(publishJob).toHaveBeenCalledExactlyOnceWith(
      { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT },
      { deduplicationId: `assigned_1_${AGENT}` },
    );
  });

  it("publishes both sides on a reassignment", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: OTHER_AGENT, subject: "Test ticket" }),
    );
    prisma.user.findUnique.mockResolvedValue({ id: AGENT, role: "SUPPORT_AGENT" });
    prisma.user.findMany.mockResolvedValue([
      { id: "staff-1" },
      { id: "staff-2" },
    ]);

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
      makeTicket({ userId: OWNER, assigneeId: AGENT, subject: "Test ticket" }),
    );
    prisma.user.findMany.mockResolvedValue([
      { id: "staff-1" },
      { id: "staff-2" },
    ]);

    const res = await assignTicket(initial, assignForm(""));

    expect(res.message).toBe("Ticket unassigned");
    expect(publishJob).toHaveBeenCalledExactlyOnceWith(
      { type: "TICKET_UNASSIGNED", ticketId: 1, previousAssigneeId: AGENT },
      { deduplicationId: `unassigned_1_${AGENT}` },
    );
  });

  it("publishes nothing when the assignment is unchanged", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: AGENT, subject: "Test ticket" }),
    );

    await assignTicket(initial, assignForm(AGENT));
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("publishes nothing when an unassigned ticket is cleared again", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: null, subject: "Test ticket" }),
    );

    await assignTicket(initial, assignForm(""));
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("does not branch on the outcome of the enqueue", async () => {
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, assigneeId: null, subject: "Test ticket" }),
    );
    prisma.user.findMany.mockResolvedValue([
      { id: "staff-1" },
      { id: "staff-2" },
    ]);
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

describe("deleteAttachment", () => {
  const form = () => new FormData();
  const attachForm = (id: string) => {
    const data = new FormData();
    data.set("attachmentId", id);
    return data;
  };

  beforeEach(() => {
    prisma.ticketAttachment.findUnique.mockResolvedValue(
      attachmentRow(OWNER) as never,
    );
    prisma.ticketAttachment.delete.mockResolvedValue({} as never);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Open" }) as never,
    );
  });

  it("requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await deleteAttachment(initial, attachForm(ATT_ID));
    expect(res.message).toBe("You must be logged in");
    expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
  });

  it("requires an attachment id", async () => {
    const res = await deleteAttachment(initial, form());
    expect(res.message).toBe("Attachment ID is required");
  });

  it("reports a missing attachment", async () => {
    prisma.ticketAttachment.findUnique.mockResolvedValue(null);

    const res = await deleteAttachment(initial, attachForm(ATT_ID));
    expect(res.message).toBe("Attachment not found");
    expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
  });

  it("lets the uploader delete their own file", async () => {
    getCurrentUser.mockResolvedValue(client);

    const res = await deleteAttachment(initial, attachForm(ATT_ID));
    expect(res).toEqual({ success: true, message: "Attachment deleted" });
    expect(prisma.ticketAttachment.delete).toHaveBeenCalledWith({
      where: { id: ATT_ID },
    });
  });

  it("denies a client deleting a file support uploaded", async () => {
    getCurrentUser.mockResolvedValue(client);
    prisma.ticketAttachment.findUnique.mockResolvedValue(
      attachmentRow(AGENT) as never,
    );

    const res = await deleteAttachment(initial, attachForm(ATT_ID));
    expect(res.message).toBe("You are not allowed to delete this attachment");
    expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it("lets staff delete anybody's file", async () => {
    getCurrentUser.mockResolvedValue(agent);
    prisma.ticketAttachment.findUnique.mockResolvedValue(
      attachmentRow(OWNER) as never,
    );

    const res = await deleteAttachment(initial, attachForm(ATT_ID));
    expect(res.success).toBe(true);
    expect(prisma.ticketAttachment.delete).toHaveBeenCalledOnce();
  });

  it("denies a uploader who can no longer reach the ticket", async () => {
    // Demoted staff: still the author, but canAccessTicket now fails.
    getCurrentUser.mockResolvedValue(makeUser({ id: AGENT, role: "CLIENT" }));
    prisma.ticketAttachment.findUnique.mockResolvedValue(
      attachmentRow(AGENT) as never,
    );
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Open" }) as never,
    );

    const res = await deleteAttachment(initial, attachForm(ATT_ID));
    expect(res.success).toBe(false);
    expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
  });

  it("destroys the Cloudinary asset with the right arguments", async () => {
    getCurrentUser.mockResolvedValue(client);

    await deleteAttachment(initial, attachForm(ATT_ID));

    expect(destroyAsset).toHaveBeenCalledWith(
      "quickticket/tickets/abc",
      "image",
    );
  });

  it("deletes the row BEFORE destroying the asset", async () => {
    // The reverse order can leave a row pointing at a file that no longer
    // exists, which breaks the thumbnail visibly.
    getCurrentUser.mockResolvedValue(client);

    await deleteAttachment(initial, attachForm(ATT_ID));

    const deleteOrder = prisma.ticketAttachment.delete.mock
      .invocationCallOrder[0];
    const destroyOrder = destroyAsset.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(destroyOrder);
  });

  it("still reports success when the asset destroy throws", async () => {
    getCurrentUser.mockResolvedValue(client);
    destroyAsset.mockRejectedValue(new Error("Cloudinary down"));

    // The row is already gone by then, so reporting a failure would be a lie.
    await expect(
      deleteAttachment(initial, attachForm(ATT_ID)),
    ).resolves.toEqual({ success: true, message: "Attachment deleted" });
  });

  it("revalidates the list and the detail page", async () => {
    getCurrentUser.mockResolvedValue(client);

    await deleteAttachment(initial, attachForm(ATT_ID));

    expect(revalidatePath).toHaveBeenCalledWith("/tickets");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets/[id]", "page");
  });
});

describe("deleteComment", () => {
  const commentForm = (id: string) => {
    const data = new FormData();
    data.set("commentId", id);
    return data;
  };

  beforeEach(() => {
    prisma.ticketComment.findUnique.mockResolvedValue(
      commentRow(OWNER) as never,
    );
    prisma.ticketComment.update.mockResolvedValue({} as never);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Open" }) as never,
    );
  });

  it("requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));
    expect(res.message).toBe("You must be logged in");
    expect(prisma.ticketComment.update).not.toHaveBeenCalled();
  });

  it("requires a comment id", async () => {
    const res = await deleteComment(initial, new FormData());
    expect(res.message).toBe("Comment ID is required");
  });

  it("reports a missing comment", async () => {
    prisma.ticketComment.findUnique.mockResolvedValue(null);

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));
    expect(res.message).toBe("Comment not found");
  });

  it("lets the author remove their own comment", async () => {
    getCurrentUser.mockResolvedValue(client);

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));
    expect(res).toEqual({ success: true, message: "Comment removed" });
    expect(prisma.ticketComment.update).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
      data: { deletedAt: expect.any(Date), deletedById: OWNER },
    });
  });

  it("never hard-deletes the row", async () => {
    getCurrentUser.mockResolvedValue(client);

    await deleteComment(initial, commentForm(String(COMMENT_ID)));

    expect(prisma.ticketComment.delete).not.toHaveBeenCalled();
  });

  it("denies a client removing a support reply", async () => {
    getCurrentUser.mockResolvedValue(client);
    prisma.ticketComment.findUnique.mockResolvedValue(commentRow(AGENT) as never);

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));
    expect(res.message).toBe("You are not allowed to delete this comment");
    expect(prisma.ticketComment.update).not.toHaveBeenCalled();
  });

  it("lets staff moderate any comment", async () => {
    getCurrentUser.mockResolvedValue(agent);
    prisma.ticketComment.findUnique.mockResolvedValue(commentRow(OWNER) as never);

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));
    expect(res.success).toBe(true);
    expect(prisma.ticketComment.update).toHaveBeenCalledWith({
      where: { id: COMMENT_ID },
      data: { deletedAt: expect.any(Date), deletedById: AGENT },
    });
  });

  it("is idempotent when the comment is already removed", async () => {
    getCurrentUser.mockResolvedValue(client);
    prisma.ticketComment.findUnique.mockResolvedValue(
      commentRow(OWNER, new Date()) as never,
    );

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));

    expect(res).toEqual({ success: true, message: "Comment already removed" });
    expect(prisma.ticketComment.update).not.toHaveBeenCalled();
  });

  it("works on a Closed ticket", async () => {
    // Retracting your own words is not new conversation, which is the reason
    // comments cannot be *added* to a closed ticket.
    getCurrentUser.mockResolvedValue(client);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Closed" }) as never,
    );

    const res = await deleteComment(initial, commentForm(String(COMMENT_ID)));
    expect(res.success).toBe(true);
  });

  it("revalidates the list and the detail page", async () => {
    getCurrentUser.mockResolvedValue(client);

    await deleteComment(initial, commentForm(String(COMMENT_ID)));

    expect(revalidatePath).toHaveBeenCalledWith("/tickets");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets/[id]", "page");
  });
});

describe("deleteCommentAttachment", () => {
  const CATT_ID = "catt-1";

  const attachForm = (id: string) =>
    form({ attachmentId: id });

  /** A row the delete action can read: ownership is the whole permission story. */
  const commentAttachmentRow = (uploadedById: string) => ({
    id: CATT_ID,
    commentId: COMMENT_ID,
    fileName: "shot.png",
    publicId: "quickticket/tickets/abc",
    resourceType: "image",
    uploadedById,
  });

  beforeEach(() => {
    prisma.commentAttachment.findUnique.mockResolvedValue(
      commentAttachmentRow(OWNER) as never,
    );
    prisma.commentAttachment.delete.mockResolvedValue({} as never);
    prisma.ticketComment.findUnique.mockResolvedValue({
      id: COMMENT_ID,
      ticketId: 1,
      deletedAt: null,
    } as never);
    prisma.ticket.findUnique.mockResolvedValue(
      makeTicket({ userId: OWNER, status: "Open" }) as never,
    );
  });

  it("destroys nothing when the delete itself failed", async () => {
    // Guards the ordering invariant from the other end: the asset sweep must be
    // gated behind a delete that actually happened.
    prisma.commentAttachment.delete.mockRejectedValue(new Error("db down"));

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(res.success).toBe(false);
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));
    expect(res.message).toBe("You must be logged in");
    expect(prisma.commentAttachment.delete).not.toHaveBeenCalled();
  });

  it("requires an attachment id", async () => {
    const res = await deleteCommentAttachment(initial, new FormData());
    expect(res.message).toBe("Attachment ID is required");
  });

  it("reports a missing attachment", async () => {
    prisma.commentAttachment.findUnique.mockResolvedValue(null);

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));
    expect(res.message).toBe("Attachment not found");
    expect(prisma.commentAttachment.delete).not.toHaveBeenCalled();
  });

  it("reports a missing parent comment", async () => {
    prisma.ticketComment.findUnique.mockResolvedValue(null);

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));
    expect(res.message).toBe("Attachment not found");
    expect(prisma.commentAttachment.delete).not.toHaveBeenCalled();
  });

  it("lets the uploader delete their own file", async () => {
    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(res).toEqual({ success: true, message: "Attachment deleted" });
    expect(prisma.commentAttachment.delete).toHaveBeenCalledWith({
      where: { id: CATT_ID },
    });
  });

  it("denies a client deleting a file support uploaded", async () => {
    prisma.commentAttachment.findUnique.mockResolvedValue(
      commentAttachmentRow(AGENT) as never,
    );

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(res.message).toBe("You are not allowed to delete this attachment");
    expect(prisma.commentAttachment.delete).not.toHaveBeenCalled();
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it("lets staff delete anybody's file", async () => {
    getCurrentUser.mockResolvedValue(agent);

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(res.success).toBe(true);
    expect(prisma.commentAttachment.delete).toHaveBeenCalledOnce();
  });

  it("denies an uploader who can no longer reach the ticket", async () => {
    // Demoted staff: still the author, but canAccessTicket now fails.
    getCurrentUser.mockResolvedValue(makeUser({ id: AGENT, role: "CLIENT" }));
    prisma.commentAttachment.findUnique.mockResolvedValue(
      commentAttachmentRow(AGENT) as never,
    );

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(res.success).toBe(false);
    expect(prisma.commentAttachment.delete).not.toHaveBeenCalled();
  });

  it("refuses when the comment was already removed", async () => {
    // The rows are kept on soft delete so the thread has no hole, and the files
    // are withheld. Without this guard they would still be deletable through the
    // action while being unreachable from the UI.
    getCurrentUser.mockResolvedValue(agent);
    prisma.ticketComment.findUnique.mockResolvedValue({
      id: COMMENT_ID,
      ticketId: 1,
      deletedAt: new Date(),
    } as never);

    const res = await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(res.success).toBe(false);
    expect(res.message).toContain("no longer be deleted");
    expect(prisma.commentAttachment.delete).not.toHaveBeenCalled();
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it("destroys the Cloudinary asset with the right arguments", async () => {
    await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(destroyAsset).toHaveBeenCalledWith(
      "quickticket/tickets/abc",
      "image",
    );
  });

  it("deletes the row BEFORE destroying the asset", async () => {
    // The reverse order can leave a row pointing at a file that no longer
    // exists, which breaks the thumbnail visibly.
    await deleteCommentAttachment(initial, attachForm(CATT_ID));

    const deleteOrder = prisma.commentAttachment.delete.mock
      .invocationCallOrder[0];
    const destroyOrder = destroyAsset.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(destroyOrder);
  });

  it("still reports success when the asset destroy throws", async () => {
    destroyAsset.mockRejectedValue(new Error("Cloudinary down"));

    await expect(
      deleteCommentAttachment(initial, attachForm(CATT_ID)),
    ).resolves.toEqual({ success: true, message: "Attachment deleted" });
  });

  it("revalidates the list and the detail page", async () => {
    await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(revalidatePath).toHaveBeenCalledWith("/tickets");
    expect(revalidatePath).toHaveBeenCalledWith("/tickets/[id]", "page");
  });

  it("does not touch the ticket attachment table", async () => {
    // The two tables have independent lifecycles; a comment file must never be
    // removed through the ticket-level delegate.
    await deleteCommentAttachment(initial, attachForm(CATT_ID));

    expect(prisma.ticketAttachment.delete).not.toHaveBeenCalled();
    expect(prisma.ticketComment.delete).not.toHaveBeenCalled();
  });
});
