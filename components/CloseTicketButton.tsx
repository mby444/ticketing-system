"use client";

import { useActionState, useEffect } from "react";
import { closeTicket } from "@/actions/ticket.actions";
import { toast } from "sonner";

const CloseTicketButton = ({
  ticketId,
  isClosed,
}: {
  ticketId: number;
  isClosed: boolean;
}) => {
  const initialState = {
    success: false,
    message: "",
  };

  const [state, formAction] = useActionState(closeTicket, initialState);

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  if (isClosed) return null;

  return (
    <form action={formAction}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <button
        type="submit"
        className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700"
      >
        Close Ticket
      </button>
    </form>
  );
};

export default CloseTicketButton;
