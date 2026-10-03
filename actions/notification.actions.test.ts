import { beforeEach, describe, expect, it, vi } from "vitest";
import { form, makeUser } from "@/test-utils/factories";

const { prisma } = await vi.hoisted(async () => {
  const { createPrismaMock } = await import("@/test-utils/prisma-mock");
  return { prisma: createPrismaMock() };
});

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/utils/sentry", () => ({ logEvent }));

import {
  getNotifications,
  getUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/actions/notification.actions";

const OWNER = "owner-1";
const INTRUDER = "intruder-1";

const client = makeUser({ id: OWNER, role: "CLIENT", email: "owner@example.com" });
const other = makeUser({ id: INTRUDER, role: "CLIENT", email: "other@example.com" });

const initial = { success: false, message: "" };

const row = (over: Record<string, unknown> = {}) => ({
  id: "notif-1",
  type: "NEW_COMMENT",
  ticketId: 1,
  title: "New reply on your ticket",
  body: "Ticket #1: Broken",
  readAt: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  ...over,
});

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clear wipes call history but leaves any
  // mockResolvedValue installed by an earlier test, which then leaks into it.
  vi.resetAllMocks();
  getCurrentUser.mockResolvedValue(client);
  // Defaults, established after the reset: updateMany resolves `{ count }` and
  // the actions destructure it.
  prisma.notification.updateMany.mockResolvedValue({ count: 1 });
  prisma.notification.findMany.mockResolvedValue([]);
  prisma.notification.count.mockResolvedValue(0);
});

describe("getNotifications", () => {
  it("returns nothing for an anonymous caller rather than throwing", async () => {
    // The Navbar renders for logged-out visitors too; a thrown read here would
    // take down the whole layout over a bell with nothing to show.
    getCurrentUser.mockResolvedValue(null);

    await expect(getNotifications()).resolves.toEqual([]);
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it("scopes to the viewer and asks for the newest first", async () => {
    prisma.notification.findMany.mockResolvedValue([row()] as never);

    const result = await getNotifications();

    expect(result).toHaveLength(1);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: OWNER },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    );
  });

  it("honours an explicit limit for the full-page view", async () => {
    prisma.notification.findMany.mockResolvedValue([] as never);

    await getNotifications(50);

    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});

describe("getUnreadCount", () => {
  it("returns 0 for an anonymous caller", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(getUnreadCount()).resolves.toBe(0);
    expect(prisma.notification.count).not.toHaveBeenCalled();
  });

  it("counts only unread rows belonging to the viewer", async () => {
    prisma.notification.count.mockResolvedValue(4);

    await expect(getUnreadCount()).resolves.toBe(4);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: OWNER, readAt: null },
    });
  });
});

describe("markNotificationRead", () => {
  it("requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await markNotificationRead(initial, form({ notificationId: "n1" }));

    expect(res).toEqual({ success: false, message: "You must be logged in" });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it("requires an id", async () => {
    const res = await markNotificationRead(initial, new FormData());

    expect(res).toEqual({ success: false, message: "Notification ID is required" });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it("scopes the write to the viewer", async () => {
    // THE security property. `userId` in the where clause is what stops a
    // guessed cuid from marking somebody else's notification read — an
    // `update` by id alone would not check the owner at all.
    await markNotificationRead(initial, form({ notificationId: "n1" }));

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: "n1", userId: OWNER, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("uses updateMany rather than update, so a foreign id changes nothing", async () => {
    getCurrentUser.mockResolvedValue(other);
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    await markNotificationRead(initial, form({ notificationId: "n1" }));

    // The write is still attempted, but filtered to this viewer, so it matches
    // nothing — and `update` is never called.
    expect(prisma.notification.update).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: INTRUDER }) }),
    );
  });

  it("is idempotent: a repeat submit still reports success", async () => {
    // The bell decrements its badge optimistically from the server-supplied
    // readAt. Reporting failure for an already-read row would leave the badge
    // disagreeing with the server, which is worse than the race itself.
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    const res = await markNotificationRead(initial, form({ notificationId: "n1" }));

    expect(res).toEqual({ success: true, message: "Notification marked as read" });
  });

  it("revalidates the root layout, where the bell lives", async () => {
    await markNotificationRead(initial, form({ notificationId: "n1" }));

    // "/" not "/tickets": the bell is rendered by the Navbar in the root
    // layout, so revalidating a page path would leave the badge stale.
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("markAllNotificationsRead", () => {
  it("requires a session", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await markAllNotificationsRead();

    expect(res).toEqual({ success: false, message: "You must be logged in" });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it("touches only the viewer's unread rows", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    const res = await markAllNotificationsRead();

    expect(res).toEqual({
      success: true,
      message: "All notifications marked as read",
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: OWNER, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("succeeds when there was nothing unread", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });

    await expect(markAllNotificationsRead()).resolves.toEqual({
      success: true,
      message: "All notifications marked as read",
    });
  });

  it("revalidates the root layout", async () => {
    await markAllNotificationsRead();

    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});