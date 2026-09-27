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
 * Sent to the ticket owner when a new reply is posted.
 *
 * NOTE: the comment/reply feature is not built yet (see AGENTS.md backlog) —
 * this template and the worker's NEW_COMMENT branch are wired up first so the
 * producer only has to publish the job when the feature lands.
 */
export function NewCommentEmail({
  ticketId,
  subject,
  ticketUrl,
}: {
  ticketId: number;
  subject: string;
  ticketUrl: string;
}) {
  return (
    <EmailLayout heading="New reply on your ticket">
      <Text style={{ margin: "0 0 12px" }}>
        A new reply has been posted on your ticket — check it out below.
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
