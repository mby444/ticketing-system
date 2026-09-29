import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The best-effort contract of the producer: a QStash outage must never fail
 * the ticket action that triggered it. That resilience lives *here*, so this is
 * where it has to be tested — asserting it from an action would only test the
 * action's mock.
 */

// `publishJob` does `new Client({ token })`, so the mock implementation has to
// be a normal function returning an instance object — an arrow function is not
// constructible, and the resulting throw would be swallowed by publishJob's own
// catch, making the failure look like "the client was never called".
const { publishJSON, Client } = vi.hoisted(() => {
  const publishJSON = vi.fn();
  const Client = vi.fn(function () {
    return { publishJSON };
  });
  return { publishJSON, Client };
});

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("@upstash/qstash", () => ({ Client }));
vi.mock("@/utils/sentry", () => ({ logEvent }));

import { publishJob } from "@/lib/qstash";

beforeEach(() => {
  vi.clearAllMocks();
  publishJSON.mockResolvedValue({ messageId: "msg_123" });
});

describe("publishJob", () => {
  it("publishes the payload to the worker endpoint and logs the message id", async () => {
    await publishJob({ type: "TICKET_ASSIGNED", ticketId: 72, assigneeId: "a1" });

    expect(Client).toHaveBeenCalledWith({ token: expect.any(String) });
    expect(publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("/api/jobs/send-email"),
        body: { type: "TICKET_ASSIGNED", ticketId: 72, assigneeId: "a1" },
        retries: 5,
      }),
    );
    expect(logEvent).toHaveBeenCalledWith(
      "Email job enqueued",
      "email",
      expect.objectContaining({
        type: "TICKET_ASSIGNED",
        messageId: "msg_123",
      }),
    );
  });

  it("swallows a QStash outage instead of throwing at the caller", async () => {
    publishJSON.mockRejectedValue(new Error("QStash unreachable"));

    await expect(
      publishJob({ type: "TICKET_CREATED", ticketId: 1 }),
    ).resolves.toBeUndefined();

    expect(logEvent).toHaveBeenCalledWith(
      "Failed to enqueue email job",
      "email",
      expect.anything(),
      "warning",
      expect.any(Error),
    );
  });

  it("forwards a deduplicationId when one is given", async () => {
    await publishJob(
      { type: "TICKET_ASSIGNED", ticketId: 1, assigneeId: "a1" },
      { deduplicationId: "assigned_1_a1" },
    );

    expect(publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({ deduplicationId: "assigned_1_a1" }),
    );
  });

  it("omits deduplicationId entirely when none is given", async () => {
    await publishJob({ type: "TICKET_CREATED", ticketId: 1 });

    const options = publishJSON.mock.calls[0][0] as Record<string, unknown>;
    expect("deduplicationId" in options).toBe(false);
  });
});
