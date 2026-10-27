"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/actions/ticket.actions";
import { PRIORITY_OPTIONS } from "@/lib/priority";
import { toast } from "sonner";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 5;

const PRIORITY_ACCENT: Record<string, string> = {
  Low: "border-slate-300 text-slate-700",
  Medium: "border-amber-300 text-amber-700",
  High: "border-rose-300 text-rose-700",
  Critical: "border-purple-300 text-purple-700",
};

const NewTicketForm = () => {
  const [state, formAction, pending] = useActionState(createTicket, {
    success: false,
    message: "",
  });

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [priority, setPriority] = useState<string>("Low");
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
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
    <div className="w-full max-w-3xl mx-auto bg-surface-container-lowest shadow-card rounded-2xl border border-slate-200 p-8">
      <div className="mb-6 text-center">
        <h1 className="text-headline-md text-slate-900">Submit a Support Ticket</h1>
        <p className="mt-1 text-body-md text-slate-500">
          Tell us what you need help with
        </p>
      </div>
      <form action={formAction} className="space-y-6 text-slate-700">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Subject
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            type="text"
            name="subject"
            placeholder="Brief summary of your issue"
            disabled={pending}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            name="description"
            placeholder="Describe your issue in detail"
            rows={5}
            disabled={pending}
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">
            Priority
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PRIORITY_OPTIONS.map((option) => {
              const selected = priority === option;
              return (
                <label
                  key={option}
                  className={`cursor-pointer rounded-xl border-2 p-3 text-center transition ${
                    selected
                      ? "border-indigo-600 bg-indigo-50 shadow-sm"
                      : `bg-white hover:border-slate-400 ${PRIORITY_ACCENT[option]}`
                  }`}
                >
                  <input
                    type="radio"
                    name="priority"
                    value={option}
                    checked={selected}
                    onChange={() => setPriority(option)}
                    disabled={pending}
                    className="sr-only"
                  />
                  <span
                    className={`block text-sm font-semibold ${
                      selected ? "text-indigo-700" : ""
                    }`}
                  >
                    {option}
                  </span>
                  <span
                    className={`mt-1 block text-[10px] uppercase tracking-wide ${
                      selected ? "text-indigo-500" : "text-slate-400"
                    }`}
                  >
                    Priority
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label
            htmlFor="attachments"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            Attachments (optional)
          </label>
          <label
            htmlFor="attachments"
            className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40"
          >
            <span className="text-sm font-medium text-slate-700">
              Drag &amp; drop files here, or click to browse
            </span>
            <span className="mt-1 text-xs text-slate-400">
              JPG, PNG, WebP, or PDF — up to {MAX_FILES} files, max 5 MB each
            </span>
            <input
              id="attachments"
              className="sr-only"
              type="file"
              name="attachments"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={handleFileChange}
              disabled={pending}
            />
          </label>
          {selectedFiles.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-700">
                {selectedFiles.length} file
                {selectedFiles.length === 1 ? "" : "s"} ·{" "}
                {(totalSize / 1024).toFixed(0)} KB
              </p>
              <ul className="mt-1.5 space-y-1">
                {selectedFiles.map((file) => (
                  <li
                    key={`${file.name}-${file.size}`}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-slate-400">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <button
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={pending}
        >
          {pending ? "Submitting…" : "Submit Ticket"}
        </button>
      </form>
    </div>
  );
};

export default NewTicketForm;