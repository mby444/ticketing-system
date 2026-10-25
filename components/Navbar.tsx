import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { isStaff } from "@/lib/authorization";
import { getNotifications, getUnreadCount } from "@/actions/notification.actions";
import LogoutButton from "./LogoutButton";
import NotificationBell from "./NotificationBell";

const Navbar = async () => {
  const user = await getCurrentUser();

  const unreadCount = user ? await getUnreadCount() : 0;
  const initialNotifications = user ? await getNotifications() : [];

  return (
    <nav className="sticky top-0 z-50 backdrop-blur-md bg-white/80 border-b border-slate-200 px-6 py-4 flex justify-between items-center">
      <div>
        <Link href="/" className="text-xl font-bold text-indigo-600">
          QuickTicket
        </Link>
      </div>
      <div className="flex items-center space-x-4">
        {user ? (
          <>
            {isStaff(user) && (
              <Link
                href="/dashboard"
                className="hover:underline text-slate-700 transition font-medium"
              >
                Dashboard
              </Link>
            )}
            <Link
              href="/tickets/new"
              className="hover:underline text-slate-700 transition"
            >
              New Ticket
            </Link>
            <Link
              href="/tickets"
              className="hover:underline text-slate-700 transition"
            >
              My Tickets
            </Link>
            <span className="text-xs uppercase tracking-wide text-slate-600 border border-slate-300 rounded-full px-2.5 py-1">
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
              className="text-indigo-600 hover:underline transition"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 transition"
            >
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
