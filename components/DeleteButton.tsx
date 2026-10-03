"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { FaTrashAlt } from "react-icons/fa";
import { toast } from "sonner";

type ActionState = { success: boolean; message: string };

/**
 * Shared delete control for attachments and comments.
 *
 * Deletion is irreversible (attachments also destroy the Cloudinary asset), so
 * the first click only arms a confirmation — one wasted click beats deleting a
 * file. `action` is a server action passed down from a server component, which
 * App Router supports.
 *
 * Two presentations, because the surrounding geometry differs:
 *
 * - `card` — an attachment thumbnail. The trigger is a trash button over the
 *   tile's top-right corner and the confirmation paints an in-card overlay
 *   (`absolute inset-0`), so nothing is appended below the tile and the
 *   attachment row never reflows.
 * - `inline` — a comment header or a file row, which have no bounded square to
 *   cover. The confirmation expands in place beside the trigger.
 *
 * The card overlay stays mounted and is toggled with opacity/visibility rather
 * than rendered conditionally: `invisible` keeps it out of the tab order and the
 * accessibility tree while closed, but still allows the 200ms fade both ways.
 */
const DeleteButton = ({
  action,
  payload,
  itemLabel,
  variant = "inline",
}: {
  action: (prev: ActionState, data: FormData) => Promise<ActionState>;
  payload: Record<string, string>;
  itemLabel: string;
  /** `card` for bounded image tiles, `inline` for rows and comment headers. */
  variant?: "card" | "inline";
}) => {
  const [state, formAction, pending] = useActionState(action, {
    success: false,
    message: "",
  });
  const [armed, setArmed] = useState(false);

  const hasArmed = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const promptId = useId();

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

  // This code has a bug: it always dismiss the confirmation
  // Escape and outside-click dismiss the confirmation without deleting. The
  // overlay covers the whole tile, so pointer events inside it never reach the
  // image link underneath.
  // useEffect(() => {
  //   if (!armed) return;
  //   const onKeyDown = (event: KeyboardEvent) => {
  //     if (event.key === "Escape") setArmed(false);
  //   };
  //   const onPointerDown = (event: PointerEvent) => {
  //     if (!overlayRef.current?.contains(event.target as Node)) setArmed(false);
  //   };
  //   document.addEventListener("keydown", onKeyDown);
  //   document.addEventListener("pointerdown", onPointerDown);
  //   return () => {
  //     document.removeEventListener("keydown", onKeyDown);
  //     document.removeEventListener("pointerdown", onPointerDown);
  //   };
  // }, [armed]);

  // Move focus into the overlay when it opens and back to the trigger when it
  // closes. Skipped on mount so a page load never steals focus.
  useEffect(() => {
    if (!hasArmed.current) return;
    if (armed) cancelRef.current?.focus();
    else triggerRef.current?.focus();
  }, [armed]);

  const arm = () => {
    hasArmed.current = true;
    setArmed(true);
  };

  const hiddenInputs = Object.entries(payload).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));

  if (variant === "card") {
    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onClick={arm}
          title={`Delete this ${itemLabel}`}
          aria-label={`Delete this ${itemLabel}`}
          aria-haspopup="dialog"
          aria-expanded={armed}
          className={`absolute top-1.5 right-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-all duration-200 hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
            armed ? "invisible opacity-0" : ""
          }`}
        >
          <FaTrashAlt className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <div
          ref={overlayRef}
          role="dialog"
          aria-labelledby={promptId}
          // `inert` rather than `invisible`: it takes the overlay out of the tab
          // order and the accessibility tree without adding a transitionable
          // `visibility`, which would otherwise make the Cancel button
          // unfocusable for the first frame of the fade-in and silently drop
          // the focus() below.
          inert={!armed}
          className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded bg-black/75 p-2 text-center backdrop-blur-sm transition-all duration-200 ${
            armed ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <p
            id={promptId}
            className="px-0.5 text-[10px] font-medium leading-tight text-white"
          >
            Delete this {itemLabel}?
          </p>
          <form action={formAction} className="flex items-center gap-1">
            {hiddenInputs}
            <button
              ref={cancelRef}
              type="button"
              onClick={() => setArmed(false)}
              disabled={pending}
              className="rounded bg-gray-700/80 px-1.5 py-1 text-[10px] font-medium text-gray-200 transition-all duration-200 hover:bg-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-red-600 px-1.5 py-1 text-[10px] font-medium text-white transition-all duration-200 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
            >
              {pending ? "…" : "Delete"}
            </button>
          </form>
        </div>
      </>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      {!armed ? (
        <button
          type="button"
          onClick={() => {
            arm();
            console.log("Delete button 1 clicked");
          }}
          title={`Delete this ${itemLabel}`}
          className={`text-gray-400 hover:text-red-600 transition text-xs px-1.5 py-0.5 rounded border border-gray-200 hover:border-red-300 bg-white`}
        >
          Delete
        </button>
      ) : (
        <form action={formAction} className="inline-flex items-center gap-1">
          {hiddenInputs}
          <button
            type="submit"
            disabled={pending}
            className="text-xs px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-60"
            onClick={() => console.log("Delete button clicked")}
          >
            {pending ? "…" : "Delete"}
          </button>
          <button
            type="button"
            onClick={() => {
              setArmed(false);
              console.log("cancel clicked");
            }}
            disabled={pending}
            className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-60"
          >
            Cancel
          </button>
        </form>
      )}
    </span>
  );
};

export default DeleteButton;
