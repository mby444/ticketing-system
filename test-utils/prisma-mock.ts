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
export const createPrismaMock = () => {
  const prisma = {
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
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    ticketComment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    // Added with comment attachments. `createMany` is called inside the
    // addTicketComment transaction, `findUnique`/`delete` by
    // deleteCommentAttachment.
    // Added with password reset. `upsert` replaces the row for a user (the
    // schema is unique on userId), `findUnique` verifies, and `update` is how a
    // wrong guess burns one attempt.
    passwordResetOtp: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    commentAttachment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    notification: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      // `create` for registerUser, `update` for the password reset writing a new
      // hash. Both were missing while the actions already called them — the
      // surface is only as good as its last audit against real call sites, which
      // is what test-utils/safety-rail.test.ts exists to keep honest.
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  // The interactive-transaction callbacks in the actions receive a `tx` and
  // call the same delegates on it. Handing them this very object keeps the
  // assertions in the test working without a second fake.
  return Object.assign(prisma, {
    $transaction: vi.fn(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    ),
  });
};

export type PrismaMock = ReturnType<typeof createPrismaMock>;
