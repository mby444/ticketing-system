"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

type ActionState = { success: boolean; message: string };

/**
 * Shared delete control for attachments and comments.
 *
 * Deletion is irreversible (attachments also destroy the Cloudinary asset), so
 * the first click only arms a confirmation — one wasted click beats deleting a
 * file. `action` is a server action passed down from a server component, which
 * App Router supports.
 */
const DeleteButton = ({
  action,
  payload,
  itemLabel,
  className = "",
}: {
  action: (prev: ActionState, data: FormData) => Promise<ActionState>;
  payload: Record<string, string>;
  itemLabel: string;
  className?: string;
}) => {
  const [state, formAction, pending] = useActionState(action, {
    success: false,
    message: "",
  });
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    // No state reset here on purpose. After a successful delete the control is
    // gone regardless: the attachment row is removed from the array entirely,
    // and a soft-deleted comment stops rendering its button (canDelete requires
    // !removed). Resetting would mean a setState in the effect, which trips
    // react-hooks/set-state-in-effect. On failure the button simply stays armed
    // so the user can retry or back out.
    if (state.message) {
      if (state.success) toast.success(state.message);
      else toast.error(state.message);
    }
  }, [state]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        title={`Delete this ${itemLabel}`}
        className={`text-gray-400 hover:text-red-600 transition text-xs px-1.5 py-0.5 rounded border border-gray-200 hover:border-red-300 bg-white ${className}`}
      >
        Delete
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-1 absolute">
      {Object.entries(payload).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        disabled={pending}
        className="text-xs px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-60"
      >
        {pending ? "…" : "Sure?"}
      </button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        disabled={pending}
        className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-60"
      >
        No
      </button>
    </form>
  );
};

export default DeleteButton;
