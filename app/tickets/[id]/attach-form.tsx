"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addAttachments } from "@/actions/ticket.actions";

// Duplicated from lib/cloudinary.ts (client bundle must not pull in the SDK).
// Server-side checks in the action stay authoritative.
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
      className="border-t border-gray-100 pt-4"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <label
        htmlFor="attach-more"
        className="block text-sm font-medium text-gray-600 mb-1"
      >
        Add attachments
      </label>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          id="attach-more"
          className="text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-blue-700 hover:file:bg-blue-100"
          type="file"
          name="attachments"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleChange}
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition disabled:opacity-60"
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-1">
        JPG, PNG, WebP, or PDF — up to {MAX_FILES} files per ticket, max 5 MB
        each
      </p>
    </form>
  );
};

export default AttachForm;
