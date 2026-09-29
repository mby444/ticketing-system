-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('Low', 'Medium', 'High', 'Critical');

-- AlterTable: in-place type change. Hand-written on purpose — Prisma's own diff
-- for a column type change tends to drop and re-add the column, which would
-- have destroyed every existing ticket. Postgres requires USING to convert
-- text -> enum, and it is safe here because a pre-flight check confirmed the
-- column only ever holds these four values (9 Critical / 13 High / 12 Medium /
-- 16 Low).
ALTER TABLE "Ticket"
  ALTER COLUMN "priority" TYPE "TicketPriority" USING "priority"::"TicketPriority";
