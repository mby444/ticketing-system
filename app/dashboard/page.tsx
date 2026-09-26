import { getAllTickets, listAgents } from "@/actions/ticket.actions";
import { requireRole, STAFF_ROLES } from "@/lib/authorization";
import TicketTable from "@/components/dashboard/TicketTable";

const SectionHeading = ({
  title,
  count,
}: {
  title: string;
  count: number;
}) => (
  <div className="flex items-center gap-2 mb-3">
    <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
    <span className="text-xs font-semibold bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
      {count}
    </span>
  </div>
);

const EmptyNote = ({ children }: { children: string }) => (
  <p className="text-center text-sm text-gray-500 bg-white border border-dashed border-gray-200 rounded-lg py-6">
    {children}
  </p>
);

const StaffDashboardPage = async () => {
  const user = await requireRole(...STAFF_ROLES);
  const [tickets, agents] = await Promise.all([getAllTickets(), listAgents()]);

  // Partition of the single getAllTickets() query: "Assigned to me" sorts
  // active statuses before Closed, then newest first; "Other tickets"
  // keeps the original createdAt-desc order.
  const mine = tickets
    .filter((ticket) => ticket.assigneeId === user.id)
    .sort(
      (a, b) =>
        Number(a.status === "Closed") - Number(b.status === "Closed") ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const others = tickets.filter((ticket) => ticket.assigneeId !== user.id);

  return (
    <div className="min-h-screen bg-blue-50 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-blue-600 mb-2 text-center">
          Staff Dashboard
        </h1>
        <p className="text-center text-gray-600 mb-8">
          {mine.length} assigned to you · {tickets.length} ticket
          {tickets.length === 1 ? "" : "s"} total — update status and assign
          agents
        </p>

        {tickets.length === 0 ? (
          <p className="text-center text-gray-600">No Tickets Yet</p>
        ) : (
          <>
            <section className="mb-8">
              <SectionHeading title="Assigned to me" count={mine.length} />
              {mine.length === 0 ? (
                <EmptyNote>No tickets assigned to you yet</EmptyNote>
              ) : (
                <TicketTable tickets={mine} agents={agents} />
              )}
            </section>

            <section>
              <SectionHeading title="Other tickets" count={others.length} />
              {others.length === 0 ? (
                <EmptyNote>No other tickets</EmptyNote>
              ) : (
                <TicketTable tickets={others} agents={agents} />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default StaffDashboardPage;
