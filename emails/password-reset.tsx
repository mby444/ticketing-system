import { Button, Text } from "@react-email/components";
import { EmailLayout } from "./email-layout";

const codeStyle = {
  backgroundColor: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: "6px",
  color: "#1d4ed8",
  fontFamily: "Courier New, monospace",
  fontSize: "32px",
  fontWeight: "bold",
  letterSpacing: "8px",
  margin: "16px 0",
  padding: "16px",
  textAlign: "center",
} as const;

const mutedStyle = {
  color: "#6b7280",
  fontSize: "12px",
  margin: "0",
} as const;

/**
 * The password-reset code.
 *
 * The code is rendered from a server-side decrypt of the stored ciphertext; it
 * never travels through the queue payload. That is the whole reason
 * `PasswordResetOtp.codeEncrypted` is encrypted rather than hashed — see
 * `lib/otp.ts`.
 */
export function PasswordResetOtpEmail({
  code,
  expiresInMinutes,
  resetUrl,
}: {
  code: string;
  expiresInMinutes: number;
  resetUrl: string;
}) {
  return (
    <EmailLayout heading="Reset your QuickTicket password">
      <Text style={{ margin: "0 0 8px" }}>
        Use this one-time code to choose a new password:
      </Text>
      <Text style={codeStyle}>{code}</Text>
      <Text style={mutedStyle}>
        It expires in {expiresInMinutes} minutes and can only be used once. If
        you did not ask to reset your password, you can ignore this email — your
        password will not change.
      </Text>
      <Button
        href={resetUrl}
        style={{
          backgroundColor: "#2563eb",
          borderRadius: "6px",
          color: "#ffffff",
          display: "inline-block",
          margin: "16px 0",
          padding: "10px 16px",
          textDecoration: "none",
        }}
      >
        Choose a new password
      </Button>
    </EmailLayout>
  );
}