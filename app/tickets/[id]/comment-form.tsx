"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addTicketComment } from "@/actions/ticket.actions";
import {
  ALLOWED_MIME_TYPES,
  MAX_COMMENT_FILES,
  MAX_FILE_SIZE,
} from "@/lib/attachment-limits";

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

  // Same pre-checks as attach-form.tsx. These are affordances only: the action
  // re-validates every file server-side, and its verdict is the one that counts.
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);

    const empty = chosen.find((file) => file.size === 0);
    if (empty) {
      toast.error(`"${empty.name}" is empty`);
      event.target.value = "";
      return;
    }

    const oversized = chosen.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      toast.error(`"${oversized.name}" is larger than 5 MB`);
      event.target.value = "";
      return;
    }

    const wrongType = chosen.find(
      (file) => !(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type),
    );
    if (wrongType) {
      toast.error(
        `"${wrongType.name}" is not a supported format (JPG, PNG, WebP, PDF)`,
      );
      event.target.value = "";
      return;
    }

    if (chosen.length > MAX_COMMENT_FILES) {
      toast.error(`Maximum ${MAX_COMMENT_FILES} files per comment`);
      event.target.value = "";
      return;
    }
  };

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
      <div>
        <label
          htmlFor="comment-attachments"
          className="block text-sm font-medium text-gray-600"
        >
          Attachments (optional)
        </label>
        <input
          id="comment-attachments"
          type="file"
          name="attachments"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleFileChange}
          disabled={pending}
          className="text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-blue-700 hover:file:bg-blue-100"
        />
        <p className="text-xs text-gray-400 mt-1">
          JPG, PNG, WebP, or PDF — up to {MAX_COMMENT_FILES} files per comment,
          max 5 MB each
        </p>
      </div>
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
