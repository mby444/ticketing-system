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

/**
 * A sortable column header.
 *
 * A `<Link>` rather than a `<button onClick>`, for the same reason the filter
 * chips are links: the active sort lives in `?sort=`, so the view is
 * bookmarkable, survives a refresh, works without JS, and the browser gets
 * ordinary link behaviour (middle-click, copy address).
 *
 * `aria-sort` is the accessible half of the state; the caret is `aria-hidden` so
 * a screen reader announces "Status, ascending" rather than reading a glyph.
 */
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
      className={`px-4 py-3 ${className}`}
    >
      <Link
        href={buildDashboardHref({ filter, sort: target })}
        scroll={false}
        title={`Sort by ${label.toLowerCase()}`}
        className="inline-flex items-center gap-1 hover:text-gray-800 transition"
      >
        {label}
        <span aria-hidden="true" className="text-[9px] leading-none">
          {active ? (ascending ? "▲" : "▼") : "↕"}
        </span>
      </Link>
    </th>
  );
};

/**
 * The staff-dashboard ticket table, shared by every section
 * ("Assigned to me", "Other tickets") and by the single filtered table.
 * Server component — the StatusSelect/AssignSelect children are client
 * components, but sorting needs no client code at all.
 */
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
  <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
        <tr>
          {/* Not sortable: no subject sort. */}
          <th scope="col" className="px-4 py-3">
            Ticket
          </th>
          <SortableHeader field="priority" label="Priority" filter={filter} sort={sort} />
          <SortableHeader field="requester" label="Requester" filter={filter} sort={sort} />
          <SortableHeader field="status" label="Status" filter={filter} sort={sort} />
          <SortableHeader field="assignee" label="Assignee" filter={filter} sort={sort} />
          <SortableHeader field="created" label="Created" filter={filter} sort={sort} />
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {tickets.map((ticket) => (
          <tr key={ticket.id} className="hover:bg-gray-50 align-top">
            <td className="px-4 py-3">
              <Link
                href={`/tickets/${ticket.id}`}
                className="font-medium text-blue-600 hover:underline"
              >
                {ticket.subject}
              </Link>
              {/* Priority now has its own column, so it must not repeat here. */}
              <p className="text-xs text-gray-500">#{ticket.id}</p>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">
              <span className={getPriorityClass(ticket.priority)}>
                {ticket.priority}
              </span>
            </td>
            <td className="px-4 py-3">
              <p>{ticket.user.name ?? ticket.user.email}</p>
              <p className="text-xs text-gray-500">{ticket.user.email}</p>
            </td>
            <td className="px-4 py-3">
              <StatusSelect ticketId={ticket.id} status={ticket.status} />
            </td>
            <td className="px-4 py-3">
              <AssignSelect
                ticketId={ticket.id}
                assigneeId={ticket.assigneeId}
                agents={agents}
              />
            </td>
            <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
              {new Date(ticket.createdAt).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default TicketTable;