"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addAttachments } from "@/actions/ticket.actions";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;

const AttachForm = ({ ticketId }: { ticketId: number }) => {
  const [state, formAction, pending] = useActionState(addAttachments, {
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

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      (file) => !ALLOWED_MIME_TYPES.includes(file.type),
    );
    if (wrongType) {
      toast.error(
        `"${wrongType.name}" is not a supported format (JPG, PNG, WebP, PDF)`,
      );
      event.target.value = "";
      return;
    }

    if (chosen.length > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} files per upload`);
      event.target.value = "";
      return;
    }
  };

  return (
    <form
      ref={formRef}
      action={formAction}
      className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-5"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <label
        htmlFor="attach-more"
        className="mb-2 block text-sm font-medium text-slate-700"
      >
        Add attachments
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label
          htmlFor="attach-more"
          className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500 transition hover:border-indigo-400 hover:bg-indigo-50/40"
        >
          <span className="block font-medium text-slate-700">
            Click to choose files
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            JPG, PNG, WebP, or PDF — up to {MAX_FILES} files, max 5 MB each
          </span>
          <input
            id="attach-more"
            className="sr-only"
            type="file"
            name="attachments"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={handleChange}
            disabled={pending}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:self-end"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
    </form>
  );
};

export default AttachForm;