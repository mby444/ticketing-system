import type { TicketPriority } from "@/generated/prisma/client";

/**
 * Canonical, ordered list of priorities for selects.
 *
 * Hand-written rather than `Object.values(TicketPriority)` on purpose: client
 * components import this module, and importing the generated Prisma client as a
 * *value* would pull its runtime into the browser bundle (the same reason
 * lib/cloudinary.ts must never be imported from a client component).
 *
 * `satisfies` ties the list to the enum at compile time, so a typo fails the
 * build, and lib/priority.test.ts asserts the list covers the enum exactly —
 * which is what stops the form and the database from drifting apart.
 */
export const PRIORITY_OPTIONS = [
  "Low",
  "Medium",
  "High",
  "Critical",
] as const satisfies readonly TicketPriority[];

/** Whitelist guard for user-supplied values (form posts, API payloads). */
export const isTicketPriority = (value: unknown): value is TicketPriority =>
  typeof value === "string" &&
  (PRIORITY_OPTIONS as readonly string[]).includes(value);
