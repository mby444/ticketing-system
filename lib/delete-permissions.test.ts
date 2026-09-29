import { describe, expect, it } from "vitest";
import { canDeleteUserContent } from "@/lib/delete-permissions";
import type { Role } from "@/generated/prisma/client";

const AUTHOR = "client-1";
const OTHER_CLIENT = "client-2";
const AGENT = "agent-1";
const OTHER_AGENT = "agent-2";

const viewer = (id: string, role: Role) => ({ id, role });

describe("canDeleteUserContent", () => {
  it("lets the author delete their own content", () => {
    expect(canDeleteUserContent(viewer(AUTHOR, "CLIENT"), AUTHOR)).toBe(true);
    expect(canDeleteUserContent(viewer(AGENT, "SUPPORT_AGENT"), AGENT)).toBe(true);
    expect(canDeleteUserContent(viewer("admin-1", "ADMIN"), "admin-1")).toBe(true);
  });

  it("denies another client", () => {
    expect(canDeleteUserContent(viewer(OTHER_CLIENT, "CLIENT"), AUTHOR)).toBe(false);
  });

  it("lets any staff member moderate, whoever the author was", () => {
    expect(canDeleteUserContent(viewer(AGENT, "SUPPORT_AGENT"), OTHER_CLIENT)).toBe(true);
    expect(canDeleteUserContent(viewer(AGENT, "SUPPORT_AGENT"), OTHER_AGENT)).toBe(true);
    expect(canDeleteUserContent(viewer("admin-1", "ADMIN"), OTHER_CLIENT)).toBe(true);
  });

  it("denies a client even when they authored a reply on the same ticket", () => {
    // A thread's participants are the owner and staff; this pins that the rule
    // is author-or-staff, never "involved in the ticket".
    expect(canDeleteUserContent(viewer(OTHER_CLIENT, "CLIENT"), AGENT)).toBe(false);
  });

  it("stops treating a former staff member as staff", () => {
    // A user whose role was demoted is no longer an author-or-staff match, so
    // the action's separate canAccessTicket check becomes load-bearing.
    expect(canDeleteUserContent(viewer(AGENT, "CLIENT"), AGENT)).toBe(true);
    expect(canDeleteUserContent(viewer(AGENT, "CLIENT"), OTHER_AGENT)).toBe(false);
  });
});
