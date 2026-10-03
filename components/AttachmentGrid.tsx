import Image from "next/image";
import { FaFilePdf } from "react-icons/fa";
import { getThumbnailUrl } from "@/lib/cloudinary";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import DeleteButton from "@/components/DeleteButton";
import type { Role } from "@/generated/prisma/client";

/**
 * The one shape every attachment row has, whether it hangs off a ticket
 * (`TicketAttachment`) or a comment (`CommentAttachment`). The two tables carry
 * identical metadata columns precisely so this component can render both.
 */
export type AttachmentView = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  publicId: string;
  resourceType: string;
  createdAt: Date;
  uploadedBy: {
    id: string;
    name: string | null;
    email: string;
    role: Role;
  };
};

/** Server action shaped for `useActionState`, i.e. what DeleteButton accepts. */
type DeleteAction = (
  prev: { success: boolean; message: string },
  data: FormData,
) => Promise<{ success: boolean; message: string }>;

/**
 * Renders a set of attachments as image tiles and PDF rows. Server component.
 *
 * Extracted out of `AttachmentList` so the ticket page and the comment thread
 * share one implementation. The delete action and the form field carrying the
 * id are passed in, because the two tables have separate actions
 * (`deleteAttachment` vs `deleteCommentAttachment`) — sharing the *markup* is
 * worth it, sharing the *action* would have meant one action branching on which
 * table to touch.
 *
 * Two geometry notes carried over from the ticket-level list, both deliberate:
 *
 * - The image tile is a wrapper div, not the `<a>` itself: nesting the delete
 *   `<button>` inside a link is invalid interactive content and would also open
 *   the file on click. The control therefore floats over the tile (trash
 *   top-right, badge bottom-left) and confirms with an in-card overlay so the
 *   row never reflows.
 * - `sm` tiles are used inside a comment bubble, where the `lg` 96px square of
 *   the ticket page would dominate the message.
 *
 * `showBadge` is off inside the thread: the bubble already carries a "Support
 * Staff" badge for its author, and a second badge on the same message reads as
 * noise. The ticket-level list keeps it, because there the file is the only
 * thing carrying that information.
 */
const AttachmentGrid = ({
  attachments,
  viewer,
  ticketOwnerId,
  deleteAction,
  idField = "attachmentId",
  size = "lg",
  showBadge = true,
}: {
  attachments: AttachmentView[];
  viewer: { id: string; role: Role };
  ticketOwnerId: string;
  deleteAction: DeleteAction;
  /** Form field name carrying the attachment id into the action. */
  idField?: string;
  size?: "sm" | "lg";
  showBadge?: boolean;
}) => {
  if (attachments.length === 0) return null;

  const tileSize = size === "sm" ? "w-16 h-16" : "w-24 h-24";

  return (
    <div className="flex flex-wrap gap-3">
      {attachments.map((attachment) => {
        // The predicate is `uploader !== ticket owner`, not `isStaff(uploader)`:
        // a staff member attaching to their *own* ticket is not something the
        // customer needs to be told about.
        const fromSupport = showBadge && attachment.uploadedBy.id !== ticketOwnerId;
        const uploaderName =
          attachment.uploadedBy.name ?? attachment.uploadedBy.email;
        const trace = `Uploaded by ${uploaderName}${
          fromSupport ? " (QuickTicket support)" : ""
        } on ${new Date(attachment.createdAt).toLocaleString()}`;

        const canDelete = canDeleteUserContent(viewer, attachment.uploadedBy.id);

        const badge = fromSupport && (
          <span className="text-[10px] uppercase tracking-wide bg-blue-600 text-white rounded px-1 py-0.5 shrink-0 pointer-events-none">
            Support Staff
          </span>
        );

        const deleteControl = canDelete && (
          <DeleteButton
            action={deleteAction}
            payload={{ [idField]: attachment.id }}
            itemLabel="attachment"
            variant="card"
          />
        );

        return attachment.mimeType.startsWith("image/") ? (
          <div key={attachment.id} className="relative">
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={fromSupport ? `${attachment.fileName} — ${trace}` : attachment.fileName}
              className={`block ${tileSize} rounded overflow-hidden border border-gray-200 hover:opacity-80 transition`}
            >
              <Image
                src={getThumbnailUrl(attachment)}
                alt={attachment.fileName}
                fill
                sizes={size === "sm" ? "64px" : "96px"}
                className="object-cover"
              />
            </a>
            {badge && <span className="absolute bottom-0 left-0">{badge}</span>}
            {deleteControl}
          </div>
        ) : (
          <div
            key={attachment.id}
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded text-sm"
          >
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={fromSupport ? trace : attachment.fileName}
              className="flex items-center gap-2 text-blue-600 hover:underline"
            >
              <FaFilePdf className="text-red-500 shrink-0" />
              <span className="max-w-[10rem] truncate">{attachment.fileName}</span>
              <span className="text-gray-400 text-xs whitespace-nowrap">
                ({Math.max(1, Math.round(attachment.size / 1024))} KB)
              </span>
            </a>
            {badge}
            {canDelete && (
              <DeleteButton
                action={deleteAction}
                payload={{ [idField]: attachment.id }}
                itemLabel="attachment"
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AttachmentGrid;