import { getTickets } from "@/actions/ticket.actions";
import TicketItem from "@/components/TicketItem";
import { requireUser } from "@/lib/authorization";

const TicketsPage = async () => {
  await requireUser();

  const tickets = await getTickets();

  return (
    <div className="min-h-screen bg-surface p-6 md:p-8">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <h1 className="text-headline-lg text-slate-900 tracking-tight">
            Support Tickets
          </h1>
          <p className="text-body-md text-slate-500">
            {tickets.length} ticket{tickets.length === 1 ? "" : "s"} in your queue
          </p>
        </div>
        {tickets.length === 0 ? (
          <p className="text-center text-slate-600">No Tickets Yet</p>
        ) : (
          <div className="space-y-4">
            {tickets.map((ticket) => (
              <TicketItem key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TicketsPage;
