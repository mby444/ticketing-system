import { redirect } from "next/navigation";
import { getCurrentUser } from "./current-user";
import type { Role } from "@/generated/prisma/client";

/** The authenticated user, including their role. */
export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Roles that may access the staff dashboard and manage all tickets. */
export const STAFF_ROLES: Role[] = ["SUPPORT_AGENT", "ADMIN"];

/** Staff (SUPPORT_AGENT, ADMIN) manage all tickets; CLIENT only their own. */
export const isStaff = (user: { role: Role }): boolean =>
  STAFF_ROLES.includes(user.role);

/**
 * Server-side ticket access check. Staff may access any ticket,
 * clients only tickets they own. Always enforce this in actions —
 * never trust anything rendered on the client.
 */
export const canAccessTicket = (
  user: SessionUser,
  ticket: { userId: string },
): boolean => isStaff(user) || ticket.userId === user.id;

/** Page guard: redirect to /login when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Page guard: require one of the given roles, otherwise go to /tickets. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/tickets");
  return user;
}
