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

/**
 * Sent to a staff member when a ticket is assigned to them, and when a ticket
 * they were working on is reassigned to somebody else. Both directions share
 * this template because the layout is identical — only the copy differs.
 */
export function TicketAssignedEmail({
  variant,
  agentName,
  ticketId,
  subject,
  ticketUrl,
}: {
  variant: "assigned" | "unassigned";
  agentName: string;
  ticketId: number;
  subject: string;
  ticketUrl: string;
}) {
  const assigned = variant === "assigned";

  return (
    <EmailLayout
      heading={
        assigned
          ? "A ticket was assigned to you"
          : "A ticket is no longer assigned to you"
      }
    >
      <Text style={{ margin: "0 0 12px" }}>
        Hi {agentName},{" "}
        {assigned
          ? "you have been assigned a support ticket."
          : "a support ticket has been reassigned to somebody else and is no longer in your queue."}
      </Text>
      <Text style={{ margin: "0 0 4px" }}>
        <strong>Ticket:</strong> #{ticketId} — {subject}
      </Text>
      {!assigned && (
        <Text style={{ margin: "0 0 4px" }}>
          If you have already replied, that reply stays on the ticket — the
          next agent will see the full conversation.
        </Text>
      )}
      <Text style={{ margin: "0 0 16px" }}>
        <Button href={ticketUrl} style={buttonStyle}>
          {assigned ? "View ticket" : "View reassigned ticket"}
        </Button>
      </Text>
    </EmailLayout>
  );
}
