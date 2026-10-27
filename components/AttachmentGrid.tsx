import Image from "next/image";
import { FaFilePdf } from "react-icons/fa";
import { getThumbnailUrl } from "@/lib/cloudinary";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import DeleteButton from "@/components/DeleteButton";
import type { Role } from "@/generated/prisma/client";

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

type DeleteAction = (
  prev: { success: boolean; message: string },
  data: FormData,
) => Promise<{ success: boolean; message: string }>;

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
  idField?: string;
  size?: "sm" | "lg";
  showBadge?: boolean;
}) => {
  if (attachments.length === 0) return null;

  const tileSize = size === "sm" ? "w-16 h-16" : "w-24 h-24";

  return (
    <div className="flex flex-wrap gap-3">
      {attachments.map((attachment) => {
        const fromSupport = showBadge && attachment.uploadedBy.id !== ticketOwnerId;
        const uploaderName =
          attachment.uploadedBy.name ?? attachment.uploadedBy.email;
        const trace = `Uploaded by ${uploaderName}${
          fromSupport ? " (QuickTicket support)" : ""
        } on ${new Date(attachment.createdAt).toLocaleString()}`;

        const canDelete = canDeleteUserContent(viewer, attachment.uploadedBy.id);

        const badge = fromSupport && (
          <span className="absolute bottom-1 left-1 text-[10px] uppercase tracking-wide bg-indigo-600 text-white rounded-full px-1.5 py-0.5 shadow-sm pointer-events-none">
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
          <div key={attachment.id} className="relative group">
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={fromSupport ? `${attachment.fileName} — ${trace}` : attachment.fileName}
              className={`block ${tileSize} rounded-xl overflow-hidden border border-slate-200 shadow-sm hover:opacity-90 hover:shadow-elevated transition`}
            >
              <Image
                src={getThumbnailUrl(attachment)}
                alt={attachment.fileName}
                fill
                sizes={size === "sm" ? "64px" : "96px"}
                className="object-cover"
              />
            </a>
            {badge}
            {deleteControl}
          </div>
        ) : (
          <div
            key={attachment.id}
            className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-xl bg-white shadow-sm text-sm"
          >
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={fromSupport ? trace : attachment.fileName}
              className="flex items-center gap-2 text-indigo-600 hover:underline"
            >
              <FaFilePdf className="text-rose-500 shrink-0" />
              <span className="max-w-[10rem] truncate">{attachment.fileName}</span>
              <span className="text-slate-400 text-xs whitespace-nowrap">
                ({Math.max(1, Math.round(attachment.size / 1024))} KB)
              </span>
            </a>
            {fromSupport && (
              <span className="text-[10px] uppercase tracking-wide bg-indigo-600 text-white rounded-full px-1.5 py-0.5">
                Support Staff
              </span>
            )}
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