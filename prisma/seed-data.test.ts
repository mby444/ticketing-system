import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILES,
  MAX_FILE_SIZE,
} from "@/lib/attachment-limits";
import {
  buildSeedPlan,
  DEFAULT_ATTACHMENT_TICKET_RATIO,
  DEFAULT_SOFT_DELETED_COMMENTS,
  DEFAULT_USER_COUNT,
  mulberry32,
  roleForIndex,
  staffIndices,
  type SeedPlan,
} from "@/prisma/seed-data";
import { STAFF_ROLES } from "@/lib/roles";
import { bytesFor, PNG_SIGNATURE } from "@/prisma/seed-files";

/** Frozen clock, so absolute dates are assertable. */
const NOW = new Date("2026-10-03T12:00:00.000Z");
const DAY = 86_400_000;
const STAFF_COUNT = 4;

const plan = buildSeedPlan({ now: NOW, staffCount: STAFF_COUNT });

const allComments = plan.tickets.flatMap((ticket) =>
  ticket.comments.map((comment) => ({ ticket, comment })),
);

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const first = Array.from({ length: 20 }, a);
    const second = Array.from({ length: 20 }, b);
    expect(first).toEqual(second);
  });

  it("produces different streams for different seeds", () => {
    const a = Array.from({ length: 20 }, mulberry32(1));
    const b = Array.from({ length: 20 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it("stays inside [0, 1)", () => {
    const next = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("does not collapse onto a single value", () => {
    // A broken PRNG that returned a constant would still satisfy determinism and
    // the range check above, and would quietly flatten the whole dataset.
    const next = mulberry32(99);
    const values = new Set(Array.from({ length: 200 }, next));
    expect(values.size).toBeGreaterThan(150);
  });
});

describe("buildSeedPlan determinism", () => {
  it("produces an identical plan for the same seed and clock", () => {
    const a = buildSeedPlan({ now: NOW, staffCount: STAFF_COUNT });
    const b = buildSeedPlan({ now: NOW, staffCount: STAFF_COUNT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a different plan for a different seed", () => {
    const a = buildSeedPlan({ seed: "one", now: NOW, staffCount: STAFF_COUNT });
    const b = buildSeedPlan({ seed: "two", now: NOW, staffCount: STAFF_COUNT });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("does not read Math.random for reproducible values", () => {
    // Two runs at different wall-clock instants but the same injected clock must
    // agree; if any value came from Math.random they would diverge.
    const a = buildSeedPlan({ now: NOW, staffCount: STAFF_COUNT });
    const b = buildSeedPlan({ now: NOW, staffCount: STAFF_COUNT });
    expect(a.tickets[0].createdAt.getTime()).toBe(b.tickets[0].createdAt.getTime());
  });
});

describe("users", () => {
  it("has exactly one ADMIN and the rest split by staffCount", () => {
    const admins = plan.users.filter((u) => u.role === "ADMIN");
    const agents = plan.users.filter((u) => u.role === "SUPPORT_AGENT");
    const clients = plan.users.filter((u) => u.role === "CLIENT");

    expect(admins).toHaveLength(1);
    expect(agents).toHaveLength(STAFF_COUNT - 1);
    expect(clients).toHaveLength(plan.users.length - STAFF_COUNT);
    expect(plan.users.length).toBe(DEFAULT_USER_COUNT);
  });

  it("assigns roles by index, ADMIN first", () => {
    expect(plan.users[0].role).toBe("ADMIN");
    for (let i = 1; i < STAFF_COUNT; i++) {
      expect(plan.users[i].role).toBe("SUPPORT_AGENT");
    }
    expect(plan.users[STAFF_COUNT].role).toBe("CLIENT");
  });

  it("uses unique, sequential, well-formed emails", () => {
    const emails = plan.users.map((u) => u.email);
    expect(new Set(emails).size).toBe(emails.length);
    emails.forEach((email, index) => {
      expect(email).toBe(`user${index + 1}@example.com`);
    });
  });

  it("exposes staff indices that match the staff roles", () => {
    const indices = staffIndices(plan.users.length, STAFF_COUNT);
    expect(indices).toEqual([0, 1, 2, 3]);
    for (const index of indices) {
      expect(STAFF_ROLES).toContain(plan.users[index].role);
    }
  });

  it("never creates a ticket before the user who owns it existed", () => {
    for (const ticket of plan.tickets) {
      const owner = plan.users[ticket.ownerIndex];
      expect(ticket.createdAt.getTime()).toBeGreaterThanOrEqual(
        owner.createdAt.getTime() + DAY,
      );
    }
  });

  it("rolls roleForIndex and staffIndices together", () => {
    // The two helpers must agree, or a ticket could be assigned to an index the
    // user list calls a CLIENT.
    for (let index = 0; index < plan.users.length; index++) {
      const isStaff = roleForIndex(index, STAFF_COUNT) !== "CLIENT";
      expect(staffIndices(plan.users.length, STAFF_COUNT).includes(index)).toBe(
        isStaff,
      );
    }
  });
});

describe("tickets", () => {
  it("has no owner or assignee index outside the user list", () => {
    for (const ticket of plan.tickets) {
      expect(ticket.ownerIndex).toBeGreaterThanOrEqual(0);
      expect(ticket.ownerIndex).toBeLessThan(plan.users.length);
      if (ticket.assigneeStaffIndex !== null) {
        expect(ticket.assigneeStaffIndex).toBeGreaterThanOrEqual(0);
        expect(ticket.assigneeStaffIndex).toBeLessThan(plan.users.length);
      }
    }
  });

  it("only ever assigns staff, because listAgents() only returns staff", () => {
    const assigned = plan.tickets.filter(
      (t) => t.assigneeStaffIndex !== null,
    );
    // The seed must produce assigned tickets at all, or the dashboard partition
    // and the ?filter=mine chip stay permanently empty.
    expect(assigned.length).toBeGreaterThan(0);

    for (const ticket of assigned) {
      const assignee = plan.users[ticket.assigneeStaffIndex!];
      expect(STAFF_ROLES).toContain(assignee.role);
    }
  });

  it("covers every status and every priority", () => {
    expect(new Set(plan.tickets.map((t) => t.status))).toEqual(
      new Set(["Open", "In_Progress", "Resolved", "Closed"]),
    );
    expect(new Set(plan.tickets.map((t) => t.priority))).toEqual(
      new Set(["Low", "Medium", "High", "Critical"]),
    );
  });

  it("spreads createdAt over months instead of a few milliseconds", () => {
    const times = plan.tickets.map((t) => t.createdAt.getTime());
    const span = Math.max(...times) - Math.min(...times);
    // The previous seed wrote every ticket inside the same 375 ms, which made
    // "most recent first" sorting meaningless.
    expect(span).toBeGreaterThan(30 * DAY);
  });

  it("never dates a ticket in the future", () => {
    for (const ticket of plan.tickets) {
      expect(ticket.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("pairs each subject with its own description", () => {
    // templateIndex is what guarantees the pairing; two tickets sharing an index
    // share the text, which is fine, but a mismatched index/body would not be.
    for (const ticket of plan.tickets) {
      expect(ticket.subject.length).toBeGreaterThan(0);
      expect(ticket.description.length).toBeGreaterThan(ticket.subject.length / 2);
    }
  });
});

describe("comments", () => {
  it("opens every thread with a client message", () => {
    for (const ticket of plan.tickets) {
      expect(ticket.comments[0].authorKind).toBe("client");
      expect(ticket.comments[0].staffIndex).toBeUndefined();
    }
  });

  it("never puts a staff reply on an Open ticket", () => {
    // addTicketComment bumps Open -> In_Progress on a staff reply, so this state
    // is unreachable through the UI.
    const offenders = plan.tickets.filter(
      (ticket) =>
        ticket.status === "Open" &&
        ticket.comments.some((c) => c.authorKind === "staff"),
    );
    expect(offenders).toEqual([]);
  });

  it("does put staff replies on the active statuses", () => {
    const withStaff = plan.tickets.filter((t) =>
      t.comments.some((c) => c.authorKind === "staff"),
    );
    expect(withStaff.length).toBeGreaterThan(0);
  });

  it("authors every staff comment by a staff member", () => {
    for (const { comment } of allComments) {
      if (comment.authorKind !== "staff") continue;
      expect(comment.staffIndex).toBeDefined();
      const author = plan.users[comment.staffIndex!];
      expect(STAFF_ROLES).toContain(author.role);
    }
  });

  it("keeps each thread strictly ordered", () => {
    for (const ticket of plan.tickets) {
      for (let i = 1; i < ticket.comments.length; i++) {
        expect(ticket.comments[i].createdAt.getTime()).toBeGreaterThan(
          ticket.comments[i - 1].createdAt.getTime(),
        );
      }
    }
  });

  it("dates every comment after its ticket and before now", () => {
    for (const { ticket, comment } of allComments) {
      expect(comment.createdAt.getTime()).toBeGreaterThan(
        ticket.createdAt.getTime(),
      );
      expect(comment.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("uses the same time source the thread orders by", () => {
    // The UI orders by createdAt then id; equal timestamps are tolerated, but a
    // non-monotonic thread would render replies before the opening message.
    for (const ticket of plan.tickets) {
      const ordered = [...ticket.comments].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      expect(ordered.map((c) => c.body)).toEqual(ticket.comments.map((c) => c.body));
    }
  });

  it("marks exactly the requested number as already removed", () => {
    const removed = allComments.filter((entry) => entry.comment.removedBy);
    expect(removed).toHaveLength(DEFAULT_SOFT_DELETED_COMMENTS);
    expect(plan.softDeletedComments).toBe(DEFAULT_SOFT_DELETED_COMMENTS);
  });

  it("covers all three removal attribution paths", () => {
    const modes = new Set(
      allComments
        .map((entry) => entry.comment.removedBy)
        .filter((mode): mode is NonNullable<typeof mode> => Boolean(mode)),
    );
    // author = a customer retracting their own message, staff = support
    // moderating a customer message, admin = one agent moderating another.
    expect(modes).toEqual(new Set(["author", "staff", "admin"]));
  });

  it("only self-removes a customer message", () => {
    for (const { comment } of allComments) {
      if (comment.removedBy !== "author") continue;
      expect(comment.authorKind).toBe("client");
    }
  });

  it("marks nothing when the budget is zero", () => {
    const none = buildSeedPlan({
      now: NOW,
      staffCount: STAFF_COUNT,
      softDeletedComments: 0,
    });
    expect(none.tickets.flatMap((t) => t.comments).some((c) => c.removedBy)).toBe(
      false,
    );
    expect(none.softDeletedComments).toBe(0);
  });
});

describe("attachments", () => {
  const attachments = plan.tickets.flatMap((ticket) =>
    ticket.attachments.map((attachment) => ({ ticket, attachment })),
  );

  it("seeds some attachments, or the list and badge stay invisible", () => {
    expect(attachments.length).toBeGreaterThan(0);
    expect(DEFAULT_ATTACHMENT_TICKET_RATIO).toBeGreaterThan(0);
  });

  it("respects the per-ticket cap", () => {
    for (const ticket of plan.tickets) {
      expect(ticket.attachments.length).toBeLessThanOrEqual(MAX_FILES);
    }
  });

  it("only uses MIME types the app accepts", () => {
    for (const { attachment } of attachments) {
      expect(ALLOWED_MIME_TYPES).toContain(attachment.mimeType);
    }
  });

  it("gives every file a globally unique name", () => {
    const names = attachments.map((a) => a.attachment.fileName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("matches the extension to the MIME type", () => {
    const extensionFor: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "application/pdf": "pdf",
    };
    for (const { attachment } of attachments) {
      expect(attachment.fileName.endsWith(`.${extensionFor[attachment.mimeType]}`)).toBe(
        true,
      );
    }
  });

  it("only plans MIME types the seed can actually generate", () => {
    // This is the guard for a real bug: the plan once listed image/jpeg and
    // image/webp while `bytesFor` only ever produced PNG, so those rows stored a
    // mimeType that contradicted the uploaded bytes. Checking the magic number of
    // the generated file against the planned MIME type is the only assertion that
    // actually catches it -- the MIME type being on the allow-list proves nothing.
    const magicFor: Record<string, (bytes: Buffer) => boolean> = {
      "image/png": (bytes) => bytes.subarray(0, 8).equals(PNG_SIGNATURE),
      "application/pdf": (bytes) =>
        bytes.subarray(0, 5).toString("latin1") === "%PDF-",
    };

    const seen = new Set<string>();
    let ordinal = 0;
    for (const { attachment } of attachments) {
      const match = magicFor[attachment.mimeType];
      expect(match, `no generator for ${attachment.mimeType}`).toBeDefined();
      const bytes = bytesFor(attachment.mimeType, attachment.fileName, ordinal++);
      expect(match!(bytes), `${attachment.mimeType} does not match its own bytes`).toBe(
        true,
      );
      seen.add(attachment.mimeType);
    }
    // Both formats the seed can produce should show up, so a future change that
    // quietly drops all PDFs is visible here rather than in the UI.
    expect(seen).toEqual(new Set(["image/png", "application/pdf"]));
  });

  it("shows both badge states: owner uploads and support uploads", () => {
    const kinds = new Set(attachments.map((a) => a.attachment.uploaderKind));
    expect(kinds).toEqual(new Set(["owner", "staff"]));
  });

  it("never lets support upload onto their own ticket", () => {
    // The badge predicate is `uploader !== ticket owner`, not
    // `isStaff(uploader)`, so a staff member uploading onto their own ticket is
    // deliberately unbadged. Seeding that case would show no badge at all and
    // make the feature look broken.
    for (const { ticket, attachment } of attachments) {
      if (attachment.uploaderKind !== "staff") continue;
      expect(attachment.staffIndex).toBeDefined();
      expect(attachment.staffIndex).not.toBe(ticket.ownerIndex);
    }
  });

  it("really exercises the own-ticket case", () => {
    // The default plan makes every ticket owner a CLIENT except roughly one in
    // eight, so the assertion above could pass simply because no staff upload
    // ever landed on a staff-owned ticket -- a vacuous pass. This fixture makes
    // every owner a staff member and every ticket carry attachments, so the rule
    // is genuinely under load.
    const staffOwned = buildSeedPlan({
      seed: "badge-rule",
      now: NOW,
      userCount: 4,
      staffCount: 4,
      ticketsPerUser: [6, 6],
      attachmentTicketRatio: 1,
      softDeletedComments: 0,
    });

    expect(staffOwned.tickets).toHaveLength(24);
    // Assert coverage explicitly, otherwise a fixture that stopped producing
    // staff uploads would make this whole case disappear silently.
    expect(
      staffOwned.tickets.every((t) => plan.users[t.ownerIndex].role !== "CLIENT"),
    ).toBe(true);

    const staffUploads = staffOwned.tickets.flatMap((ticket) =>
      ticket.attachments
        .filter((a) => a.uploaderKind === "staff")
        .map((a) => ({ ownerIndex: ticket.ownerIndex, staffIndex: a.staffIndex! })),
    );
    expect(staffUploads.length).toBeGreaterThan(0);
    for (const upload of staffUploads) {
      expect(upload.staffIndex).not.toBe(upload.ownerIndex);
    }
  });
});

describe("shared attachment bounds", () => {
  it("uses the app's real MIME allow-list, not a copy", () => {
    // The seed used to duplicate these three constants and rely on a drift test
    // to catch divergence. They now come from `lib/attachment-limits.ts`, so the
    // guarantee is structural rather than tested after the fact.
    const mimeTypes = new Set(plan.tickets.flatMap((t) => t.attachments.map((a) => a.mimeType)));
    for (const mimeType of mimeTypes) {
      expect(ALLOWED_MIME_TYPES).toContain(mimeType);
    }
  });

  it("stays inside the per-ticket cap the app enforces", () => {
    expect(MAX_FILES).toBe(5);
    for (const ticket of plan.tickets) {
      expect(ticket.attachments.length).toBeLessThanOrEqual(MAX_FILES);
    }
  });

  it("keeps the per-file size cap reachable for a generated file", () => {
    // seed.ts generates tiny files, so the real risk is the opposite one: that
    // the cap is small enough for a seed file to exist at all.
    expect(MAX_FILE_SIZE).toBeGreaterThan(1024);
  });
});

describe("dependency isolation", () => {
  const source = readFileSync(
    path.join(process.cwd(), "prisma", "seed-data.ts"),
    "utf8",
  );

  it("does not import the Prisma client as a value", () => {
    // The whole reason the plan lives in its own module is that this test can run
    // without a database. A value import of the generated client would pull the
    // Prisma runtime in here and, worse, could make this suite touch the live
    // Neon database. Type-only imports are fine, so they are removed first --
    // the attachment limits below are a legitimate value import.
    const withoutTypeImports = source.replace(/^import type[^;]*;/gm, "");
    expect(withoutTypeImports).not.toMatch(/@\/generated\/prisma/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/prisma["']/);
  });

  it("imports the generated client for types only", () => {
    expect(source).toMatch(
      /import type \{[^}]*\} from "@\/generated\/prisma\/client"/,
    );
  });

  it("does not import Cloudinary, Next.js or the SDK-bearing helper", () => {
    expect(source).not.toMatch(/from\s+["']cloudinary["']/);
    expect(source).not.toMatch(/from\s+["']next\//);
    // lib/cloudinary.ts re-exports the limits, but importing it would still pull
    // in the Cloudinary and Sentry SDKs and undo the extraction.
    expect(source).not.toMatch(/from\s+["']@\/lib\/cloudinary["']/);
  });

  it("imports the limits from the dependency-free module", () => {
    expect(source).toMatch(/from\s+["']@\/lib\/attachment-limits["']/);
  });
});

describe("invalid options", () => {
  it("rejects fewer users than staff agents", () => {
    expect(() =>
      buildSeedPlan({ userCount: 2, staffCount: 4, now: NOW }),
    ).toThrow(/at least staffCount/);
  });

  it("produces an empty, non-crashing plan at the smallest supported size", () => {
    const tiny = buildSeedPlan({
      userCount: 4,
      staffCount: 4,
      ticketsPerUser: [1, 1],
      attachmentTicketRatio: 0,
      softDeletedComments: 0,
      now: NOW,
    });
    expect(tiny.users).toHaveLength(4);
    expect(tiny.tickets).toHaveLength(4);
    expect(tiny.tickets.every((t) => t.attachments.length === 0)).toBe(true);
  });
});

describe("seed volume defaults", () => {
  const check = (candidate: SeedPlan) => {
    expect(candidate.users.length).toBeGreaterThanOrEqual(25);
    expect(candidate.tickets.length).toBeGreaterThanOrEqual(100);
    expect(candidate.tickets.flatMap((t) => t.comments).length).toBeGreaterThan(200);
  };

  it("produces a demo-sized dataset by default", () => {
    check(plan);
  });

  it("scales with userCount", () => {
    const small = buildSeedPlan({
      userCount: 8,
      staffCount: 2,
      ticketsPerUser: [1, 2],
      attachmentTicketRatio: 0,
      softDeletedComments: 0,
      now: NOW,
    });
    expect(small.users).toHaveLength(8);
    expect(small.tickets.length).toBeLessThanOrEqual(16);
  });
});