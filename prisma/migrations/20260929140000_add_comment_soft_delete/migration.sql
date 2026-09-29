-- AddTableColumn
ALTER TABLE "TicketComment" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "TicketComment" ADD COLUMN "deletedById" TEXT;

-- AddForeignKey
-- ON DELETE SET NULL, not CASCADE: the audit of a removal must survive the
-- removal of the moderator. With CASCADE, deleting that user would silently
-- erase the evidence the soft delete exists to preserve.
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
