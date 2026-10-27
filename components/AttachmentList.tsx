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
    <section className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-6">
      <h2 className="text-title-md text-slate-900 mb-3">Attachments</h2>
      <AttachmentGrid
        attachments={attachments}
        viewer={viewer}
        ticketOwnerId={ticketOwnerId}
        deleteAction={deleteAttachment}
      />
    </section>
  );
};

export default AttachmentList;