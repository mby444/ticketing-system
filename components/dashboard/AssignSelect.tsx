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
        className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-60"
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
        className={`bg-blue-600 text-white text-sm px-3 py-1 rounded hover:bg-blue-700 transition ${pending || currentAssigneeId === assigneeId ? "opacity-60 cursor-not-allowed" : ""}`}
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
