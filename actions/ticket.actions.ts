"use server";

import { getCurrentUser } from "@/lib/current-user";
import { canAccessTicket, isStaff, STAFF_ROLES } from "@/lib/authorization";
import { TicketStatus } from "@/generated/prisma/client";
import {
  MAX_COMMENT_FILES,
  MAX_FILES,
  validateAttachmentFile,
  uploadAttachment,
  destroyAsset,
  type AttachmentUpload,
} from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
import { publishJob } from "@/lib/qstash";
import { buildAssignmentNotifications } from "@/lib/assignment-notifications";
import { isTicketPriority } from "@/lib/priority";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import { logEvent } from "@/utils/sentry";
import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";

interface ActionState {
  success: boolean;
  message: string;
}

export const createTicket = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent("Unauthorized ticket creation attempt", "ticket", {}, "warning");

      return {
        success: false,
        message: "You must be logged in to create a ticket",
      };
    }

    const subject = formData.get("subject") as string;
    const description = formData.get("description") as string;
    const priority = formData.get("priority");

    if (!subject || !description || !priority) {
      Sentry.captureMessage("Validation Error: Missing ticket fields", {
        level: "warning",
      });
      return { success: false, message: "All fields are required" };
    }

    // Same shape as updateTicketStatus' status check: the form posts a raw
    // string, so it has to be whitelisted before it reaches the database.
    if (!isTicketPriority(priority)) {
      logEvent(
        "Ticket creation rejected: invalid priority",
        "ticket",
        { priority: String(priority) },
        "warning",
      );
      return { success: false, message: "Invalid priority value" };
    }

    // Collect attachment files (optional — zero files is fine).
    const files = formData
      .getAll("attachments")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length > MAX_FILES) {
      logEvent(
        "Ticket creation rejected: too many attachments",
        "ticket",
        { count: files.length, max: MAX_FILES },
        "warning",
      );
      return {
        success: false,
        message: `Maximum ${MAX_FILES} attachments per ticket`,
      };
    }

    for (const file of files) {
      const validationError = validateAttachmentFile(file);
      if (validationError) {
        logEvent(
          "Ticket creation rejected: invalid attachment",
          "ticket",
          { fileName: file.name, mimeType: file.type, size: file.size },
          "warning",
        );
        return { success: false, message: validationError };
      }
    }

    // All-or-nothing: upload everything BEFORE writing to the database, so a
    // failed upload never leaves a ticket behind without (some of) its files.
    const uploaded: AttachmentUpload[] = [];
    for (const file of files) {
      try {
        uploaded.push(await uploadAttachment(file));
      } catch (error) {
        logEvent(
          "Cloudinary upload failed during ticket creation",
          "ticket",
          { fileName: file.name, size: file.size },
          "error",
          error,
        );
        await Promise.all(
          uploaded.map((asset) => destroyAsset(asset.publicId, asset.resourceType)),
        );
        return {
          success: false,
          message: `Failed to upload "${file.name}" — the ticket was not created`,
        };
      }
    }

    let ticket;
    try {
      ticket = await prisma.$transaction(async (tx) => {
        const created = await tx.ticket.create({
          data: { subject, description, priority, userId: user.id },
        });
        if (uploaded.length > 0) {
          await tx.ticketAttachment.createMany({
            data: uploaded.map((asset) => ({
              ...asset,
              ticketId: created.id,
              // The creator is the ticket owner, so this is the same person.
              uploadedById: user.id,
            })),
          });
        }
        return created;
      });
    } catch (error) {
      logEvent(
        "Failed to persist ticket with attachments",
        "ticket",
        { subject, attachments: uploaded.length },
        "error",
        error,
      );
      await Promise.all(
        uploaded.map((asset) => destroyAsset(asset.publicId, asset.resourceType)),
      );
      return { success: false, message: "Failed to create ticket" };
    }

    logEvent(
      `Ticket ${ticket.id} created successfully`,
      "ticket",
      {
        ticketId: ticket.id,
        attachments: uploaded.length,
        totalBytes: uploaded.reduce((sum, asset) => sum + asset.size, 0),
      },
      "info",
    );

    revalidatePath("/tickets");

    // Best-effort: enqueue only — the email itself is sent asynchronously by
    // /api/jobs/send-email (never blocks or fails this action).
    await publishJob({ type: "TICKET_CREATED", ticketId: ticket.id });

    return {
      success: true,
      message:
        uploaded.length > 0
          ? `Ticket created successfully with ${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"}`
          : "Ticket created successfully",
    };
  } catch (error) {
    logEvent(
      "Failed to create ticket",
      "ticket",
      {
        subject: formData.get("subject"),
        attachmentCount: formData.getAll("attachments").length,
      },
      "error",
      error,
    );
    return { success: false, message: "Failed to create ticket" };
  }
};

export const getTickets = async () => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      logEvent("Unauthorized ticket fetch attempt", "ticket", {}, "warning");

      return [];
    }

    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    logEvent(
      "Tickets fetched successfully",
      "ticket",
      { count: tickets.length },
      "info",
    );
    return tickets;
  } catch (error) {
    logEvent("Failed to get tickets", "ticket", {}, "error", error);
    return [];
  }
};

export const getTicketById = async (id: number) => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      logEvent(
        "Unauthorized ticket fetch attempt",
        "ticket",
        { ticketId: id },
        "warning",
      );
      return null;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        // Requester (ticket owner) and assignee. `assignedTo` is null until
        // somebody claims the ticket — the detail page renders that state
        // explicitly, and it is currently the common case.
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
        assignedTo: {
          select: { id: true, name: true, email: true, role: true },
        },
        attachments: {
          orderBy: { createdAt: "asc" },
          include: {
            uploadedBy: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
        // `id` breaks ties so two comments written in the same millisecond
        // keep a stable order across re-renders.
        comments: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
            // Soft-deleted comments are returned on purpose — the thread renders
            // them as "[removed]" so a two-way conversation never has a hole.
            deletedBy: {
              select: { id: true, name: true, email: true },
            },
            // Files on the comment, same uploader trace as ticket attachments.
            // Also returned for a removed comment (the rows are kept), but the
            // thread deliberately does not render them — a soft delete freezes
            // the whole message.
            attachments: {
              orderBy: { createdAt: "asc" },
              include: {
                uploadedBy: {
                  select: { id: true, name: true, email: true, role: true },
                },
              },
            },
          },
        },
      },
    });

    if (!ticket) {
      logEvent(`Ticket ${id} not found`, "ticket", { ticketId: id }, "warning");
      return null;
    }

    if (!canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized ticket fetch attempt",
        "ticket",
        { ticketId: id, userId: user.id },
        "warning",
      );
      return null;
    }

    logEvent(
      `Ticket ${ticket?.id} fetched successfully`,
      "ticket",
      { ticketId: ticket?.id },
      "info",
    );

    return ticket;
  } catch (error) {
    logEvent(
      "Failed to get ticket",
      "ticket",
      { ticketId: id },
      "error",
      error,
    );
    return null;
  }
};

export const closeTicket = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      logEvent("Unauthorized close ticket attempt", "ticket", {}, "warning");
      return {
        success: false,
        message: "You must be logged in to close a ticket",
      };
    }

    const ticketId = Number(formData.get("ticketId"));

    if (!ticketId) {
      logEvent("Validation error: Missing ticket ID", "ticket", {}, "warning");
      return { success: false, message: "Ticket ID is required" };
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });

    if (!ticket) {
      logEvent(
        `Ticket ${ticketId} not found`,
        "ticket",
        { ticketId },
        "warning",
      );
      return { success: false, message: "Ticket not found" };
    }

    if (!canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized close ticket attempt",
        "ticket",
        { ticketId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to close this ticket",
      };
    }

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "Closed" },
    });

    logEvent(
      `Ticket ${updated.id} closed successfully`,
      "ticket",
      { ticketId: updated.id },
      "info",
    );

    revalidatePath("/tickets");

    return { success: true, message: "Ticket closed successfully" };
  } catch (error) {
    logEvent(
      "Failed to close ticket",
      "ticket",
      { formData: Object.fromEntries(formData.entries()) },
      "error",
      error,
    );
    return { success: false, message: "Failed to close ticket" };
  }
};

export const getAllTickets = async () => {
  try {
    const user = await getCurrentUser();

    if (!user || !isStaff(user)) {
      logEvent(
        "Unauthorized all-tickets fetch attempt",
        "ticket",
        {},
        "warning",
      );
      return [];
    }

    const tickets = await prisma.ticket.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    logEvent(
      "All tickets fetched successfully",
      "ticket",
      { count: tickets.length },
      "info",
    );
    return tickets;
  } catch (error) {
    logEvent("Failed to get all tickets", "ticket", {}, "error", error);
    return [];
  }
};

export const listAgents = async () => {
  try {
    const user = await getCurrentUser();

    if (!user || !isStaff(user)) {
      logEvent("Unauthorized agent list attempt", "ticket", {}, "warning");
      return [];
    }

    const agents = await prisma.user.findMany({
      where: { role: { in: STAFF_ROLES } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { email: "asc" },
    });

    return agents;
  } catch (error) {
    logEvent("Failed to list agents", "ticket", {}, "error", error);
    return [];
  }
};

export const updateTicketStatus = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();

    if (!user || !isStaff(user)) {
      logEvent("Unauthorized status update attempt", "ticket", {}, "warning");
      return { success: false, message: "Only staff can change ticket status" };
    }

    const ticketId = Number(formData.get("ticketId"));
    const status = formData.get("status") as string;

    if (!ticketId) {
      logEvent("Validation error: Missing ticket ID", "ticket", {}, "warning");
      return { success: false, message: "Ticket ID is required" };
    }

    if (!Object.values(TicketStatus).includes(status as TicketStatus)) {
      Sentry.captureMessage(`Invalid ticket status: ${status}`, {
        level: "warning",
      });
      return { success: false, message: "Invalid status value" };
    }

    const { count } = await prisma.ticket.updateMany({
      where: { id: ticketId },
      data: { status: status as TicketStatus },
    });

    if (!count) {
      logEvent(
        `Ticket ${ticketId} not found`,
        "ticket",
        { ticketId },
        "warning",
      );
      return { success: false, message: "Ticket not found" };
    }

    logEvent(
      `Ticket ${ticketId} status changed to ${status}`,
      "ticket",
      { ticketId, status },
      "info",
    );

    revalidatePath("/dashboard");
    revalidatePath("/tickets");

    // Best-effort: enqueue only — the status email goes out asynchronously.
    await publishJob({ type: "STATUS_UPDATED", ticketId, newStatus: status });

    return { success: true, message: "Ticket status updated" };
  } catch (error) {
    logEvent(
      "Failed to update ticket status",
      "ticket",
      { formData: Object.fromEntries(formData.entries()) },
      "error",
      error,
    );
    return { success: false, message: "Failed to update ticket status" };
  }
};

export const assignTicket = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();

    if (!user || !isStaff(user)) {
      logEvent(
        "Unauthorized ticket assignment attempt",
        "ticket",
        {},
        "warning",
      );
      return { success: false, message: "Only staff can assign tickets" };
    }

    const ticketId = Number(formData.get("ticketId"));
    const assigneeId = String(formData.get("assigneeId") ?? "");

    if (!ticketId) {
      logEvent("Validation error: Missing ticket ID", "ticket", {}, "warning");
      return { success: false, message: "Ticket ID is required" };
    }

    if (assigneeId) {
      const assignee = await prisma.user.findUnique({
        where: { id: assigneeId },
        select: { id: true, role: true },
      });

      if (!assignee || !isStaff(assignee)) {
        logEvent(
          "Invalid ticket assignee",
          "ticket",
          { ticketId, assigneeId },
          "warning",
        );
        return { success: false, message: "Cannot assign to this user" };
      }
    }

    // Read the ticket first: the notification emails need to know the previous
    // assignee, and a no-op reassignment must not produce any email at all.
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, assigneeId: true, userId: true },
    });

    if (!ticket) {
      logEvent(`Ticket ${ticketId} not found`, "ticket", { ticketId }, "warning");
      return { success: false, message: "Ticket not found" };
    }

    const nextAssigneeId = assigneeId || null;
    const unchanged = ticket.assigneeId === nextAssigneeId;

    const { count } = await prisma.ticket.updateMany({
      where: { id: ticketId },
      data: { assigneeId: nextAssigneeId },
    });

    if (!count) {
      logEvent(
        `Ticket ${ticketId} not found`,
        "ticket",
        { ticketId },
        "warning",
      );
      return { success: false, message: "Ticket not found" };
    }

    logEvent(
      unchanged
        ? `Ticket ${ticketId} assignment unchanged (${nextAssigneeId ?? "none"})`
        : assigneeId
          ? `Ticket ${ticketId} assigned to ${assigneeId}`
          : `Ticket ${ticketId} unassigned`,
      "ticket",
      {
        ticketId,
        assigneeId: nextAssigneeId,
        previousAssigneeId: ticket.assigneeId,
        ticketOwnerId: ticket.userId,
        assignedBy: user.id,
        unchanged,
      },
      "info",
    );

    revalidatePath("/dashboard");
    revalidatePath("/tickets");
    // The ticket detail page embeds an AssignSelect, so it has to re-render
    // too — otherwise the save succeeds but the page keeps showing the old
    // assignee until a manual refresh.
    revalidatePath("/tickets/[id]", "page");

    // Best-effort, one job per recipient: the new assignee is told they own the
    // ticket, and whoever lost it is told it moved. A no-op change notifies
    // nobody. Which jobs that is lives in buildAssignmentNotifications so it
    // stays testable in isolation.
    for (const { job, deduplicationId } of buildAssignmentNotifications({
      ticketId,
      previousAssigneeId: ticket.assigneeId,
      nextAssigneeId,
    })) {
      await publishJob(job, { deduplicationId });
    }

    return {
      success: true,
      message: assigneeId ? "Ticket assigned" : "Ticket unassigned",
    };
  } catch (error) {
    logEvent(
      "Failed to assign ticket",
      "ticket",
      { formData: Object.fromEntries(formData.entries()) },
      "error",
      error,
    );
    return { success: false, message: "Failed to assign ticket" };
  }
};

export const addAttachments = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent("Unauthorized attachment attempt", "ticket", {}, "warning");
      return {
        success: false,
        message: "You must be logged in to attach files",
      };
    }

    const ticketId = Number(formData.get("ticketId"));
    if (!ticketId) {
      logEvent("Validation error: Missing ticket ID", "ticket", {}, "warning");
      return { success: false, message: "Ticket ID is required" };
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      logEvent(
        `Ticket ${ticketId} not found`,
        "ticket",
        { ticketId },
        "warning",
      );
      return { success: false, message: "Ticket not found" };
    }

    if (!canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized attachment attempt",
        "ticket",
        { ticketId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to modify this ticket",
      };
    }

    const files = formData
      .getAll("attachments")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length === 0) {
      return { success: false, message: "Select at least one file to attach" };
    }

    if (files.length > MAX_FILES) {
      logEvent(
        "Attachment rejected: too many files",
        "ticket",
        { ticketId, count: files.length, max: MAX_FILES },
        "warning",
      );
      return { success: false, message: `Maximum ${MAX_FILES} files per upload` };
    }

    const existingCount = await prisma.ticketAttachment.count({
      where: { ticketId },
    });
    if (existingCount + files.length > MAX_FILES) {
      return {
        success: false,
        message: `A ticket can have at most ${MAX_FILES} attachments (it already has ${existingCount})`,
      };
    }

    for (const file of files) {
      const validationError = validateAttachmentFile(file);
      if (validationError) {
        logEvent(
          "Attachment rejected: invalid file",
          "ticket",
          { ticketId, fileName: file.name, mimeType: file.type, size: file.size },
          "warning",
        );
        return { success: false, message: validationError };
      }
    }

    // All-or-nothing (same pattern as createTicket): upload first, then
    // persist metadata in one transaction; clean up assets on any failure.
    const uploaded: AttachmentUpload[] = [];
    for (const file of files) {
      try {
        uploaded.push(await uploadAttachment(file));
      } catch (error) {
        logEvent(
          "Cloudinary upload failed while adding attachments",
          "ticket",
          { ticketId, fileName: file.name, size: file.size },
          "error",
          error,
        );
        await Promise.all(
          uploaded.map((asset) => destroyAsset(asset.publicId, asset.resourceType)),
        );
        return {
          success: false,
          message: `Failed to upload "${file.name}" — no attachments were added`,
        };
      }
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.ticketAttachment.createMany({
          data: uploaded.map((asset) => ({
            ...asset,
            ticketId,
            // Recorded from the session, never from form data. Staff may upload
            // onto somebody else's ticket, so the uploader is tracked explicitly
            // and surfaced in the UI.
            uploadedById: user.id,
          })),
        });
      });
    } catch (error) {
      logEvent(
        "Failed to persist attachments",
        "ticket",
        { ticketId, count: uploaded.length },
        "error",
        error,
      );
      await Promise.all(
        uploaded.map((asset) => destroyAsset(asset.publicId, asset.resourceType)),
      );
      return { success: false, message: "Failed to save attachments" };
    }

    // Staff uploading onto a ticket they do not own is an allowed, visible
    // behaviour — give it its own greppable breadcrumb so it can be audited
    // without inferring it from the userId/ticketId pair.
    if (isStaff(user) && user.id !== ticket.userId) {
      logEvent(
        "Staff uploaded an attachment to a ticket they do not own",
        "ticket",
        { ticketId, userId: user.id, count: uploaded.length },
        "info",
      );
    }

    logEvent(
      `Attachment(s) added to ticket ${ticketId}`,
      "ticket",
      {
        ticketId,
        count: uploaded.length,
        uploadedById: user.id,
        uploadedByRole: user.role,
        uploadedByIsOwner: user.id === ticket.userId,
        totalBytes: uploaded.reduce((sum, asset) => sum + asset.size, 0),
      },
      "info",
    );

    revalidatePath("/tickets");
    revalidatePath("/tickets/[id]", "page");

    return {
      success: true,
      message: `${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} added`,
    };
  } catch (error) {
    logEvent(
      "Failed to add attachments",
      "ticket",
      {
        ticketId: formData.get("ticketId"),
        attachmentCount: formData.getAll("attachments").length,
      },
      "error",
      error,
    );
    return { success: false, message: "Failed to add attachments" };
  }
};

/**
 * Hard-deletes one attachment and destroys its Cloudinary asset.
 *
 * The row is deleted BEFORE the asset on purpose. The reverse order can leave a
 * row pointing at a file that no longer exists, which breaks the thumbnail
 * visibly; this way a failed destroy leaves only an orphaned asset, which is
 * invisible to users and already reported to Sentry by destroyAsset's own
 * best-effort contract.
 */
export const deleteAttachment = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent("Unauthorized attachment delete attempt", "ticket", {}, "warning");
      return { success: false, message: "You must be logged in" };
    }

    const attachmentId = String(formData.get("attachmentId") ?? "");
    if (!attachmentId) {
      logEvent("Validation error: Missing attachment ID", "ticket", {}, "warning");
      return { success: false, message: "Attachment ID is required" };
    }

    const attachment = await prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      logEvent(
        "Attachment delete: not found",
        "ticket",
        { attachmentId },
        "warning",
      );
      return { success: false, message: "Attachment not found" };
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: attachment.ticketId },
      select: { userId: true },
    });

    // Belt and braces: being the uploader does not by itself prove you can still
    // reach the ticket — a staff member who was later demoted is still the
    // author but no longer passes canAccessTicket.
    if (!ticket || !canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized attachment delete attempt",
        "ticket",
        { attachmentId, ticketId: attachment.ticketId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to delete this attachment",
      };
    }

    if (!canDeleteUserContent(user, attachment.uploadedById)) {
      logEvent(
        "Attachment delete rejected: not the uploader and not staff",
        "ticket",
        { attachmentId, ticketId: attachment.ticketId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to delete this attachment",
      };
    }

    await prisma.ticketAttachment.delete({ where: { id: attachmentId } });

    // destroyAsset is already best-effort and swallows its own errors, but the
    // row is gone at this point: showing the user a failure would be a lie. The
    // try/catch locks that invariant even if the helper ever stops swallowing.
    try {
      await destroyAsset(attachment.publicId, attachment.resourceType);
    } catch (error) {
      logEvent(
        "Cloudinary asset destroy threw after the row was deleted",
        "ticket",
        { attachmentId, publicId: attachment.publicId },
        "error",
        error,
      );
    }

    logEvent(
      `Attachment ${attachmentId} deleted from ticket ${attachment.ticketId}`,
      "ticket",
      {
        ticketId: attachment.ticketId,
        attachmentId,
        fileName: attachment.fileName,
        uploadedById: attachment.uploadedById,
        deletedBy: user.id,
        deletedByRole: user.role,
      },
      "info",
    );

    revalidatePath("/tickets");
    revalidatePath("/tickets/[id]", "page");

    return { success: true, message: "Attachment deleted" };
  } catch (error) {
    logEvent(
      "Failed to delete attachment",
      "ticket",
      { attachmentId: formData.get("attachmentId") },
      "error",
      error,
    );
    return { success: false, message: "Failed to delete attachment" };
  }
};

/**
 * Soft-deletes one comment: the row survives so a two-way thread never shows a
 * hole where a reply used to be, but the body stops being rendered.
 *
 * Works on a Closed ticket on purpose — retracting your own words is not new
 * conversation, which is the reason comments cannot be *added* there.
 */
export const deleteComment = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent("Unauthorized comment delete attempt", "ticket", {}, "warning");
      return { success: false, message: "You must be logged in" };
    }

    const commentId = Number(formData.get("commentId"));
    if (!commentId) {
      logEvent("Validation error: Missing comment ID", "ticket", {}, "warning");
      return { success: false, message: "Comment ID is required" };
    }

    const comment = await prisma.ticketComment.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      logEvent("Comment delete: not found", "ticket", { commentId }, "warning");
      return { success: false, message: "Comment not found" };
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: comment.ticketId },
      select: { userId: true },
    });

    if (!ticket || !canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized comment delete attempt",
        "ticket",
        { commentId, ticketId: comment.ticketId, userId: user.id },
        "warning",
      );
      return { success: false, message: "You are not allowed to delete this comment" };
    }

    if (!canDeleteUserContent(user, comment.userId)) {
      logEvent(
        "Comment delete rejected: not the author and not staff",
        "ticket",
        { commentId, ticketId: comment.ticketId, userId: user.id },
        "warning",
      );
      return { success: false, message: "You are not allowed to delete this comment" };
    }

    if (comment.deletedAt) {
      // Idempotent: a double submit should not re-stamp the row.
      return { success: true, message: "Comment already removed" };
    }

    await prisma.ticketComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date(), deletedById: user.id },
    });

    logEvent(
      `Comment ${commentId} removed from ticket ${comment.ticketId}`,
      "ticket",
      {
        ticketId: comment.ticketId,
        commentId,
        authorId: comment.userId,
        deletedBy: user.id,
        deletedByRole: user.role,
        deletedByIsAuthor: user.id === comment.userId,
      },
      "info",
    );

    revalidatePath("/tickets");
    revalidatePath("/tickets/[id]", "page");

    return { success: true, message: "Comment removed" };
  } catch (error) {
    logEvent(
      "Failed to delete comment",
      "ticket",
      { commentId: formData.get("commentId") },
      "error",
      error,
    );
    return { success: false, message: "Failed to remove comment" };
  }
};

/**
 * Hard-deletes one file attached to a comment and destroys its Cloudinary asset.
 *
 * Deliberately a sibling of `deleteAttachment` rather than a shared helper: the
 * two tables have independent budgets and independent lifecycles, and comment
 * files carry one extra rule the ticket-level action does not — a soft-deleted
 * comment freezes its whole thread, files included.
 *
 * The row is deleted BEFORE the asset for the same reason as in
 * `deleteAttachment`: the reverse order can leave a row pointing at a file that
 * no longer exists, which breaks the thumbnail visibly. This way a failed
 * destroy leaves only an orphaned asset, invisible to users and already reported
 * to Sentry by destroyAsset's own best-effort contract.
 */
export const deleteCommentAttachment = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent(
        "Unauthorized comment attachment delete attempt",
        "ticket",
        {},
        "warning",
      );
      return { success: false, message: "You must be logged in" };
    }

    const attachmentId = String(formData.get("attachmentId") ?? "");
    if (!attachmentId) {
      logEvent(
        "Validation error: Missing comment attachment ID",
        "ticket",
        {},
        "warning",
      );
      return { success: false, message: "Attachment ID is required" };
    }

    const attachment = await prisma.commentAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      logEvent(
        "Comment attachment delete: not found",
        "ticket",
        { attachmentId },
        "warning",
      );
      return { success: false, message: "Attachment not found" };
    }

    const comment = await prisma.ticketComment.findUnique({
      where: { id: attachment.commentId },
      select: { ticketId: true, deletedAt: true },
    });
    if (!comment) {
      logEvent(
        "Comment attachment delete: parent comment is gone",
        "ticket",
        { attachmentId, commentId: attachment.commentId },
        "warning",
      );
      return { success: false, message: "Attachment not found" };
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: comment.ticketId },
      select: { userId: true },
    });

    // Belt and braces: being the uploader does not by itself prove you can still
    // reach the ticket — a staff member who was later demoted is still the
    // author but no longer passes canAccessTicket.
    if (!ticket || !canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized comment attachment delete attempt",
        "ticket",
        {
          attachmentId,
          commentId: attachment.commentId,
          ticketId: comment.ticketId,
          userId: user.id,
        },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to delete this attachment",
      };
    }

    if (comment.deletedAt) {
      // The rows are deliberately kept when a comment is soft-deleted so the
      // thread never shows a hole. This guard makes the freeze real: without it,
      // files on a removed comment would still be deletable here even though no
      // control for them is ever rendered.
      logEvent(
        "Comment attachment delete rejected: comment already removed",
        "ticket",
        { attachmentId, commentId: attachment.commentId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message:
          "This comment was removed — its attachments can no longer be deleted",
      };
    }

    if (!canDeleteUserContent(user, attachment.uploadedById)) {
      logEvent(
        "Comment attachment delete rejected: not the uploader and not staff",
        "ticket",
        { attachmentId, commentId: attachment.commentId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to delete this attachment",
      };
    }

    await prisma.commentAttachment.delete({ where: { id: attachmentId } });

    // The row is gone by now, so reporting a failure would be a lie. The
    // try/catch locks that invariant even if destroyAsset ever stops swallowing.
    try {
      await destroyAsset(attachment.publicId, attachment.resourceType);
    } catch (error) {
      logEvent(
        "Cloudinary asset destroy threw after the row was deleted",
        "ticket",
        { attachmentId, publicId: attachment.publicId },
        "error",
        error,
      );
    }

    logEvent(
      `Comment attachment ${attachmentId} deleted from comment ${attachment.commentId}`,
      "ticket",
      {
        ticketId: comment.ticketId,
        commentId: attachment.commentId,
        attachmentId,
        fileName: attachment.fileName,
        uploadedById: attachment.uploadedById,
        deletedBy: user.id,
        deletedByRole: user.role,
        deletedByIsAuthor: user.id === attachment.uploadedById,
      },
      "info",
    );

    revalidatePath("/tickets");
    revalidatePath("/tickets/[id]", "page");

    return { success: true, message: "Attachment deleted" };
  } catch (error) {
    logEvent(
      "Failed to delete comment attachment",
      "ticket",
      { attachmentId: formData.get("attachmentId") },
      "error",
      error,
    );
    return { success: false, message: "Failed to delete attachment" };
  }
};

/**
 * Maximum comment length. Kept in sync with the `maxLength` attribute of the
 * comment textarea — the check in the action below is the authoritative one.
 */
const MAX_COMMENT_LENGTH = 5000;

/**
 * Posts a comment on a ticket and triggers the async notification email.
 *
 * Authorization (all server-side, never trust the client):
 * - staff may comment on any ticket, a CLIENT only on their own (`canAccessTicket`)
 * - no comments on a Closed ticket, for anybody
 *
 * Smart workflow: a staff reply to an Open ticket also moves it to In_Progress,
 * atomically with the insert, since a reply means work has actually started.
 *
 * Attachments are optional and all-or-nothing, in the same shape as
 * `createTicket`: validate, upload, then one transaction that writes the
 * comment, its files and the status bump together. Files land in
 * `CommentAttachment`, which has its own budget (`MAX_COMMENT_FILES`) and its own
 * delete path (`deleteCommentAttachment`) — deliberately independent of the
 * ticket-level allowance, so a long thread can never exhaust it.
 *
 * The body stays mandatory even when files are attached. The NEW_COMMENT worker
 * renders `comment.body` into the notification email, so an attachment-only
 * comment would send a blank quote block to the other party.
 */
export const addTicketComment = async (
  prevState: ActionState,
  formData: FormData,
) => {
  try {
    const user = await getCurrentUser();
    if (!user) {
      logEvent("Unauthorized comment attempt", "ticket", {}, "warning");
      return { success: false, message: "You must be logged in to comment" };
    }

    const ticketId = Number(formData.get("ticketId"));
    if (!ticketId) {
      logEvent("Validation error: Missing ticket ID", "ticket", {}, "warning");
      return { success: false, message: "Ticket ID is required" };
    }

    const body = String(formData.get("body") ?? "").trim();
    if (!body) {
      return { success: false, message: "Comment cannot be empty" };
    }
    if (body.length > MAX_COMMENT_LENGTH) {
      logEvent(
        "Comment rejected: body too long",
        "ticket",
        { ticketId, length: body.length },
        "warning",
      );
      return {
        success: false,
        message: `Comments are limited to ${MAX_COMMENT_LENGTH} characters`,
      };
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      logEvent(`Ticket ${ticketId} not found`, "ticket", { ticketId }, "warning");
      return { success: false, message: "Ticket not found" };
    }

    if (!canAccessTicket(user, ticket)) {
      logEvent(
        "Unauthorized comment attempt",
        "ticket",
        { ticketId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "You are not allowed to comment on this ticket",
      };
    }

    if (ticket.status === "Closed") {
      logEvent(
        "Comment rejected: ticket is closed",
        "ticket",
        { ticketId, userId: user.id },
        "warning",
      );
      return {
        success: false,
        message: "This ticket is closed — no new comments can be added",
      };
    }

    // Only a staff reply bumps the status: a client must not be able to move
    // their own ticket into In_Progress.
    const bumpToInProgress = isStaff(user) && ticket.status === "Open";

    // Files are optional. The body is still required, so this can never be an
    // attachment-only comment — see the note in emails/new-comment.tsx about
    // why that matters to the notification email.
    const files = formData
      .getAll("attachments")
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (files.length > MAX_COMMENT_FILES) {
      logEvent(
        "Comment rejected: too many attachments",
        "ticket",
        { ticketId, count: files.length, max: MAX_COMMENT_FILES },
        "warning",
      );
      return {
        success: false,
        message: `Maximum ${MAX_COMMENT_FILES} attachments per comment`,
      };
    }

    for (const file of files) {
      const validationError = validateAttachmentFile(file);
      if (validationError) {
        logEvent(
          "Comment rejected: invalid attachment",
          "ticket",
          { ticketId, fileName: file.name, mimeType: file.type, size: file.size },
          "warning",
        );
        return { success: false, message: validationError };
      }
    }

    // All-or-nothing, exactly as createTicket does it: upload everything BEFORE
    // touching the database, so a failed upload never leaves a comment behind
    // carrying only some of its files.
    const uploaded: AttachmentUpload[] = [];
    for (const file of files) {
      try {
        uploaded.push(await uploadAttachment(file));
      } catch (error) {
        logEvent(
          "Cloudinary upload failed while posting a comment",
          "ticket",
          { ticketId, fileName: file.name, size: file.size },
          "error",
          error,
        );
        await Promise.all(
          uploaded.map((asset) => destroyAsset(asset.publicId, asset.resourceType)),
        );
        return {
          success: false,
          message: `Failed to upload "${file.name}" — your comment was not posted`,
        };
      }
    }

    let comment;
    try {
      comment = await prisma.$transaction(async (tx) => {
        const created = await tx.ticketComment.create({
          data: { body, ticketId, userId: user.id },
        });
        if (uploaded.length > 0) {
          await tx.commentAttachment.createMany({
            data: uploaded.map((asset) => ({
              ...asset,
              commentId: created.id,
              // Recorded from the session, never from form data.
              uploadedById: user.id,
            })),
          });
        }
        if (bumpToInProgress) {
          await tx.ticket.update({
            where: { id: ticketId },
            data: { status: "In_Progress" },
          });
        }
        return created;
      });
    } catch (error) {
      logEvent(
        "Failed to persist ticket comment",
        "ticket",
        { ticketId, statusBumped: bumpToInProgress, attachments: uploaded.length },
        "error",
        error,
      );
      // The comment was not written, so its assets are unreachable: sweep them
      // rather than leaking a Cloudinary file per failed post.
      await Promise.all(
        uploaded.map((asset) => destroyAsset(asset.publicId, asset.resourceType)),
      );
      return { success: false, message: "Failed to post your comment" };
    }

    // Only metadata is logged — the comment body is user content and must not
    // end up in Sentry, and neither do file names.
    logEvent(
      `Comment ${comment.id} added to ticket ${ticketId}`,
      "ticket",
      {
        ticketId,
        commentId: comment.id,
        authorId: user.id,
        authorRole: user.role,
        statusBumped: bumpToInProgress,
        bodyLength: body.length,
        attachments: uploaded.length,
        totalBytes: uploaded.reduce((sum, asset) => sum + asset.size, 0),
      },
      "info",
    );

    revalidatePath("/tickets");
    revalidatePath("/dashboard");
    revalidatePath("/tickets/[id]", "page");

    // Best-effort: enqueue only — the comment email goes out asynchronously.
    await publishJob({ type: "NEW_COMMENT", ticketId, commentId: comment.id });
    if (bumpToInProgress) {
      await publishJob({
        type: "STATUS_UPDATED",
        ticketId,
        newStatus: "In_Progress",
      });
    }

    return {
      success: true,
      message:
        uploaded.length > 0
          ? `Comment posted with ${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"}`
          : "Comment posted",
    };
  } catch (error) {
    logEvent(
      "Failed to add ticket comment",
      "ticket",
      { ticketId: formData.get("ticketId") },
      "error",
      error,
    );
    return { success: false, message: "Failed to post your comment" };
  }
};
