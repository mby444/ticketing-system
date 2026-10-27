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

const Chevron = () => (
  <svg
    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

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
      <div className="relative inline-flex items-center">
        <select
          key={status}
          name="status"
          defaultValue={status}
          disabled={pending}
          onChange={handleSelect}
          className="appearance-none bg-surface-container-lowest text-slate-700 pl-3 pr-8 py-1.5 rounded-lg shadow-sm font-label-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Chevron />
      </div>
      <button
        type="submit"
        disabled={pending || currentStatus === status}
        className={`bg-primary-container hover:bg-primary-hover text-on-primary font-medium rounded-lg px-3 py-1.5 shadow-sm transition text-label-md ${
          pending || currentStatus === status
            ? "opacity-60 cursor-not-allowed"
            : ""
        }`}
      >
        {pending ? "Saving?" : currentStatus === status ? "Saved" : "Save"}
      </button>
    </form>
  );
};

export default StatusSelect;
