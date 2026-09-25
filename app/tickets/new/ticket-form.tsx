"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/actions/ticket.actions";
import { toast } from "sonner";

// Duplicated from lib/cloudinary.ts — that module imports the Cloudinary SDK
// and must never enter the client bundle. Server-side checks stay authoritative.
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;

const NewTicketForm = () => {
  const [state, formAction, pending] = useActionState(createTicket, {
    success: false,
    message: "",
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      // Success navigates away (component unmounts, resetting file state);
      // on failure the selection is kept so the user can retry directly.
      toast.success(state.message);
      router.push("/tickets");
    }
    if (!state.success && state.message) {
      toast.error(state.message);
    }
  }, [state, router]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);

    const invalid = chosen.find((file) => file.size === 0);
    if (invalid) {
      toast.error(`"${invalid.name}" is empty`);
      event.target.value = "";
      setSelectedFiles([]);
      return;
    }

    const oversized = chosen.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) {
      toast.error(`"${oversized.name}" is larger than 5 MB`);
      event.target.value = "";
      setSelectedFiles([]);
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
      setSelectedFiles([]);
      return;
    }

    if (chosen.length > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} files per ticket`);
      event.target.value = "";
      setSelectedFiles([]);
      return;
    }

    setSelectedFiles(chosen);
  };

  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="w-full max-w-md bg-white shadow-md rounded-lg p-8 border border-gray-200">
      <h1 className="text-3xl font-bold mb-6 text-center text-blue-600">
        Submit a Support Ticket
      </h1>
      <form action={formAction} className="space-y-4 text-gray-700">
        <input
          className="w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
          type="text"
          name="subject"
          placeholder="Subject"
          disabled={pending}
        />
        <textarea
          className="w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
          name="description"
          placeholder="Describe your issue"
          rows={4}
          disabled={pending}
        />
        <select
          className="w-full border border-gray-200 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-700"
          name="priority"
          defaultValue="Low"
          disabled={pending}
        >
          <option value="Low">Low Priority</option>
          <option value="Medium">Medium Priority</option>
          <option value="High">High Priority</option>
        </select>

        <div>
          <label
            htmlFor="attachments"
            className="block text-sm font-medium mb-1 text-gray-600"
          >
            Attachments (optional)
          </label>
          <input
            id="attachments"
            className="w-full text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-blue-700 hover:file:bg-blue-100"
            type="file"
            name="attachments"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={handleFileChange}
            disabled={pending}
          />
          <p className="text-xs text-gray-400 mt-1">
            JPG, PNG, WebP, or PDF — up to {MAX_FILES} files, max 5 MB each
          </p>
          {selectedFiles.length > 0 && (
            <div className="mt-2 text-xs text-gray-500">
              <p>
                {selectedFiles.length} file
                {selectedFiles.length === 1 ? "" : "s"} ·{" "}
                {(totalSize / 1024).toFixed(0)} KB
              </p>
              <ul className="mt-1 space-y-0.5 text-gray-600">
                {selectedFiles.map((file) => (
                  <li
                    key={`${file.name}-${file.size}`}
                    className="flex justify-between gap-2"
                  >
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-gray-400">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <button
          className="w-full bg-blue-600 text-white p-3 rounded hover:bg-blue-700 transition disabled:opacity-50"
          type="submit"
          disabled={pending}
        >
          {pending ? "Uploading…" : "Submit"}
        </button>
      </form>
    </div>
  );
};

export default NewTicketForm;
