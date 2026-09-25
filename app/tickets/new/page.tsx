import NewTicketForm from "./ticket-form";
import { requireUser } from "@/lib/authorization";

const NewTicketPage = async () => {
  await requireUser();

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center px-4">
      <NewTicketForm />
    </div>
  );
};

export default NewTicketPage;
