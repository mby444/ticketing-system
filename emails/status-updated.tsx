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

/** Sent to the ticket owner when staff changes the ticket status. */
export function StatusUpdatedEmail({
  ticketId,
  subject,
  status,
  ticketUrl,
}: {
  ticketId: number;
  subject: string;
  status: string;
  ticketUrl: string;
}) {
  return (
    <EmailLayout heading={`Status updated: ${status}`}>
      <Text style={{ margin: "0 0 12px" }}>
        The status of your ticket has been changed by our support team.
      </Text>
      <Text style={{ margin: "0 0 4px" }}>
        <strong>Ticket:</strong> #{ticketId} — {subject}
      </Text>
      <Text style={{ margin: "0 0 16px" }}>
        <strong>New status:</strong> {status}
      </Text>
      <Button href={ticketUrl} style={buttonStyle}>
        View ticket #{ticketId}
      </Button>
    </EmailLayout>
  );
}
