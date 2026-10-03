"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { toast } from "sonner";
import { FaBell } from "react-icons/fa";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/actions/notification.actions";
import { formatRelativeTime } from "@/lib/string-format";

type Notification = {
  id: string;
  type: string;
  ticketId: number;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
};

const typeIcons: Record<string, string> = {
  TICKET_CREATED: "TICKET_CREATED",
  STATUS_UPDATED: "STATUS_UPDATED",
  NEW_COMMENT: "NEW_COMMENT",
  TICKET_ASSIGNED: "TICKET_ASSIGNED",
  TICKET_UNASSIGNED: "TICKET_UNASSIGNED",
};

/**
 * Notification bell with an unread badge and a dropdown panel.
 *
 * The count and the first page of notifications are rendered by the server
 * Navbar and handed in as props, so the badge is correct on first paint with no
 * client round-trip. There is no polling: the badge refreshes when a mutation
 * revalidates, which is the same "no live updates" trade-off the comment thread
 * already makes.
 *
 * Each row is a real `<form>` posting `markNotificationRead` rather than a
 * button that calls the action dispatch directly — the same shape as
 * `components/DeleteButton.tsx`. Marking read and navigating are the same click,
 * so the form's submit is the row itself.
 */
const NotificationBell = ({
  unreadCount: initialUnreadCount,
  initialNotifications,
}: {
  unreadCount: number;
  initialNotifications: Notification[];
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] =
    useState<Notification[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const router = useRouter();

  const [readState, markReadAction] = useActionState(markNotificationRead, {
    success: false,
    message: "",
  });
  const [readAllState, readAllAction] = useActionState(
    markAllNotificationsRead,
    { success: false, message: "" },
  );

  // The count and read flags are updated optimistically in the submit handlers
  // below, never here. An effect that calls setState trips
  // `react-hooks/set-state-in-effect` (the rule `DeleteButton` is shaped around
  // too), and it would be redundant anyway: the actions are idempotent, so the
  // optimistic update is already correct and a server round trip can only
  // confirm it. These effects exist purely to surface the outcome.
  useEffect(() => {
    if (readState.message) {
      if (readState.success) toast.success(readState.message);
      else toast.error(readState.message);
    }
  }, [readState]);

  useEffect(() => {
    if (readAllState.message) {
      if (readAllState.success) toast.success(readAllState.message);
      else toast.error(readAllState.message);
    }
  }, [readAllState]);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    // mousedown rather than click, so a drag that ends outside the panel does
    // not read as a dismissal click on whatever is underneath.
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen, closePanel]);

  const handleRowSubmit = (notification: Notification) => {
    // Only an unread row can move the badge, and `readAt` came from the server,
    // so this is exact rather than a guess.
    if (!notification.readAt) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, readAt: new Date() } : n,
        ),
      );
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    router.push(`/tickets/${notification.ticketId}`);
  };

  const grouped = useMemo(() => {
    const buckets = new Map<string, Notification[]>();
    for (const notification of notifications) {
      const key = new Date(notification.createdAt).toDateString();
      const bucket = buckets.get(key);
      if (bucket) bucket.push(notification);
      else buckets.set(key, [notification]);
    }
    return [...buckets.entries()];
  }, [notifications]);

  // Rendered as a label rather than computed during render: reading the clock
  // inline is impure and trips react-hooks/purity.
  const dayLabel = useCallback((key: string) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (key === today.toDateString()) return "Today";
    if (key === yesterday.toDateString()) return "Yesterday";
    return key;
  }, []);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="relative rounded p-2 text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
      >
        <FaBell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-labelledby={headingId}
          className="absolute right-0 z-50 mt-2 w-96 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2
              id={headingId}
              className="text-sm font-semibold text-gray-900"
            >
              Notifications
              {unreadCount > 0 && (
                <span className="ml-2 font-normal text-gray-500">
                  {unreadCount} unread
                </span>
              )}
            </h2>
            {unreadCount > 0 && (
              <form
                action={readAllAction}
                onSubmit={() => {
                  setUnreadCount(0);
                  setNotifications((prev) =>
                    prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })),
                  );
                }}
              >
                <button
                  type="submit"
                  className="text-xs font-medium text-blue-600 transition hover:text-blue-800"
                >
                  Mark all read
                </button>
              </form>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              No notifications yet
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {grouped.map(([day, items]) => (
                <li key={day}>
                  <p className="bg-gray-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {dayLabel(day)}
                  </p>
                  <ul>
                    {items.map((notification) => (
                      <li key={notification.id}>
                        <form
                          action={markReadAction}
                          onSubmit={() => handleRowSubmit(notification)}
                        >
                          <input
                            type="hidden"
                            name="notificationId"
                            value={notification.id}
                          />
                          <button
                            type="submit"
                            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-blue-50 ${
                              notification.readAt ? "" : "bg-blue-50/40"
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="mt-0.5 font-mono text-[10px] text-gray-400"
                            >
                              {typeIcons[notification.type] ?? "EVENT"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-gray-900">
                                {notification.title}
                              </span>
                              {notification.body && (
                                <span className="mt-0.5 block truncate text-xs text-gray-500">
                                  {notification.body}
                                </span>
                              )}
                              <span className="mt-1 block text-xs text-gray-400">
                                {formatRelativeTime(notification.createdAt)}
                              </span>
                            </span>
                            {!notification.readAt && (
                              <span
                                aria-label="Unread"
                                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600"
                              />
                            )}
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-gray-100 px-4 py-2">
            <Link
              href="/notifications"
              onClick={closePanel}
              className="block text-center text-sm font-medium text-blue-600 transition hover:text-blue-800"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;