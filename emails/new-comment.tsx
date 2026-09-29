import { Button, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

const buttonStyle = {
  backgroundColor: "#2563eb",
  color: "#ffffff",
  display: "inline-block",
  padding: "10px 16px",
  borderRadius: "6px",
  textDecoration: "none",
} as const;

const bodyStyle = {
  margin: "0 0 16px",
  padding: "12px",
  backgroundColor: "#f9fafb",
  borderLeft: "3px solid #2563eb",
  fontSize: "14px",
} as const;

/** Long comments are trimmed: the full text lives behind the CTA. */
const PREVIEW_LENGTH = 400;

/**
 * Sent whenever a new reply is posted on a ticket. Two-way: a staff reply goes
 * to the ticket owner, a customer reply goes to the assignee. The recipient is
 * resolved by the worker, never by this template.
 */
export function NewCommentEmail({
  ticketId,
  subject,
  authorName,
  isStaffAuthor,
  body,
  ticketUrl,
}: {
  ticketId: number;
  subject: string;
  authorName: string;
  isStaffAuthor: boolean;
  body: string;
  ticketUrl: string;
}) {
  return (
    <EmailLayout
      heading={isStaffAuthor ? "New reply on your ticket" : "New customer reply"}
    >
      <Text style={{ margin: "0 0 12px" }}>
        <strong>{authorName}</strong>
        {isStaffAuthor
          ? " from QuickTicket support replied on your ticket:"
          : " replied on a ticket you are assigned to:"}
      </Text>
      <Text style={bodyStyle}>
        {body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}…` : body}
      </Text>
      <Text style={{ margin: "0 0 16px" }}>
        <strong>Ticket:</strong> #{ticketId} — {subject}
      </Text>
      <Button href={ticketUrl} style={buttonStyle}>
        View reply
      </Button>
    </EmailLayout>
  );
}
