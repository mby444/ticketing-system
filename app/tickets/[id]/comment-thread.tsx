import type { Role } from "@/generated/prisma/client";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import { deleteComment } from "@/actions/ticket.actions";
import DeleteButton from "@/components/DeleteButton";

/** Mirrors the `comments` include in getTicketById. */
type TicketCommentView = {
  id: number;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    role: Role;
  };
  deletedBy: { id: string; name: string | null; email: string } | null;
};

/**
 * Chronological, flat comment thread. Server component — `isStaff` costs
 * nothing here. The author badge distinguishes support replies from customer
 * ones; the viewer's own comments are right-aligned for readability.
 *
 * Soft-deleted comments keep their place in the list and render as "[removed]"
 * with the body withheld — a thread that simply lost a support reply reads as if
 * the customer were talking to themselves. The author name stays visible so the
 * shape of the conversation is preserved, but the text is gone for good.
 */
const CommentThread = ({
  comments,
  viewerId,
  ticketOwnerId,
  isClosed,
  viewer,
}: {
  comments: TicketCommentView[];
  ticketOwnerId: string;
  viewerId: string;
  isClosed: boolean;
  viewer: { id: string; role: Role };
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
        const staff = comment.user.id !== ticketOwnerId;
        const mine = comment.user.id === viewerId;
        const removed = comment.deletedAt !== null;
        const canDelete =
          !removed && canDeleteUserContent(viewer, comment.user.id);

        return (
          <li
            key={comment.id}
            className={`flex ${mine ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg border p-3 ${
                removed
                  ? "bg-gray-50 border-gray-200"
                  : staff
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
                {canDelete && (
                  <DeleteButton
                    action={deleteComment}
                    payload={{ commentId: String(comment.id) }}
                    itemLabel="comment"
                  />
                )}
              </div>
              {removed ? (
                <p className="text-sm text-gray-400 italic">
                  Comment removed
                  {comment.deletedBy && (
                    <span className="text-gray-300">
                      {" "}
                      by {comment.deletedBy.name ?? comment.deletedBy.email}
                    </span>
                  )}
                </p>
              ) : (
                /* Rendered as text: React escapes it, so never use raw HTML here. */
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                  {comment.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default CommentThread;
