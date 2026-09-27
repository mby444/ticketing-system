import type { ReactNode } from "react";
import { Body, Container, Heading, Hr, Html, Section, Text } from "@react-email/components";

const bodyStyle = {
  backgroundColor: "#f4f4f5",
  fontFamily: "Arial, Helvetica, sans-serif",
  padding: "24px 0",
};

const containerStyle = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  padding: "24px",
  maxWidth: "480px",
} as const;

const footerStyle = {
  color: "#9ca3af",
  fontSize: "12px",
  margin: "0",
};

/**
 * Shared shell for every QuickTicket notification email.
 * Kept intentionally plain: solid colors + inline styles render reliably
 * across email clients (no external CSS).
 */
export function EmailLayout({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <Html>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section>
            <Heading style={{ fontSize: "20px", margin: "0 0 16px" }}>
              {heading}
            </Heading>
            {children}
            <Hr style={{ borderColor: "#e5e7eb" }} />
            <Text style={footerStyle}>
              QuickTicket support system — this is an automated message, please
              do not reply to this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
