"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { markAllNotificationsRead } from "@/actions/notification.actions";

/**
 * "Mark all read" for the /notifications page. Hidden entirely when there is
 * nothing unread, rather than rendered disabled — a control that can never do
 * anything is noise, and the count beside it already says the same thing.
 */
const MarkAllReadButton = ({ unreadCount }: { unreadCount: number }) => {
  const [state, formAction] = useActionState(markAllNotificationsRead, {
    success: false,
    message: "",
  });

  useEffect(() => {
    if (state.success) toast.success(state.message);
  }, [state]);

  if (unreadCount === 0) return null;

  return (
    <form action={formAction}>
      <button
        type="submit"
        className="text-sm font-medium text-blue-600 transition hover:text-blue-800"
      >
        Mark all read
      </button>
    </form>
  );
};

export default MarkAllReadButton;