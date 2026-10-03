import Image from "next/image";
import { FaFilePdf } from "react-icons/fa";
import { getThumbnailUrl } from "@/lib/cloudinary";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import { deleteAttachment } from "@/actions/ticket.actions";
import DeleteButton from "@/components/DeleteButton";
import type { Role } from "@/generated/prisma/client";

/** Mirrors the `attachments` include in getTicketById. */
export type TicketAttachmentView = {
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

/**
 * Attachment list for the ticket detail page. Server component.
 *
 * Staff are allowed to upload onto a ticket they do not own (canAccessTicket),
 * so anything not uploaded by the ticket owner is badged as coming from
 * support. The check is `uploader !== owner` rather than `isStaff(uploader)`
 * because a staff member uploading onto their *own* ticket is not something the
 * customer needs to be told about.
 *
 * Note the image tile is a wrapper div, not the <a> itself: nesting the delete
 * <button> inside a link is invalid interactive content and would also open the
 * file on click. The delete control therefore floats over the tile — trash icon
 * top-right, badge bottom-left — and confirms with an in-card overlay so the row
 * never reflows.
 */
const AttachmentList = ({
  attachments,
  ticketOwnerId,
  viewer,
}: {
  attachments: TicketAttachmentView[];
  ticketOwnerId: string;
  viewer: { id: string; role: Role };
}) => {
  if (attachments.length === 0) return null;

  return (
    <div className="text-gray-700">
      <h2 className="text-lg font-semibold mb-2">Attachments</h2>
      <div className="flex flex-wrap gap-3">
        {attachments.map((attachment) => {
          const fromSupport = attachment.uploadedBy.id !== ticketOwnerId;
          const uploaderName =
            attachment.uploadedBy.name ?? attachment.uploadedBy.email;
          const trace = `Uploaded by ${uploaderName}${
            fromSupport ? " (QuickTicket support)" : ""
          } on ${new Date(attachment.createdAt).toLocaleString()}`;

          const canDelete = canDeleteUserContent(
            viewer,
            attachment.uploadedBy.id,
          );

          const badge = fromSupport && (
            <span className="text-[10px] uppercase tracking-wide bg-blue-600 text-white rounded px-1 py-0.5 shrink-0 pointer-events-none">
              Support Staff
            </span>
          );

          const deleteControl = canDelete && (
            <DeleteButton
              action={deleteAttachment}
              payload={{ attachmentId: attachment.id }}
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
                title={
                  fromSupport
                    ? `${attachment.fileName} — ${trace}`
                    : attachment.fileName
                }
                className="block w-24 h-24 rounded overflow-hidden border border-gray-200 hover:opacity-80 transition"
              >
                <Image
                  src={getThumbnailUrl(attachment)}
                  alt={attachment.fileName}
                  fill
                  sizes="96px"
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
                <span className="max-w-[10rem] truncate">
                  {attachment.fileName}
                </span>
                <span className="text-gray-400 text-xs whitespace-nowrap">
                  ({Math.max(1, Math.round(attachment.size / 1024))} KB)
                </span>
              </a>
              {badge}
              {canDelete && (
                <DeleteButton
                  action={deleteAttachment}
                  payload={{ attachmentId: attachment.id }}
                  itemLabel="attachment"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AttachmentList;
