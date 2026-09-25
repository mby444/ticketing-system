import { getTicketById } from "@/actions/ticket.actions";
import { logEvent } from "@/utils/sentry";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getPriorityClass, getStatusClass } from "@/utils/ui";
import CloseTicketButton from "@/components/CloseTicketButton";
import { requireUser } from "@/lib/authorization";
import { formatStatus } from "@/utils/string-format";
import { getThumbnailUrl } from "@/lib/cloudinary";
import { FaFilePdf } from "react-icons/fa";
import AttachForm from "./attach-form";

const TicketDetailsPage = async (props: {
  params: Promise<{ id: string }>;
}) => {
  await requireUser();

  const { id } = await props.params;
  const ticket = await getTicketById(Number(id));

  if (!ticket) {
    notFound();
  }

  logEvent("Viewing ticket details", "ticket", { ticketId: ticket.id }, "info");

  const isClosed = ticket.status === "Closed";

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

        {ticket.attachments.length > 0 && (
          <div className="text-gray-700">
            <h2 className="text-lg font-semibold mb-2">Attachments</h2>
            <div className="flex flex-wrap gap-3">
              {ticket.attachments.map((attachment) =>
                attachment.mimeType.startsWith("image/") ? (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={attachment.fileName}
                    className="relative block w-24 h-24 rounded overflow-hidden border border-gray-200 hover:opacity-80 transition"
                  >
                    <Image
                      src={getThumbnailUrl(attachment)}
                      alt={attachment.fileName}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  </a>
                ) : (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded text-sm text-blue-600 hover:bg-blue-50 transition"
                  >
                    <FaFilePdf className="text-red-500 shrink-0" />
                    <span className="max-w-[10rem] truncate">
                      {attachment.fileName}
                    </span>
                    <span className="text-gray-400 text-xs whitespace-nowrap">
                      ({Math.max(1, Math.round(attachment.size / 1024))} KB)
                    </span>
                  </a>
                ),
              )}
            </div>
          </div>
        )}

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
