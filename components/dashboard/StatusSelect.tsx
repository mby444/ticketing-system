"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTicketStatus } from "@/actions/ticket.actions";
import type { TicketStatus } from "@/generated/prisma/client";

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "Open", label: "Open" },
  { value: "In_Progress", label: "In Progress" },
  { value: "Resolved", label: "Resolved" },
  { value: "Closed", label: "Closed" },
];

const StatusSelect = ({
  ticketId,
  status,
}: {
  ticketId: number;
  status: TicketStatus;
}) => {
  const initialState = {
    success: false,
    message: "",
  };

  const [state, formAction, pending] = useActionState(
    updateTicketStatus,
    initialState,
  );

  const [currentStatus, setCurrentStatus] = useState<TicketStatus>(status);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentStatus(e.target.value as TicketStatus);
  };

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <select
        key={status}
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={handleSelect}
        className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-60"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || currentStatus === status}
        className={`bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition ${pending || currentStatus === status ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {pending ? "Saving…" : currentStatus === status ? "Saved" : "Save"}
      </button>
    </form>
  );
};

export default StatusSelect;
