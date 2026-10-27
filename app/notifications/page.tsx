import Link from "next/link";
import { getNotifications } from "@/actions/notification.actions";
import { requireUser } from "@/lib/authorization";
import { formatRelativeTime } from "@/lib/string-format";
import {
  FaTicketAlt,
  FaCommentDots,
  FaUserPlus,
  FaUserMinus,
  FaExchangeAlt,
  FaBell,
} from "react-icons/fa";
import MarkAllRead from "@/components/MarkAllReadButton";

type IconComponent = React.ComponentType<{ className?: string }>;

const typeIcons: Record<string, IconComponent> = {
  TICKET_CREATED: FaTicketAlt,
  STATUS_UPDATED: FaExchangeAlt,
  NEW_COMMENT: FaCommentDots,
  TICKET_ASSIGNED: FaUserPlus,
  TICKET_UNASSIGNED: FaUserMinus,
};

const NotificationsPage = async () => {
  await requireUser();
  const notifications = await getNotifications();
  const unread = notifications.filter((n) => !n.readAt).length;

  // Group by day.
  const buckets = new Map<string, typeof notifications>();
  for (const notification of notifications) {
    const key = new Date(notification.createdAt).toDateString();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(notification);
    else buckets.set(key, [notification]);
  }
  const grouped = [...buckets.entries()];

  const dayLabel = (key: string) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (key === today.toDateString()) return "Today";
    if (key === yesterday.toDateString()) return "Yesterday";
    return key;
  };

  return (
    <div className="min-h-screen bg-surface p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-headline-md text-slate-900">Notifications</h1>
            <p className="mt-1 text-body-md text-slate-500">
              {unread > 0
                ? `${unread} unread notification${unread === 1 ? "" : "s"}`
                : "You're all caught up"}
            </p>
          </div>
          <MarkAllRead unreadCount={unread} />
        </div>

        {notifications.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <FaBell className="mx-auto h-8 w-8 text-slate-300" aria-hidden="true" />
            <p className="mt-3 text-sm text-slate-500">
              No notifications yet. Activity on your tickets will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(([day, items]) => (
              <section key={day}>
                <h2 className="mb-2 text-label-sm text-slate-500">
                  {dayLabel(day)}
                </h2>
                <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card divide-y divide-slate-100">
                  {items.map((notification) => {
                    const Icon = typeIcons[notification.type] ?? FaBell;
                    return (
                      <li key={notification.id}>
                        <Link
                          href={`/tickets/${notification.ticketId}`}
                          className={`flex items-start gap-3 border-l-4 px-4 py-3 transition hover:bg-slate-50 ${
                            notification.readAt
                              ? "border-transparent"
                              : "border-indigo-600 bg-indigo-50/30"
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600"
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-slate-900">
                              {notification.title}
                            </span>
                            {notification.body && (
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {notification.body}
                              </span>
                            )}
                            <span className="mt-1 block text-xs text-slate-400">
                              {formatRelativeTime(notification.createdAt)}
                            </span>
                          </span>
                          {!notification.readAt && (
                            <span
                              aria-label="Unread"
                              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-600"
                            />
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <Link
          href="/tickets"
          className="inline-block rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          ← Back to Tickets
        </Link>
      </div>
    </div>
  );
};

export default NotificationsPage;