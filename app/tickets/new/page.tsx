import NewTicketForm from "./ticket-form";
import { requireUser } from "@/lib/authorization";

const NewTicketPage = async () => {
  await requireUser();

  return (
    <div className="min-h-screen bg-surface p-6 md:p-8 flex items-start justify-center">
      <NewTicketForm />
    </div>
  );
};

export default NewTicketPage;
