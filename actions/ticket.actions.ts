"use server";

import { getCurrentUser } from "@/lib/current-user";
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

    const ticket = await prisma.ticket.create({
      data: {
        subject,
        description,
        priority,
        userId: user.id,
      },
    });

    logEvent(
      `Ticket ${ticket.id} created successfully`,
      "ticket",
      { ticketId: ticket.id },
      "info",
    );

    revalidatePath("/tickets");

    return { success: true, message: "Ticket created successfully" };
  } catch (error) {
    logEvent(
      "Failed to create ticket",
      "ticket",
      { formData: Object.fromEntries(formData.entries()) },
      "error",
    );
    return { success: false, message: "Failed to create ticket" };
  }
};

export const getTickets = async () => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      logEvent("Unauthorized ticket fetch attempt", "ticket", {}, "warning");

      return {
        success: false,
        message: "You must be logged in to fetch tickets",
      };
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
    logEvent("Failed to get tickets", "ticket", {}, "error");
    return [];
  }
};

export const getTicketById = async (id: number) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id } });

    if (!ticket) {
      logEvent(`Ticket ${id} not found`, "ticket", { ticketId: id }, "warning");
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
    const ticketId = Number(formData.get("ticketId"));

    if (!ticketId) {
      logEvent("Validation error: Missing ticket ID", "ticket", {}, "warning");
      return { success: false, message: "Ticket ID is required" };
    }

    const ticket = await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "Closed" },
    });

    logEvent(
      `Ticket ${ticket.id} closed successfully`,
      "ticket",
      { ticketId: ticket.id },
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
    );
    return { success: false, message: "Failed to close ticket" };
  }
};
