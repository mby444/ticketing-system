import Link from "next/link";
import { getNotifications } from "@/actions/notification.actions";
import { requireUser } from "@/lib/authorization";
import { formatRelativeTime } from "@/lib/string-format";
import MarkAllRead from "@/components/MarkAllReadButton";

/**
 * Full notification history. The bell in the Navbar shows only the newest page;
 * this is where anything older is reachable, which is why it is a real route
 * rather than an infinitely scrolling panel.
 *
 * Server component — the same two actions the bell uses, so an account with no
 * notifications sees the empty state rather than a client-side flash of one.
 */
const NotificationsPage = async () => {
  await requireUser();
  const notifications = await getNotifications();
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen bg-blue-50 p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-blue-600">Notifications</h1>
          <MarkAllRead unreadCount={unread} />
        </div>

        {notifications.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            No notifications yet. Activity on your tickets will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <Link
                  href={`/tickets/${notification.ticketId}`}
                  className={`flex items-start gap-3 px-4 py-3 transition hover:bg-blue-50 ${
                    notification.readAt ? "" : "bg-blue-50/40"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-gray-900">
                      {notification.title}
                    </span>
                    {notification.body && (
                      <span className="mt-0.5 block text-xs text-gray-500">
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
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Link
          href="/tickets"
          className="inline-block rounded bg-white px-4 py-2 text-sm text-gray-700 transition hover:bg-gray-50"
        >
          ← Back to Tickets
        </Link>
      </div>
    </div>
  );
};

export default NotificationsPage;