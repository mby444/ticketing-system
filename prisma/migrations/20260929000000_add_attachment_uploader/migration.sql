-- AddTableColumn
ALTER TABLE "TicketAttachment" ADD COLUMN "uploadedById" TEXT;

-- Data backfill: the only defensible assumption for historical rows is that
-- they were uploaded by the ticket owner through the customer's own form
-- (staff uploading onto a client ticket is rare and was untracked). Rows
-- created after this migration record the real uploader.
UPDATE "TicketAttachment" a
SET "uploadedById" = t."userId"
FROM "Ticket" t
WHERE t."id" = a."ticketId";

-- AlterTable
ALTER TABLE "TicketAttachment" ALTER COLUMN "uploadedById" SET NOT NULL;

-- AddForeignKey
-- ON DELETE RESTRICT (Prisma's default for a required relation) is deliberate:
-- the uploader is audit data, so deleting a user who uploaded something is
-- blocked instead of silently removing the files from tickets they do not own.
ALTER TABLE "TicketAttachment" ADD CONSTRAINT "TicketAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
