import { isStaff } from "@/lib/authorization";
import type { Role } from "@/generated/prisma/client";

/** Mirrors the `comments` include in getTicketById. */
type TicketCommentView = {
  id: number;
  body: string;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: Role;
  };
};

/**
 * Chronological, flat comment thread. Server component — `isStaff` costs
 * nothing here. The author badge distinguishes support replies from customer
 * ones; the viewer's own comments are right-aligned for readability.
 */
const CommentThread = ({
  comments,
  viewerId,
  isClosed,
}: {
  comments: TicketCommentView[];
  viewerId: string;
  isClosed: boolean;
}) => {
  if (comments.length === 0) {
    return (
      <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded p-4">
        {isClosed
          ? "No comments on this ticket."
          : "No comments yet — start the conversation below."}
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {comments.map((comment) => {
        const staff = isStaff(comment.user);
        const mine = comment.user.id === viewerId;

        return (
          <li
            key={comment.id}
            className={`flex ${mine ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg border p-3 ${
                staff
                  ? "bg-blue-50 border-blue-200"
                  : "bg-white border-gray-200"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-800">
                  {comment.user.name ?? comment.user.email}
                </span>
                {staff && (
                  <span className="text-xs uppercase tracking-wide bg-blue-600 text-white rounded px-1.5 py-0.5">
                    Support Staff
                  </span>
                )}
                <time className="text-xs text-gray-400 ml-auto whitespace-nowrap">
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </div>
              {/* Rendered as text: React escapes it, so never use raw HTML here. */}
              <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                {comment.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default CommentThread;
