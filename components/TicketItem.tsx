import Link from "next/link";
import { getPriorityClass, getStatusClass } from "@/utils/ui";
import type { Ticket } from "@/generated/prisma/client";
import { formatStatus } from "@/utils/string-format";

type TicketItemProps = {
  ticket: Ticket;
};

const TicketItem = ({ ticket }: TicketItemProps) => {
  const isClosed = ticket.status === "Closed";

  return (
    <div
      key={ticket.id}
      className={`flex justify-between items-center bg-white shadow-sm rounded-xl border border-slate-200 p-6 hover:border-slate-300 transition-all duration-200 ${
        isClosed ? "opacity-50" : ""
      }`}
    >
      {/* Left Side */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">
          {ticket.subject}
        </h2>
      </div>
      {/* Right Side */}
      <div className="text-right space-y-2">
        <div className="text-sm text-slate-500">
          Priority:{" "}
          <span className={getPriorityClass(ticket.priority)}>
            {ticket.priority}
          </span>
        </div>
        <div className="text-sm text-slate-500">
          Status:{" "}
          <span className={getStatusClass(ticket.status)}>
            {formatStatus(ticket.status)}
          </span>
        </div>
        <Link
          href={`/tickets/${ticket.id}`}
          className={`inline-block mt-2 text-sm font-medium px-3 py-2 rounded-lg shadow-sm transition text-center ${
            isClosed
              ? "bg-slate-400 text-slate-600 cursor-not-allowed pointer-events-none"
              : "bg-indigo-600 text-white hover:bg-indigo-700 "
          }`}
        >
          View Ticket
        </Link>
      </div>
    </div>
  );
};

export default TicketItem;
