import type { Role } from "@/generated/prisma/client";

/**
 * Role checks, kept free of any Next.js or auth imports so that non-page
 * server code (e.g. the QStash email worker in lib/email.ts) can use them
 * without dragging `next/headers` into its module graph.
 */

/** Roles that may access the staff dashboard and manage all tickets. */
export const STAFF_ROLES: Role[] = ["SUPPORT_AGENT", "ADMIN"];

/** Staff (SUPPORT_AGENT, ADMIN) manage all tickets; CLIENT only their own. */
export const isStaff = (user: { role: Role }): boolean =>
  STAFF_ROLES.includes(user.role);
