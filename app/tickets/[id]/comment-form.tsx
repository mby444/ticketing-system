"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addTicketComment } from "@/actions/ticket.actions";

// Duplicated from actions/ticket.actions.ts — the server-side check stays
// authoritative, this one only drives the UI affordance.
const MAX_COMMENT_LENGTH = 5000;

const CommentForm = ({
  ticketId,
  isClosed,
}: {
  ticketId: number;
  isClosed: boolean;
}) => {
  const [state, formAction, pending] = useActionState(addTicketComment, {
    success: false,
    message: "",
  });

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success && state.message) {
      toast.success(state.message);
      // revalidatePath refreshes the server payload but does not remount this
      // client component, so the textarea has to be cleared explicitly.
      if (formRef.current) formRef.current.reset();
    } else if (!state.success && state.message) {
      toast.error(state.message);
    }
  }, [state]);

  // Defence in depth — the action rejects Closed tickets for every role.
  if (isClosed) {
    return (
      <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded p-4">
        This ticket is closed. Reopen it to continue the conversation.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <label
        htmlFor="comment-body"
        className="block text-sm font-medium text-gray-600"
      >
        Add a comment
      </label>
      <textarea
        id="comment-body"
        name="body"
        rows={4}
        maxLength={MAX_COMMENT_LENGTH}
        placeholder="Write your reply…"
        disabled={pending}
        className="w-full border border-gray-200 p-3 rounded text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          Up to {MAX_COMMENT_LENGTH} characters
        </p>
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post comment"}
        </button>
      </div>
    </form>
  );
};

export default CommentForm;
