import { describe, expect, it } from "vitest";
import type { Role } from "@/generated/prisma/client";
import {
  buildNotificationJobs,
  notificationContent,
  notificationRecipients,
} from "@/lib/notifications";

/**
 * The recipient matrix for in-app notifications.
 *
 * The most important case here is the last one in the client-author block: a
 * customer replying on an UNASSIGNED ticket. Email deliberately notifies nobody
 * (there is no assignee to tell — email backlog #2), while in-app notifies all
 * staff. If that divergence is ever "fixed" to match email, this suite is what
 * catches it.
 */

const OWNER = "owner-1";
const ADMIN = "admin-1";
const AGENT_1 = "agent-1";
const AGENT_2 = "agent-2";

const STAFF = [ADMIN, AGENT_1, AGENT_2];

type Ctx = Parameters<typeof notificationRecipients>[1];

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  ticket: {
    id: 1,
    userId: OWNER,
    assigneeId: AGENT_1,
    subject: "Broken",
  },
  actor: { id: OWNER, role: "CLIENT" as Role },
  staffIds: [...STAFF],
  ...over,
});

const staffAuthor = (actorId = AGENT_1) => ({
  actor: { id: actorId, role: "SUPPORT_AGENT" as Role },
  commentAuthor: { id: actorId, role: "SUPPORT_AGENT" as Role },
});

describe("notificationRecipients — TICKET_CREATED", () => {
  it("notifies every staff member when a customer files a ticket", () => {
    expect(
      notificationRecipients({ type: "TICKET_CREATED", ticketId: 1 }, ctx()),
    ).toEqual([ADMIN, AGENT_1, AGENT_2]);
  });

  it("never notifies the actor, so a staff member filing their own ticket is silent", () => {
    expect(
      notificationRecipients(
        { type: "TICKET_CREATED", ticketId: 1 },
        ctx({ actor: { id: AGENT_2, role: "SUPPORT_AGENT" } }),
      ),
    ).toEqual([ADMIN, AGENT_1]);
  });
});

describe("notificationRecipients — STATUS_UPDATED", () => {
  it("notifies owner and assignee", () => {
    expect(
      notificationRecipients(
        { type: "STATUS_UPDATED", ticketId: 1, newStatus: "In_Progress" },
        ctx({ actor: { id: ADMIN, role: "ADMIN" } }),
      ),
    ).toEqual([OWNER, AGENT_1]);
  });

  it("notifies only the owner when unassigned", () => {
    expect(
      notificationRecipients(
        { type: "STATUS_UPDATED", ticketId: 1, newStatus: "Resolved" },
        ctx({
          ticket: { id: 1, userId: OWNER, assigneeId: null, subject: "Broken" },
          actor: { id: ADMIN, role: "ADMIN" },
        }),
      ),
    ).toEqual([OWNER]);
  });

  it("never notifies the staff member who made the change", () => {
    expect(
      notificationRecipients(
        { type: "STATUS_UPDATED", ticketId: 1, newStatus: "Resolved" },
        ctx({ actor: { id: AGENT_1, role: "SUPPORT_AGENT" } }),
      ),
    ).toEqual([OWNER]);
  });
});

describe("notificationRecipients — NEW_COMMENT", () => {
  it("a staff reply notifies the ticket owner", () => {
    expect(
      notificationRecipients(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 42 },
        ctx(staffAuthor()),
      ),
    ).toEqual([OWNER]);
  });

  it("a customer reply notifies the assignee", () => {
    expect(
      notificationRecipients(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 42 },
        ctx({
          commentAuthor: { id: OWNER, role: "CLIENT" },
        }),
      ),
    ).toEqual([AGENT_1]);
  });

  it("a customer reply on an UNASSIGNED ticket notifies all staff — the gap email cannot close", () => {
    // Email resolves this case to a deliberate no-op: no assignee means no
    // address to send to. An in-app row needs no address, so every agent finds
    // out instead.
    expect(
      notificationRecipients(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 42 },
        ctx({
          ticket: { id: 1, userId: OWNER, assigneeId: null, subject: "Broken" },
          commentAuthor: { id: OWNER, role: "CLIENT" },
        }),
      ),
    ).toEqual(STAFF);
  });

  it("excludes the actor from the staff fan-out", () => {
    expect(
      notificationRecipients(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 42 },
        ctx({
          ticket: { id: 1, userId: OWNER, assigneeId: null, subject: "Broken" },
          actor: { id: AGENT_2, role: "SUPPORT_AGENT" },
          commentAuthor: { id: OWNER, role: "CLIENT" },
        }),
      ),
    ).toEqual([ADMIN, AGENT_1]);
  });

  it("says nothing about a soft-deleted comment", () => {
    // The row survives so the thread keeps its shape, so the comment can still
    // be read here. Notifying on it would announce a message that was retracted.
    expect(
      notificationRecipients(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 42 },
        ctx({
          ...staffAuthor(),
          commentDeletedAt: new Date(),
        }),
      ),
    ).toEqual([]);
  });
});

describe("notificationRecipients — assignment events", () => {
  it("notifies a new assignee", () => {
    expect(
      notificationRecipients(
        { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT_2 },
        ctx({ actor: { id: ADMIN, role: "ADMIN" } }),
      ),
    ).toEqual([AGENT_2]);
  });

  it("does not notify someone about their own ticket", () => {
    expect(
      notificationRecipients(
        { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: OWNER },
        ctx({ actor: { id: ADMIN, role: "ADMIN" } }),
      ),
    ).toEqual([]);
  });

  it("does not notify a staff member who assigned themselves", () => {
    expect(
      notificationRecipients(
        { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT_2 },
        ctx({ actor: { id: AGENT_2, role: "SUPPORT_AGENT" } }),
      ),
    ).toEqual([]);
  });

  it("notifies the previous assignee on unassign", () => {
    expect(
      notificationRecipients(
        { type: "TICKET_UNASSIGNED", ticketId: 1, previousAssigneeId: AGENT_1 },
        ctx({ actor: { id: ADMIN, role: "ADMIN" } }),
      ),
    ).toEqual([AGENT_1]);
  });

  it("never notifies the actor", () => {
    expect(
      notificationRecipients(
        { type: "TICKET_UNASSIGNED", ticketId: 1, previousAssigneeId: AGENT_1 },
        ctx({ actor: { id: AGENT_1, role: "SUPPORT_AGENT" } }),
      ),
    ).toEqual([]);
  });
});

describe("notificationRecipients — the actor is never notified", () => {
  // Exhaustively rather than by example: the rule is the security-relevant part
  // of every branch, so it is asserted for every event shape, including the
  // staff fan-out where the actor is one of the names being filtered.
  it.each([
    {
      name: "TICKET_CREATED by a staff member",
      event: { type: "TICKET_CREATED", ticketId: 1 } as const,
      actor: { id: AGENT_1, role: "SUPPORT_AGENT" as Role },
    },
    {
      name: "STATUS_UPDATED by the assignee",
      event: {
        type: "STATUS_UPDATED",
        ticketId: 1,
        newStatus: "Resolved",
      } as const,
      actor: { id: AGENT_1, role: "SUPPORT_AGENT" as Role },
    },
    {
      name: "STATUS_UPDATED by the owner",
      event: {
        type: "STATUS_UPDATED",
        ticketId: 1,
        newStatus: "Resolved",
      } as const,
      actor: { id: OWNER, role: "CLIENT" as Role },
    },
    {
      name: "NEW_COMMENT by a staff member",
      event: { type: "NEW_COMMENT", ticketId: 1, commentId: 7 } as const,
      actor: { id: AGENT_2, role: "SUPPORT_AGENT" as Role },
    },
    {
      name: "TICKET_ASSIGNED to the actor",
      event: { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT_1 } as const,
      actor: { id: AGENT_1, role: "SUPPORT_AGENT" as Role },
    },
    {
      name: "TICKET_UNASSIGNED from the actor",
      event: {
        type: "TICKET_UNASSIGNED",
        ticketId: 1,
        previousAssigneeId: AGENT_1,
      } as const,
      actor: { id: AGENT_1, role: "SUPPORT_AGENT" as Role },
    },
  ])("$name", ({ event, actor }) => {
    const recipients = notificationRecipients(
      event,
      ctx({ actor, commentAuthor: actor }),
    );
    expect(recipients).not.toContain(actor.id);
  });
});

describe("notificationContent", () => {
  it("describes a created ticket", () => {
    expect(
      notificationContent({ type: "TICKET_CREATED", ticketId: 1 }, ctx()),
    ).toEqual({
      title: "New ticket created",
      body: "Ticket #1: Broken",
      dedupeKey: "-",
    });
  });

  it("humanises the status in a status change", () => {
    const content = notificationContent(
      { type: "STATUS_UPDATED", ticketId: 1, newStatus: "In_Progress" },
      ctx(),
    );
    expect(content.body).toBe("Ticket #1: Broken is now In Progress");
  });

  it("gives each comment its own dedupe key", () => {
    // Two comments on one ticket are two distinct events. Collapsing them
    // because they share a ticketId would silently drop a reply.
    const first = notificationContent(
      { type: "NEW_COMMENT", ticketId: 1, commentId: 42 },
      ctx(staffAuthor()),
    );
    const second = notificationContent(
      { type: "NEW_COMMENT", ticketId: 1, commentId: 43 },
      ctx(staffAuthor()),
    );
    expect(first.dedupeKey).toBe("42");
    expect(second.dedupeKey).toBe("43");
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
  });

  it("titles a staff reply and a customer reply differently", () => {
    expect(
      notificationContent(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 1 },
        ctx(staffAuthor()),
      ).title,
    ).toBe("New reply on your ticket");

    expect(
      notificationContent(
        { type: "NEW_COMMENT", ticketId: 1, commentId: 1 },
        ctx({ commentAuthor: { id: OWNER, role: "CLIENT" } }),
      ).title,
    ).toBe("New customer reply");
  });

  it("uses the new status as the dedupe key, so re-setting it is a no-op", () => {
    const content = notificationContent(
      { type: "STATUS_UPDATED", ticketId: 1, newStatus: "Resolved" },
      ctx(),
    );
    expect(content.dedupeKey).toBe("Resolved");
  });
});

describe("buildNotificationJobs", () => {
  it("produces one row per recipient, each addressed and filled in", () => {
    const jobs = buildNotificationJobs(
      { type: "TICKET_CREATED", ticketId: 1 },
      ctx({ actor: { id: AGENT_1, role: "SUPPORT_AGENT" } }),
    );

    expect(jobs).toEqual([
      {
        userId: ADMIN,
        type: "TICKET_CREATED",
        ticketId: 1,
        title: "New ticket created",
        body: "Ticket #1: Broken",
        dedupeKey: "-",
      },
      {
        userId: AGENT_2,
        type: "TICKET_CREATED",
        ticketId: 1,
        title: "New ticket created",
        body: "Ticket #1: Broken",
        dedupeKey: "-",
      },
    ]);
  });

  it("produces nothing when the only possible recipient is the actor", () => {
    // The self-assign case: publishing a job here would make the bell flash for
    // your own click.
    expect(
      buildNotificationJobs(
        { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: AGENT_1 },
        ctx({ actor: { id: AGENT_1, role: "SUPPORT_AGENT" } }),
      ),
    ).toEqual([]);
  });

  it("carries the comment id as the dedupe key", () => {
    const [job] = buildNotificationJobs(
      { type: "NEW_COMMENT", ticketId: 1, commentId: 99 },
      ctx({
        ticket: { id: 1, userId: OWNER, assigneeId: null, subject: "Broken" },
        commentAuthor: { id: OWNER, role: "CLIENT" },
      }),
    );
    expect(job.dedupeKey).toBe("99");
  });
});