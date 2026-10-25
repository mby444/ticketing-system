import NewTicketForm from "./ticket-form";
import { requireUser } from "@/lib/authorization";

const NewTicketPage = async () => {
  await requireUser();

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <NewTicketForm />
    </div>
  );
};

export default NewTicketPage;
