import { getTickets } from "@/actions/ticket.actions";
import TicketItem from "@/components/TicketItem";
import { requireUser } from "@/lib/authorization";

const TicketsPage = async () => {
  await requireUser();

  const tickets = await getTickets();

  return (
    <div className="min-h-screen bg-blue-50 p-8">
      <h1 className="text-3xl font-bold text-blue-600 mb-8 text-center">
        Support Tickets
      </h1>
      {tickets.length === 0 ? (
        <p className="text-center text-gray-600">No Tickets Yet</p>
      ) : (
        <div className="space-y-4 max-w-3xl mx-auto">
          {tickets.map((ticket) => (
            <TicketItem key={ticket.id} ticket={ticket} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TicketsPage;
