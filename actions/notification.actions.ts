"use server";

import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/utils/sentry";
import { revalidatePath } from "next/cache";

export type NotificationView = {
  id: string;
  type: string;
  ticketId: number;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Reading the inbox.
 *
 * Both readers return an empty result for an anonymous caller rather than
 * throwing, because the Navbar renders for logged-out visitors too and must not
 * blow up the whole layout over a bell that has nothing to show.
 */
export async function getNotifications(limit = 20): Promise<NotificationView[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  return prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      ticketId: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export async function getUnreadCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;

  return prisma.notification.count({
    where: { userId: user.id, readAt: null },
  });
}

type ActionState = { success: boolean; message: string };

/**
 * Marks one notification read.
 *
 * Two properties matter here and both are load-bearing:
 *
 * - **Scoped to the viewer.** `updateMany` with `userId` in the where clause
 *   means a guessed cuid changes 0 rows. `update` by id alone would happily mark
 *   somebody else's notification read.
 * - **Idempotent.** `readAt: null` in the filter turns a repeat submit into a
 *   no-op reported as success. The bell decrements its badge optimistically from
 *   the server-supplied `readAt`, so the only way to arrive here with an
 *   already-read row is a race — and reporting *failure* for that would
 *   desynchronise the badge from the server, which is worse than the race.
 */
export async function markNotificationRead(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "You must be logged in" };
  }

  const notificationId = String(formData.get("notificationId") ?? "");
  if (!notificationId) {
    logEvent(
      "Notification mark-read rejected: missing id",
      "notification",
      {},
      "warning",
    );
    return { success: false, message: "Notification ID is required" };
  }

  const { count } = await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  if (count === 0) {
    logEvent(
      "Notification mark-read matched no unread row",
      "notification",
      { notificationId, userId: user.id },
      "debug",
    );
  }

  // The bell lives in the root layout, so the path to revalidate is "/".
  revalidatePath("/");
  return { success: true, message: "Notification marked as read" };
}

export async function markAllNotificationsRead(): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "You must be logged in" };
  }

  const { count } = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  logEvent(
    "All notifications marked read",
    "notification",
    { userId: user.id, count },
    "info",
  );

  revalidatePath("/");
  return { success: true, message: "All notifications marked as read" };
}