"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addTicketComment } from "@/actions/ticket.actions";
import {
  ALLOWED_MIME_TYPES,
  MAX_COMMENT_FILES,
  MAX_FILE_SIZE,
} from "@/lib/attachment-limits";

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
      if (formRef.current) formRef.current.reset();
    } else if (!state.success && state.message) {
      toast.error(state.message);
    }
  }, [state]);

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

  if (isClosed) {
    return (
      <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/60 p-4">
        This ticket is closed. Reopen it to continue the conversation.
      </p>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-5 space-y-4"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <div>
        <label
          htmlFor="comment-body"
          className="mb-1.5 block text-sm font-medium text-slate-700"
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
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
        />
      </div>
      <div>
        <label
          htmlFor="comment-attachments"
          className="mb-1.5 block text-sm font-medium text-slate-700"
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
          className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-indigo-700 hover:file:bg-indigo-100"
        />
        <p className="text-xs text-slate-400 mt-1">
          JPG, PNG, WebP, or PDF — up to {MAX_COMMENT_FILES} files per comment,
          max 5 MB each
        </p>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          Up to {MAX_COMMENT_LENGTH} characters
        </p>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post comment"}
        </button>
      </div>
    </form>
  );
};

export default CommentForm;