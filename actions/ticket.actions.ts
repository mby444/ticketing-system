"use server";

import { getCurrentUser } from "@/lib/current-user";
import { canAccessTicket, isStaff, STAFF_ROLES } from "@/lib/authorization";
import { TicketStatus } from "@/generated/prisma/client";
import {
  MAX_FILES,
  validateAttachmentFile,
  uploadAttachment,
  destroyAsset,
  type AttachmentUpload,
} from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
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
    const priority = formData.get("priority") as string;

    if (!subject || !description || !priority) {
      Sentry.captureMessage("Validation Error: Missing ticket fields", {
        level: "warning",
      });
      return { success: false, message: "All fields are required" };
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
            data: uploaded.map((asset) => ({ ...asset, ticketId: created.id })),
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
      include: { attachments: { orderBy: { createdAt: "asc" } } },
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

    const { count } = await prisma.ticket.updateMany({
      where: { id: ticketId },
      data: { assigneeId: assigneeId || null },
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
      assigneeId
        ? `Ticket ${ticketId} assigned to ${assigneeId}`
        : `Ticket ${ticketId} unassigned`,
      "ticket",
      { ticketId, assigneeId: assigneeId || null },
      "info",
    );

    revalidatePath("/dashboard");
    revalidatePath("/tickets");

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
          data: uploaded.map((asset) => ({ ...asset, ticketId })),
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

    logEvent(
      `Attachment(s) added to ticket ${ticketId}`,
      "ticket",
      {
        ticketId,
        count: uploaded.length,
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
