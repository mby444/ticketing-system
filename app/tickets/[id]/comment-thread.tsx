import type { Role } from "@/generated/prisma/client";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import { deleteComment, deleteCommentAttachment } from "@/actions/ticket.actions";
import AttachmentGrid, {
  type AttachmentView,
} from "@/components/AttachmentGrid";
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
  attachments: AttachmentView[];
};

/**
 * Chronological, flat comment thread. Server component.
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
      <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/60 p-4">
        {isClosed
          ? "No comments on this ticket."
          : "No comments yet — start the conversation below."}
      </p>
    );
  }

  return (
    <ol className="space-y-4">
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
              className={`max-w-[85%] rounded-2xl border p-4 shadow-sm ${
                removed
                  ? "bg-slate-100/60 border-slate-200 text-slate-500 italic"
                  : staff
                    ? "bg-indigo-50/50 border-indigo-100 rounded-tr-sm"
                    : "bg-white border-slate-200 rounded-tl-sm"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-slate-900">
                  {comment.user.name ?? comment.user.email}
                </span>
                {staff && (
                  <span className="text-[10px] uppercase tracking-wide bg-indigo-600 text-white rounded-full px-2 py-0.5">
                    Support Staff
                  </span>
                )}
                <time className="text-xs text-slate-400 ml-auto whitespace-nowrap">
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
                <p className="text-sm text-slate-500 italic">
                  Comment removed
                  {comment.deletedBy && (
                    <span className="text-slate-400">
                      {" "}
                      by {comment.deletedBy.name ?? comment.deletedBy.email}
                    </span>
                  )}
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                    {comment.body}
                  </p>
                  <div className="mt-3">
                    <AttachmentGrid
                      attachments={comment.attachments}
                      viewer={viewer}
                      ticketOwnerId={ticketOwnerId}
                      deleteAction={deleteCommentAttachment}
                      size="sm"
                      showBadge={false}
                    />
                  </div>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default CommentThread;