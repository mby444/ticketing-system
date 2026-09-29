import { describe, expect, it } from "vitest";

/**
 * Guards the guard. `vitest.setup.ts` repoints DATABASE_URL at a dead local
 * socket so a test that forgets to mock `@/lib/prisma` fails loudly instead of
 * quietly reading or writing the live Neon database. This test makes sure that
 * rail is still in place — without it, a well-meaning edit to the setup file
 * could silently re-open database access to the whole test suite.
 *
 * It deliberately does not mock `@/lib/prisma`.
 */
import { prisma } from "@/lib/prisma";

describe("database safety rail", () => {
  it("points DATABASE_URL away from the real host", () => {
    const host = new URL(process.env.DATABASE_URL as string).host;
    expect(host).toMatch(/^127\.0\.0\.1:/);
  });

  it("rejects an unmocked query instead of reaching the database", async () => {
    await expect(prisma.user.count()).rejects.toThrow();
  });
});
