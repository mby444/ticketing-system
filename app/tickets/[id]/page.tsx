import { getTicketById, listAgents } from "@/actions/ticket.actions";
import { logEvent } from "@/utils/sentry";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPriorityClass, getStatusClass } from "@/utils/ui";
import CloseTicketButton from "@/components/CloseTicketButton";
import AttachmentList from "@/components/AttachmentList";
import AssignSelect from "@/components/AssignSelect";
import { requireUser } from "@/lib/authorization";
import { isStaff } from "@/lib/roles";
import { formatStatus } from "@/utils/string-format";
import AttachForm from "./attach-form";
import CommentThread from "./comment-thread";
import CommentForm from "./comment-form";

const TicketDetailsPage = async (props: {
  params: Promise<{ id: string }>;
}) => {
  const viewer = await requireUser();

  const { id } = await props.params;
  const ticket = await getTicketById(Number(id));

  if (!ticket) {
    notFound();
  }

  logEvent("Viewing ticket details", "ticket", { ticketId: ticket.id }, "info");

  const isClosed = ticket.status === "Closed";

  // Staff get an editable assignee plus the requester's identity; a CLIENT can
  // only ever open their own ticket (canAccessTicket), so the requester field
  // would be redundant for them. listAgents is staff-gated server-side too —
  // we just avoid paying for the call when it cannot succeed.
  const staffView = isStaff(viewer);
  const agents = staffView ? await listAgents() : [];

  return (
    <div className="min-h-screen bg-blue-50 p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow border border-gray-200 p-8 space-y-6">
        <h1 className="text-3xl font-bold text-blue-600">{ticket.subject}</h1>

        <div className="text-gray-700">
          <h2 className="text-lg font-semibold mb-2">Description</h2>
          <p>{ticket.description}</p>
        </div>

        <div className="text-gray-700">
          <h2 className="text-lg font-semibold mb-2">Priority</h2>
          <p className={getPriorityClass(ticket.priority)}>{ticket.priority}</p>
        </div>

        <div className="text-gray-700">
          <h2 className="text-lg font-semibold mb-2">Status</h2>
          <p className={getStatusClass(ticket.status)}>
            {formatStatus(ticket.status)}
          </p>
        </div>

        {staffView && (
          <div className="text-gray-700">
            <h2 className="text-lg font-semibold mb-2">Requester</h2>
            <p>{ticket.user.name ?? ticket.user.email}</p>
            <p className="text-xs text-gray-500">{ticket.user.email}</p>
          </div>
        )}

        <div className="text-gray-700">
          <h2 className="text-lg font-semibold mb-2">Assignee</h2>
          {staffView ? (
            <AssignSelect
              ticketId={ticket.id}
              assigneeId={ticket.assigneeId}
              agents={agents}
            />
          ) : ticket.assignedTo ? (
            <>
              <p>{ticket.assignedTo.name ?? ticket.assignedTo.email}</p>
              <p className="text-xs text-gray-500">
                {ticket.assignedTo.email}
              </p>
            </>
          ) : (
            <p className="text-gray-500">Not assigned</p>
          )}
        </div>

        <AttachmentList
          attachments={ticket.attachments}
          ticketOwnerId={ticket.userId}
        />

        <div className="text-gray-700">
          <h2 className="text-lg font-semibold mb-2">
            Conversation
            {ticket.comments.length > 0 ? ` (${ticket.comments.length})` : ""}
          </h2>
          <div className="space-y-4">
            <CommentThread
              comments={ticket.comments}
              viewerId={viewer.id}
              ticketOwnerId={ticket.userId}
              isClosed={isClosed}
            />
            <CommentForm ticketId={ticket.id} isClosed={isClosed} />
          </div>
        </div>

        <div className="text-gray-700">
          <h2 className="text-lg font-semibold mb-2">Created At</h2>
          <p>{new Date(ticket.createdAt).toLocaleString()}</p>
        </div>

        <Link
          href="/tickets"
          className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
        >
          ← Back to Tickets
        </Link>

        {!isClosed && (
          <CloseTicketButton ticketId={ticket.id} isClosed={isClosed} />
        )}

        <AttachForm ticketId={ticket.id} />
      </div>
    </div>
  );
};

export default TicketDetailsPage;
