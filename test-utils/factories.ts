import type { Role } from "@/generated/prisma/client";

/**
 * Test data builders. The user shape is deliberately identical to what
 * `getCurrentUser()` returns (see `SessionUser` in lib/authorization.ts) so
 * tests can pass one straight into an action with no casting.
 */
export const makeUser = (
  overrides: Partial<{
    id: string;
    email: string;
    name: string | null;
    role: Role;
  }> = {},
) => ({
  id: "user-1",
  email: "user1@example.com",
  name: "User One",
  role: "CLIENT" as Role,
  ...overrides,
});

/** Builds a FormData shaped like a real <form> submission. */
export const form = (entries: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
};

/**
 * A File without touching the filesystem. `size` is read-only on File, so the
 * size-boundary cases (empty file, > 5 MB) are set explicitly.
 */
export const makeFile = (
  name: string,
  type: string,
  size?: number,
  content = "x",
): File => {
  const file = new File([content], name, { type });
  if (size !== undefined && size !== file.size) {
    Object.defineProperty(file, "size", { value: size });
  }
  return file;
};

/** A ticket row shaped like the parts the actions read. */
export const makeTicket = (
  overrides: Partial<{
    id: number;
    status: "Open" | "In_Progress" | "Resolved" | "Closed";
    userId: string;
    assigneeId: string | null;
    subject: string;
  }> = {},
) => ({
  id: 1,
  subject: "Something is broken",
  status: "Open" as const,
  userId: "owner-1",
  assigneeId: null as string | null,
  ...overrides,
});
