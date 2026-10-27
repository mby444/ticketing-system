import { getTicketById, listAgents } from "@/actions/ticket.actions";
import { logEvent } from "@/utils/sentry";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPriorityClass, getStatusClass } from "@/utils/ui";
import CloseTicketButton from "@/components/CloseTicketButton";
import AttachmentList from "@/components/AttachmentList";
import AssignSelect from "@/components/AssignSelect";
import StatusSelect from "@/components/dashboard/StatusSelect";
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
    <div className="min-h-screen bg-surface p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/tickets"
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-indigo-600"
          >
            <span aria-hidden="true">←</span> Back to Tickets
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <main className="lg:col-span-2 space-y-6">
            <header className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-6">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-label-sm text-slate-500">#{ticket.id}</span>
                <span className={getPriorityClass(ticket.priority)}>
                  {ticket.priority}
                </span>
                <span className={getStatusClass(ticket.status)}>
                  {formatStatus(ticket.status)}
                </span>
              </div>
              <h1 className="text-headline-md text-slate-900 tracking-tight">
                {ticket.subject}
              </h1>
              {staffView && (
                <p className="mt-2 text-body-sm text-slate-500">
                  Requested by{" "}
                  <span className="font-medium text-slate-700">
                    {ticket.user.name ?? ticket.user.email}
                  </span>{" "}
                  · {ticket.user.email}
                </p>
              )}
            </header>

            <section className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-6">
              <h2 className="text-title-md text-slate-900 mb-3">Description</h2>
              <p className="text-body-md text-slate-700 whitespace-pre-wrap break-words">
                {ticket.description}
              </p>
            </section>

            <AttachmentList
              attachments={ticket.attachments}
              ticketOwnerId={ticket.userId}
              viewer={viewer}
            />

            <AttachForm ticketId={ticket.id} />

            <section className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-title-md text-slate-900">
                  Conversation
                  {ticket.comments.length > 0
                    ? ` (${ticket.comments.length})`
                    : ""}
                </h2>
              </div>
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
            </section>
          </main>

          <aside className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              <div className="bg-surface-container-lowest rounded-2xl border border-slate-200 shadow-card p-6 space-y-5">
                <div>
                  <h3 className="text-label-sm text-slate-500 mb-2">Status</h3>
                  {staffView ? (
                    <StatusSelect ticketId={ticket.id} status={ticket.status} />
                  ) : (
                    <span className={getStatusClass(ticket.status)}>
                      {formatStatus(ticket.status)}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-label-sm text-slate-500 mb-2">Priority</h3>
                  <span className={getPriorityClass(ticket.priority)}>
                    {ticket.priority}
                  </span>
                </div>

                <div>
                  <h3 className="text-label-sm text-slate-500 mb-2">Assignee</h3>
                  {staffView ? (
                    <AssignSelect
                      ticketId={ticket.id}
                      assigneeId={ticket.assigneeId}
                      agents={agents}
                    />
                  ) : ticket.assignedTo ? (
                    <div>
                      <p className="text-body-sm font-medium text-slate-900">
                        {ticket.assignedTo.name ?? ticket.assignedTo.email}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ticket.assignedTo.email}
                      </p>
                    </div>
                  ) : (
                    <p className="text-body-sm text-slate-500">Not assigned</p>
                  )}
                </div>

                {staffView && (
                  <div>
                    <h3 className="text-label-sm text-slate-500 mb-2">
                      Requester
                    </h3>
                    <p className="text-body-sm font-medium text-slate-900">
                      {ticket.user.name ?? ticket.user.email}
                    </p>
                    <p className="text-xs text-slate-500">{ticket.user.email}</p>
                  </div>
                )}

                <div>
                  <h3 className="text-label-sm text-slate-500 mb-2">
                    Created At
                  </h3>
                  <p className="text-body-sm text-slate-700">
                    {new Date(ticket.createdAt).toLocaleString()}
                  </p>
                </div>

                <div>
                  <h3 className="text-label-sm text-slate-500 mb-2">
                    Ticket ID
                  </h3>
                  <p className="text-body-sm text-slate-700">#{ticket.id}</p>
                </div>

                <div>
                  <h3 className="text-label-sm text-slate-500 mb-2">SLA</h3>
                  <p className="text-body-sm text-slate-700">
                    Response within 24 hours
                  </p>
                </div>

                {!isClosed && (
                  <CloseTicketButton ticketId={ticket.id} isClosed={isClosed} />
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default TicketDetailsPage;