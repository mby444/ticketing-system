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
    <nav className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
      <div>
        <Link href="/" className="text-xl font-bold text-blue-600">
          QuickTicket
        </Link>
      </div>
      <div className="flex items-center space-x-4">
        {user ? (
          <>
            {isStaff(user) && (
              <Link
                href="/dashboard"
                className="hover:underline text-gray-700 transition font-medium"
              >
                Dashboard
              </Link>
            )}
            <Link
              href="/tickets/new"
              className="hover:underline text-gray-700 transition"
            >
              New Ticket
            </Link>
            <Link
              href="/tickets"
              className="hover:underline text-gray-700 transition"
            >
              My Tickets
            </Link>
            <span className="text-xs uppercase tracking-wide text-gray-500 border border-gray-200 rounded px-2 py-1">
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
              className="text-blue-600 hover:underline transition"
            >
              Login
            </Link>
            <Link
              href="/register"
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
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
