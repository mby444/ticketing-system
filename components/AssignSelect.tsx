"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { assignTicket } from "@/actions/ticket.actions";

type AgentOption = {
  id: string;
  name: string | null;
  email: string;
};

const AssignSelect = ({
  ticketId,
  assigneeId,
  agents,
}: {
  ticketId: number;
  assigneeId: string | null;
  agents: AgentOption[];
}) => {
  const initialState = {
    success: false,
    message: "",
  };

  const [state, formAction, pending] = useActionState(
    assignTicket,
    initialState,
  );

  const [currentAssigneeId, setCurrentAssigneeId] = useState(assigneeId);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentAssigneeId(e.target.value);
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
        key={assigneeId ?? ""}
        name="assigneeId"
        defaultValue={assigneeId ?? ""}
        disabled={pending}
        onChange={handleSelect}
        className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60"
      >
        <option value="">Unassigned</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name ?? agent.email}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || currentAssigneeId === assigneeId}
        className={`bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg px-3 py-2 shadow-sm transition ${pending || currentAssigneeId === assigneeId ? "opacity-60 cursor-not-allowed disabled:opacity-60" : ""}`}
      >
        {pending
          ? "Assigning…"
          : currentAssigneeId === assigneeId
            ? "Saved"
            : "Assign"}
      </button>
    </form>
  );
};

export default AssignSelect;
