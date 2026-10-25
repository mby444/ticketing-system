-- CreateTable
-- One row per user: the active password-reset code, if any. The UNIQUE on
-- userId is the mechanism, not decoration -- requesting a new code REPLACES the
-- old one, so verification is a single findUnique and a spent code cannot be
-- replayed from an earlier row.
CREATE TABLE "PasswordResetOtp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetOtp_userId_key" ON "PasswordResetOtp"("userId");

-- CreateIndex
-- Lets the expiry sweep be an indexed delete rather than a table scan.
CREATE INDEX "PasswordResetOtp_expiresAt_idx" ON "PasswordResetOtp"("expiresAt");

-- AddForeignKey
-- CASCADE: an OTP is *for* a person and carries no audit value, so deleting the
-- user should take their outstanding codes with it. Contrast
-- TicketAttachment.uploadedById, which is RESTRICT because that one is a trace.
ALTER TABLE "PasswordResetOtp" ADD CONSTRAINT "PasswordResetOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;