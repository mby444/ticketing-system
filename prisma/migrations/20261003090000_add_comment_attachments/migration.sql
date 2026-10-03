-- CreateTable
-- A separate model rather than a nullable commentId on TicketAttachment: the
-- two have independent budgets (MAX_FILES per ticket, MAX_COMMENT_FILES per
-- comment), and a comment can be soft-deleted while its ticket lives on.
CREATE TABLE "CommentAttachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentId" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,

    CONSTRAINT "CommentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommentAttachment_commentId_idx" ON "CommentAttachment"("commentId");

-- AddForeignKey
-- CASCADE, matching TicketComment.ticketId: the comment is deleted with its
-- ticket, and its files have no meaning without it.
ALTER TABLE "CommentAttachment" ADD CONSTRAINT "CommentAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- ON DELETE RESTRICT (Prisma's default for a required relation) is deliberate,
-- for the same reason as TicketAttachment.uploadedById: the uploader is audit
-- data, so deleting a user who uploaded a file is blocked instead of silently
-- removing files from a thread they do not own.
ALTER TABLE "CommentAttachment" ADD CONSTRAINT "CommentAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;