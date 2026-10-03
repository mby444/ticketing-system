import { deleteAttachment } from "@/actions/ticket.actions";
import AttachmentGrid, {
  type AttachmentView,
} from "@/components/AttachmentGrid";
import type { Role } from "@/generated/prisma/client";

/** Mirrors the `attachments` include in getTicketById. */
export type TicketAttachmentView = AttachmentView;

/**
 * Attachment list for the ticket detail page: the heading plus the shared grid.
 * Server component.
 *
 * The tiles themselves live in `components/AttachmentGrid.tsx`, which the
 * comment thread reuses for files attached to a comment.
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
      <AttachmentGrid
        attachments={attachments}
        viewer={viewer}
        ticketOwnerId={ticketOwnerId}
        deleteAction={deleteAttachment}
      />
    </div>
  );
};

export default AttachmentList;