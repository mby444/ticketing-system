import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { isStaff } from "@/lib/authorization";
import {
  getNotifications,
  getUnreadCount,
} from "@/actions/notification.actions";
import LogoutButton from "./LogoutButton";
import NotificationBell from "./NotificationBell";

const Navbar = async () => {
  const user = await getCurrentUser();

  const unreadCount = user ? await getUnreadCount() : 0;
  const initialNotifications = user ? await getNotifications() : [];

  return (
    <nav className="sticky top-0 z-50 glass">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-indigo-600 transition hover:text-indigo-700"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm">
              Q
            </span>
            QuickTicket
          </Link>
          {user && (
            <div className="hidden items-center gap-1 md:flex">
              {isStaff(user) && (
                <Link
                  href="/dashboard"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-indigo-600"
                >
                  Dashboard
                </Link>
              )}
              <Link
                href="/tickets/new"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-indigo-600"
              >
                New Ticket
              </Link>
              <Link
                href="/tickets"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-indigo-600"
              >
                My Tickets
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="hidden rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium uppercase tracking-wide text-slate-700 sm:inline-flex">
                {user.role.replace("_", " ")}
              </span>
              <NotificationBell
                unreadCount={unreadCount}
                initialNotifications={initialNotifications}
              />
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-indigo-600"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
