-- CreateEnum
-- In-app notification types. Mirrors EmailJob but with independent recipient rules:
-- a customer reply on an unassigned ticket emails nobody (no assignee) but notifies
-- all staff, closing the "nobody is told" gap from the email pipeline.
CREATE TYPE "NotificationType" AS ENUM ('TICKET_CREATED', 'STATUS_UPDATED', 'NEW_COMMENT', 'TICKET_ASSIGNED', 'TICKET_UNASSIGNED');

-- CreateTable
-- Notifications are per-user rows. userId is CASCADE (unlike attachment uploader
-- RESTRICT) because a notification is *for* a person, not audit data. Deleting
-- a user takes their inbox with it. ticketId is CASCADE because a ticket delete
-- renders its notifications meaningless.
-- dedupeKey disambiguates occurrences of the same event on the same ticket:
-- commentId for NEW_COMMENT, newStatus for STATUS_UPDATED, "-" otherwise.
-- The unique index with skipDuplicates makes QStash retries a silent no-op.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
-- QStash retries on 500; without this unique key a flaky insert shows the user
-- two identical rows. skipDuplicates in the worker collapses retries.
CREATE UNIQUE INDEX "Notification_userId_type_ticketId_dedupeKey_key" ON "Notification"("userId", "type", "ticketId", "dedupeKey");

-- AddForeignKey
-- CASCADE: a notification is for a person, not audit data. Deleting a user
-- takes their inbox with it.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: a ticket delete renders its notifications meaningless.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;