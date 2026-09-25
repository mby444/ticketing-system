-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'ADMIN', 'SUPPORT_AGENT');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('Open', 'In_Progress', 'Resolved', 'Closed');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'CLIENT';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "assigneeId" TEXT;

-- AlterTable
-- Convert status from text to TicketStatus, mapping the legacy value
-- 'In Progress' (with a space) to the enum member 'In_Progress' so the
-- existing rows are preserved instead of being reset to the default.
ALTER TABLE "Ticket" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Ticket"
  ALTER COLUMN "status" TYPE "TicketStatus"
  USING (
    CASE "status"
      WHEN 'In Progress' THEN 'In_Progress'
      ELSE "status"
    END
  )::"TicketStatus";
ALTER TABLE "Ticket" ALTER COLUMN "status" SET DEFAULT 'Open';

-- Data backfill: promote existing seeded users so the app has staff accounts
UPDATE "User" SET "role" = 'ADMIN' WHERE "email" = 'user1@example.com';
UPDATE "User" SET "role" = 'SUPPORT_AGENT' WHERE "email" IN ('user2@example.com', 'user3@example.com');

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
