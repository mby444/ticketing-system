import Link from "next/link";
import { FaTicketAlt } from "react-icons/fa";

const HomePage = async () => {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-card">
        <FaTicketAlt className="h-8 w-8" />
      </div>
      <h1 className="text-headline-lg text-slate-900">Welcome to QuickTicket</h1>
      <p className="mt-2 max-w-md text-body-md text-slate-500">
        Fast and simple support ticket management system.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/tickets/new"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          Submit a Ticket
        </Link>
        <Link
          href="/tickets"
          className="rounded-lg border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          View Tickets
        </Link>
      </div>
    </main>
  );
};

export default HomePage;