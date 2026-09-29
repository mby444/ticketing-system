import { describe, expect, it } from "vitest";
import { buildAssignmentNotifications } from "@/lib/assignment-notifications";

/**
 * Decides which emails an assignment change produces. No mocks needed at all:
 * lib/assignment-notifications.ts imports EmailJob as a *type* only, so the
 * QStash SDK is never even loaded here.
 */

const TICKET = 72;
const AGENT_A = "agent-a";
const AGENT_B = "agent-b";
const AGENT_C = "agent-c";

const notify = (
  previousAssigneeId: string | null,
  nextAssigneeId: string | null,
) =>
  buildAssignmentNotifications({
    ticketId: TICKET,
    previousAssigneeId,
    nextAssigneeId,
  });

describe("buildAssignmentNotifications", () => {
  it("notifies the new assignee on a fresh assignment", () => {
    expect(notify(null, AGENT_A)).toEqual([
      {
        job: { type: "TICKET_ASSIGNED", ticketId: TICKET, assigneeId: AGENT_A },
        deduplicationId: `assigned_${TICKET}_${AGENT_A}`,
      },
    ]);
  });

  it("notifies nobody when the assignment does not change", () => {
    expect(notify(AGENT_A, AGENT_A)).toEqual([]);
  });

  it("notifies both sides on a reassignment", () => {
    const result = notify(AGENT_A, AGENT_B);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      job: { type: "TICKET_ASSIGNED", ticketId: TICKET, assigneeId: AGENT_B },
      deduplicationId: `assigned_${TICKET}_${AGENT_B}`,
    });
    expect(result[1]).toEqual({
      job: {
        type: "TICKET_UNASSIGNED",
        ticketId: TICKET,
        previousAssigneeId: AGENT_A,
      },
      deduplicationId: `unassigned_${TICKET}_${AGENT_A}`,
    });
  });

  it("notifies the former assignee on unassignment", () => {
    expect(notify(AGENT_B, null)).toEqual([
      {
        job: {
          type: "TICKET_UNASSIGNED",
          ticketId: TICKET,
          previousAssigneeId: AGENT_B,
        },
        deduplicationId: `unassigned_${TICKET}_${AGENT_B}`,
      },
    ]);
  });

  it("notifies nobody when unassigning an already-unassigned ticket", () => {
    expect(notify(null, null)).toEqual([]);
  });

  it("produces deduplication keys that are stable across a round trip", () => {
    // A -> B, then back to A. Each person's `assigned_` key is the same every
    // time they are given a ticket, which is what makes a retry collapse
    // instead of re-mailing.
    const forward = notify(AGENT_A, AGENT_B);
    const back = notify(AGENT_B, AGENT_A);

    expect(forward[0].deduplicationId).toBe(`assigned_${TICKET}_${AGENT_B}`);
    expect(back[0].deduplicationId).toBe(`assigned_${TICKET}_${AGENT_A}`);
    expect(forward[1].deduplicationId).toBe(`unassigned_${TICKET}_${AGENT_A}`);
    expect(back[1].deduplicationId).toBe(`unassigned_${TICKET}_${AGENT_B}`);
  });

  it("never produces two notifications aimed at the same person", () => {
    // Guards the "one job per recipient" invariant that stops a retry from
    // duplicating the other recipient's email.
    expect(notify(AGENT_C, AGENT_C)).toEqual([]);

    const changed = notify(AGENT_A, AGENT_B);
    // A plain ternary on `job.type` will not type-check: the else branch would
    // still include the three non-assignment variants, which have no recipient
    // field. Exhaustive handling doubles as an assertion that this function
    // never emits anything else.
    const recipients = changed.map(({ job }) => {
      switch (job.type) {
        case "TICKET_ASSIGNED":
          return job.assigneeId;
        case "TICKET_UNASSIGNED":
          return job.previousAssigneeId;
        default:
          throw new Error(`unexpected job type: ${JSON.stringify(job)}`);
      }
    });

    expect(new Set(recipients).size).toBe(recipients.length);
  });
});
