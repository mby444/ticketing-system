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

  const staffView = isStaff(viewer);
  const agents = staffView ? await listAgents() : [];

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <main className="lg:col-span-7 space-y-6">
            <h1 className="text-3xl font-bold text-indigo-600">
              {ticket.subject}
            </h1>

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Description
              </h2>
              <p className="text-slate-700">{ticket.description}</p>
            </div>

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Priority
              </h2>
              <p className={getPriorityClass(ticket.priority)}>
                {ticket.priority}
              </p>
            </div>

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Status
              </h2>
              <p className={getStatusClass(ticket.status)}>
                {formatStatus(ticket.status)}
              </p>
            </div>

            <AttachmentList
              attachments={ticket.attachments}
              ticketOwnerId={ticket.userId}
              viewer={viewer}
            />

            <AttachForm ticketId={ticket.id} />

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Conversation
                {ticket.comments.length > 0 ? ` (${ticket.comments.length})` : ""}
              </h2>
              <div className="space-y-4">
                <CommentThread
                  comments={ticket.comments}
                  viewerId={viewer.id}
                  ticketOwnerId={ticket.userId}
                  isClosed={isClosed}
                  viewer={viewer}
                />
                <CommentForm ticketId={ticket.id} isClosed={isClosed} />
              </div>
            </div>
          </main>

          <aside className="lg:col-span-5 space-y-6">
            {staffView && (
              <div className="text-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 mb-2">
                  Requester
                </h2>
                <p className="text-slate-900">
                  {ticket.user.name ?? ticket.user.email}
                </p>
                <p className="text-xs text-slate-500">{ticket.user.email}</p>
              </div>
            )}

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Assignee
              </h2>
              {staffView ? (
                <AssignSelect
                  ticketId={ticket.id}
                  assigneeId={ticket.assigneeId}
                  agents={agents}
                />
              ) : ticket.assignedTo ? (
                <>
                  <p className="text-slate-900">
                    {ticket.assignedTo.name ?? ticket.assignedTo.email}
                  </p>
                  <p className="text-xs text-slate-500">
                    {ticket.assignedTo.email}
                  </p>
                </>
              ) : (
                <p className="text-slate-500">Not assigned</p>
              )}
            </div>

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                Created At
              </h2>
              <p className="text-slate-700">
                {new Date(ticket.createdAt).toLocaleString()}
              </p>
            </div>

            <div className="text-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">
                SLA
              </h2>
              <p className="text-slate-700">Response within 24 hours</p>
            </div>

            {!isClosed && (
              <CloseTicketButton ticketId={ticket.id} isClosed={isClosed} />
            )}

            <Link
              href="/tickets"
              className="inline-block rounded bg-indigo-600 text-white px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-indigo-700"
            >
              ← Back to Tickets
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default TicketDetailsPage;
