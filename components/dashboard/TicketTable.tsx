import Link from "next/link";
import StatusSelect from "@/components/dashboard/StatusSelect";
import AssignSelect from "@/components/dashboard/AssignSelect";
import type { getAllTickets, listAgents } from "@/actions/ticket.actions";

type Tickets = Awaited<ReturnType<typeof getAllTickets>>;
type Agents = Awaited<ReturnType<typeof listAgents>>;

export type DashboardTicket = Tickets[number];

/**
 * The staff-dashboard ticket table, shared by every section
 * ("Assigned to me", "Other tickets"). Server component — the
 * StatusSelect/AssignSelect children are client components.
 */
const TicketTable = ({
  tickets,
  agents,
}: {
  tickets: DashboardTicket[];
  agents: Agents;
}) => (
  <div className="bg-white rounded-lg shadow border border-gray-200 overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
        <tr>
          <th className="px-4 py-3">Ticket</th>
          <th className="px-4 py-3">Requester</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Assignee</th>
          <th className="px-4 py-3">Created</th>
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
              <p className="text-xs text-gray-500">
                #{ticket.id} · {ticket.priority} priority
              </p>
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
