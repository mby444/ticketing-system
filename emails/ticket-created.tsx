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

/** Confirmation sent to the client right after their ticket is created. */
export function TicketCreatedEmail({
  ticketId,
  subject,
  priority,
  ticketUrl,
}: {
  ticketId: number;
  subject: string;
  priority: string;
  ticketUrl: string;
}) {
  return (
    <EmailLayout heading={`Ticket #${ticketId} received`}>
      <Text style={{ margin: "0 0 12px" }}>
        Hi, we&rsquo;ve received your ticket and our team will get back to you
        shortly.
      </Text>
      <Text style={{ margin: "0 0 4px" }}>
        <strong>Subject:</strong> {subject}
      </Text>
      <Text style={{ margin: "0 0 16px" }}>
        <strong>Priority:</strong> {priority}
      </Text>
      <Button href={ticketUrl} style={buttonStyle}>
        View ticket #{ticketId}
      </Button>
    </EmailLayout>
  );
}
