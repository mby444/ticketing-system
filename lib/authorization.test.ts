import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUser } from "@/test-utils/factories";

/**
 * The security primitive every mutating action relies on. If canAccessTicket
 * or isStaff ever change shape, every authorization decision in the app changes
 * with them — so this is the highest-value test in the repo.
 */

// vi.mock factories are hoisted above the imports, so the things they close
// over must come from vi.hoisted. A plain top-level const would be undefined
// at mock time.
const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("next/navigation", () => ({ redirect }));

import {
  canAccessTicket,
  isStaff,
  requireUser,
  STAFF_ROLES,
} from "@/lib/authorization";

const OWNER_ID = "owner-1";
const ticketOf = (ownerId: string) => ({ userId: ownerId });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("STAFF_ROLES", () => {
  it("is exactly SUPPORT_AGENT and ADMIN", () => {
    expect([...STAFF_ROLES].sort()).toEqual(["ADMIN", "SUPPORT_AGENT"]);
  });
});

describe("isStaff", () => {
  it.each([
    ["ADMIN", true],
    ["SUPPORT_AGENT", true],
    ["CLIENT", false],
  ] as const)("%s -> %s", (role, expected) => {
    expect(isStaff(makeUser({ role }))).toBe(expected);
  });
});

describe("canAccessTicket", () => {
  it("lets a CLIENT into their own ticket", () => {
    const user = makeUser({ role: "CLIENT", id: OWNER_ID });
    expect(canAccessTicket(user, ticketOf(OWNER_ID))).toBe(true);
  });

  it("denies a CLIENT somebody else's ticket", () => {
    const user = makeUser({ role: "CLIENT", id: "client-1" });
    expect(canAccessTicket(user, ticketOf(OWNER_ID))).toBe(false);
  });

  it("lets SUPPORT_AGENT into any ticket", () => {
    const user = makeUser({ role: "SUPPORT_AGENT", id: "agent-1" });
    expect(canAccessTicket(user, ticketOf(OWNER_ID))).toBe(true);
  });

  it("lets ADMIN into any ticket", () => {
    const user = makeUser({ role: "ADMIN", id: "admin-1" });
    expect(canAccessTicket(user, ticketOf(OWNER_ID))).toBe(true);
  });

  it("denies a CLIENT when the owner id merely starts the same", () => {
    // Guards against a sloppy prefix/equality check sneaking in.
    const user = makeUser({ role: "CLIENT", id: `${OWNER_ID}-extra` });
    expect(canAccessTicket(user, ticketOf(OWNER_ID))).toBe(false);
  });
});

describe("requireUser", () => {
  it("returns the session user when one exists", async () => {
    const session = makeUser({ id: "u1" });
    getCurrentUser.mockResolvedValue(session);

    await expect(requireUser()).resolves.toBe(session);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no session", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
