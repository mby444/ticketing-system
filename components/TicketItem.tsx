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
      className={`bg-surface-container-lowest shadow-card rounded-xl border border-slate-200 p-6 hover:border-slate-300 hover:shadow-elevated transition-all duration-200 ${
        isClosed ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-title-md text-slate-900 truncate">
            {ticket.subject}
          </h2>
          <p className="text-label-sm text-slate-500 mt-1">#{ticket.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className={getPriorityClass(ticket.priority)}>
            {ticket.priority}
          </span>
          <span className={getStatusClass(ticket.status)}>
            {formatStatus(ticket.status)}
          </span>
          <Link
            href={`/tickets/${ticket.id}`}
            className={`inline-block text-label-md font-medium px-3 py-1.5 rounded-lg shadow-sm transition text-center ${
              isClosed
                ? "bg-slate-200 text-slate-500 cursor-not-allowed pointer-events-none"
                : "bg-primary-container text-on-primary hover:bg-primary-hover"
            }`}
          >
            View Ticket
          </Link>
        </div>
      </div>
    </div>
  );
};

export default TicketItem;
