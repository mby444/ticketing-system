import { vi } from "vitest";

/**
 * The Prisma surface the server actions and the email worker actually use.
 * Deliberately hand-written rather than auto-mocked: if a new action calls a
 * method that is missing here, the test fails loudly instead of silently
 * getting `undefined is not a function` deep inside the code under test.
 *
 * Always create a fresh instance per test file (or per test) so state cannot
 * leak between cases, and pair it with `vi.clearAllMocks()` in `beforeEach`.
 */
export const createPrismaMock = () => ({
  ticket: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  ticketAttachment: {
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  ticketComment: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
});

export type PrismaMock = ReturnType<typeof createPrismaMock>;
