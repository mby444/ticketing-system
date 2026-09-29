import type { Role } from "@/generated/prisma/client";
import { isStaff } from "@/lib/roles";

/**
 * Who may remove user-authored content from a ticket.
 *
 * One rule for both attachments and comments: the author, or any staff member.
 *
 * Deliberately NOT "the ticket owner" — a customer can open a thread in which
 * support replied, and must not be able to erase the support side of the
 * record. Staff keep the power to moderate, which is the whole point of the
 * role existing; the author keeps the power to retract a mistake.
 *
 * This is deliberately a pure function with no Prisma or Next.js import: the
 * check is the security-relevant part of both delete actions, so it is unit
 * tested rather than reached only through the UI.
 */
export const canDeleteUserContent = (
  viewer: { id: string; role: Role },
  authorId: string,
): boolean => viewer.id === authorId || isStaff(viewer);
