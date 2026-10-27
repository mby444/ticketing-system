import Link from "next/link";
import StatusSelect from "@/components/dashboard/StatusSelect";
import AssignSelect from "@/components/AssignSelect";
import type { getAllTickets, listAgents } from "@/actions/ticket.actions";
import {
  buildDashboardHref,
  isAscending,
  nextSortFor,
  sortFieldOf,
  type DashboardSort,
  type DashboardSortField,
} from "@/lib/dashboard-sort";
import { type DashboardFilter } from "@/lib/dashboard-filters";
import { getPriorityClass } from "@/utils/ui";

type Tickets = Awaited<ReturnType<typeof getAllTickets>>;
type Agents = Awaited<ReturnType<typeof listAgents>>;

export type DashboardTicket = Tickets[number];

const SortableHeader = ({
  field,
  label,
  filter,
  sort,
  className = "",
}: {
  field: DashboardSortField;
  label: string;
  filter: DashboardFilter;
  sort: DashboardSort;
  className?: string;
}) => {
  const active = sortFieldOf(sort) === field;
  const ascending = isAscending(sort);
  const target = nextSortFor(field, sort);

  return (
    <th
      scope="col"
      aria-sort={active ? (ascending ? "ascending" : "descending") : "none"}
      className={`py-3.5 px-4 text-left ${className}`}
    >
      <Link
        href={buildDashboardHref({ filter, sort: target })}
        scroll={false}
        title={`Sort by ${label.toLowerCase()}`}
        className="inline-flex items-center gap-1.5 hover:text-slate-800 transition-colors"
      >
        <span className="font-label-sm uppercase tracking-wider">{label}</span>
        <span aria-hidden="true" className="text-[12px] leading-none">
          {active ? (ascending ? "?" : "?") : "?"}
        </span>
      </Link>
    </th>
  );
};

const initialsOf = (name: string | null, email: string) => {
  const source = (name ?? email).trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

const TicketTable = ({
  tickets,
  agents,
  filter,
  sort,
}: {
  tickets: DashboardTicket[];
  agents: Agents;
  filter: DashboardFilter;
  sort: DashboardSort;
}) => (
  <div className="bg-surface-container-lowest shadow-card rounded-xl overflow-hidden flex flex-col">
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-surface-container-low text-slate-500 font-label-sm uppercase tracking-wider">
            <th className="py-3.5 px-4" scope="col">
              <span className="font-label-sm">Ticket</span>
            </th>
            <SortableHeader field="priority" label="Priority" filter={filter} sort={sort} />
            <SortableHeader field="requester" label="Requester" filter={filter} sort={sort} />
            <th className="py-3.5 px-4" scope="col">
              <span className="font-label-sm">Status</span>
            </th>
            <SortableHeader field="assignee" label="Assignee" filter={filter} sort={sort} />
            <SortableHeader field="created" label="Created" filter={filter} sort={sort} className="text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-800 text-body-sm">
          {tickets.map((ticket) => (
            <tr
              key={ticket.id}
              className="group hover:bg-slate-50/60 transition-colors"
            >
              <td className="py-3.5 px-4">
                <div className="flex flex-col">
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="font-title-md text-body-md font-semibold text-slate-900 group-hover:text-primary transition-colors flex items-center gap-2"
                  >
                    <span>{ticket.subject}</span>
                    <span className="font-label-sm text-slate-500 font-normal">
                      #{ticket.id}
                    </span>
                  </Link>
                </div>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <span className={getPriorityClass(ticket.priority)}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                  {ticket.priority}
                </span>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center font-label-sm font-bold text-slate-700">
                    {initialsOf(ticket.user.name, ticket.user.email)}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-title-md text-body-sm font-semibold text-slate-800 leading-tight">
                      {ticket.user.name ?? ticket.user.email}
                    </span>
                    <span className="text-label-sm text-slate-500 leading-tight">
                      {ticket.user.email}
                    </span>
                  </div>
                </div>
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <StatusSelect ticketId={ticket.id} status={ticket.status} />
              </td>
              <td className="py-3.5 px-4 whitespace-nowrap">
                <AssignSelect
                  ticketId={ticket.id}
                  assigneeId={ticket.assigneeId}
                  agents={agents}
                />
              </td>
              <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap text-right">
                {new Date(ticket.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default TicketTable;
