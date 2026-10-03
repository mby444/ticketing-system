import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@/lib/prisma";
import { buildNotificationJobs } from "@/lib/notifications";
import {
  buildSeedPlan,
  DEFAULT_TICKETS_PER_USER,
  DEFAULT_USER_COUNT,
  type SeedPlan,
} from "@/prisma/seed-data";
import { bytesFor } from "@/prisma/seed-files";
import { NotificationType } from "@/generated/prisma/client";
import bcrypt from "bcryptjs";

/**
 * Database writer for the seed.
 *
 * All of the *thinking* lives in `prisma/seed-data.ts`, which is pure and unit
 * tested. This file only resolves that plan against the three things it cannot
 * fake: the database, the password hash, and Cloudinary.
 *
 * Run with `npx prisma db seed` (see prisma7.config.ts) or `db_fresh.bat`.
 */

// Seed attachments live in their own folder so a re-seed can delete exactly
// them. Real uploads go to ATTACHMENTS_FOLDER ("quickticket/tickets") and must
// never be touched by a database reset.
const SEED_ATTACHMENTS_FOLDER = "quickticket/seed";

const SEED_PASSWORD = "password123";

const addMinutes = (date: Date, minutes: number): Date =>
  new Date(date.getTime() + minutes * 60 * 1000);

/**
 * A seeded notification is already read if it is older than this.
 *
 * Derived from the row's own timestamp rather than a random roll, so it needs no
 * extra RNG stream and stays identical between two runs of the same seed. It also
 * produces something realistic: the recent window stays unread so the badge is
 * non-zero on a fresh seed, and older activity has been read.
 */
const NOTIFICATION_READ_AFTER_DAYS = 7;
const readAtFor = (createdAt: Date, now: Date): Date | null =>
  createdAt.getTime() + NOTIFICATION_READ_AFTER_DAYS * 86_400_000 < now.getTime()
    ? addMinutes(createdAt, 30)
    : null;

// ---------------------------------------------------------------------------
// Environment overrides
// ---------------------------------------------------------------------------

const intFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ticketsPerUserFromEnv = (): [number, number] => {
  const raw = process.env.SEED_TICKETS_PER_USER?.trim();
  if (!raw) return [...DEFAULT_TICKETS_PER_USER];
  const [min, max] = raw.split(":").map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(min)) return [...DEFAULT_TICKETS_PER_USER];
  return [min, Number.isFinite(max) ? Math.max(min, max) : min];
};

/** `SEED_NO_ATTACHMENTS=1` skips Cloudinary entirely (offline seeding). */
const attachmentsEnabled = !/(^(1|true|yes)$)/i.test(
  (process.env.SEED_NO_ATTACHMENTS ?? "").trim(),
);

// ---------------------------------------------------------------------------
// Cloudinary
// ---------------------------------------------------------------------------

const cloudinaryConfigured = () => {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return false;
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  return true;
};

type SeedAttachmentRow = {
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  publicId: string;
  resourceType: string;
  ticketId: number;
  uploadedById: string;
};

type SeedCommentAttachmentRow = Omit<SeedAttachmentRow, "ticketId"> & {
  commentId: number;
};

/**
 * Deletes every asset the previous seed run left behind in SEED_ATTACHMENTS_FOLDER.
 *
 * A database wipe orphans those assets: the rows are gone, so nothing can ever
 * call destroyAsset on them again. Sweeping by prefix is what keeps a re-seed
 * from leaking assets on every run. Only the seed folder is touched.
 */
const sweepSeedFolder = async (): Promise<void> => {
  try {
    // BOTH resource types are swept, because PDFs are stored as `raw`. Note the
    // option names: `type` is the delivery type and is always "upload";
    // `resource_type` is what makes the SDK request /resources/raw instead of
    // /resources/image. Passing `type: "raw"` builds the nonsense path
    // /resources/image/raw and the admin API rejects it.
    for (const resourceType of ["image", "raw"] as const) {
      const result = await cloudinary.api.delete_resources_by_prefix(
        SEED_ATTACHMENTS_FOLDER,
        { type: "upload", resource_type: resourceType },
      );
      // `deleted` is a map of publicId -> "deleted", not an array.
      const deleted = Object.keys(
        (result?.deleted ?? {}) as Record<string, unknown>,
      ).length;
      console.log(
        `  Folder ${SEED_ATTACHMENTS_FOLDER} (${resourceType}): ${deleted} aset run sebelumnya dihapus.`,
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : JSON.stringify(error).slice(0, 200);
    console.warn(`  ! Gagal membersihkan folder seed di Cloudinary: ${detail}`);
  }
};

/**
 * Uploads every planned attachment and returns rows ready for `createMany`.
 * Returns null when attachments are unavailable, which is not an error: seeding
 * without them still produces a usable database.
 *
 * Both kinds of file — ticket-level and comment-level — go through this one
 * function because they differ only in which table the row lands in. They share
 * the seed folder, so they also share the prefix sweep above.
 */
const uploadPlannedAttachments = async (
  plan: SeedPlan,
  ticketIds: number[],
  commentIds: number[][],
  userIds: string[],
): Promise<{
  ticketRows: SeedAttachmentRow[];
  commentRows: SeedCommentAttachmentRow[];
} | null> => {
  const plannedTickets = plan.tickets.flatMap((ticket, ticketIndex) =>
    ticket.attachments.map((attachment) => ({
      attachment,
      ticketId: ticketIds[ticketIndex],
      uploaderId:
        attachment.uploaderKind === "staff"
          ? userIds[attachment.staffIndex!]
          : userIds[ticket.ownerIndex],
    })),
  );

  const plannedComments = plan.tickets.flatMap((ticket, ticketIndex) =>
    ticket.comments.flatMap((comment, commentIndex) =>
      comment.attachments.map((attachment) => {
        const authorIndex =
          comment.authorKind === "staff" ? comment.staffIndex! : ticket.ownerIndex;
        return {
          attachment,
          commentId: commentIds[ticketIndex]?.[commentIndex],
          // The uploader is always the comment's own author — see
          // PlannedComment.attachments.
          uploaderId: userIds[authorIndex],
        };
      }),
    ),
  );

  if (plannedTickets.length === 0 && plannedComments.length === 0) {
    return { ticketRows: [], commentRows: [] };
  }

  if (!cloudinaryConfigured()) {
    console.warn(
      "  ! Cloudinary tidak dikonfigurasi, lampiran dilewati. Isi CLOUDINARY_* atau set SEED_NO_ATTACHMENTS=1.",
    );
    return null;
  }

  await sweepSeedFolder();

  /**
 * Uploads one buffer and resolves with the persisted row fields.
 *
 * Wrapping the callback API in a Promise is not optional: `upload_stream` is
 * asynchronous, so an earlier version that pushed into a shared array from the
 * callback without awaiting it created zero rows, and a late timeout inside that
 * callback surfaced as an unhandled exception that killed the process after the
 * summary had already printed. `throw` inside a Cloudinary callback reaches
 * nobody; it has to become a rejected promise the caller awaits.
 */
const uploadOne = (
  bytes: Buffer,
  options: Record<string, unknown>,
  attachment: { fileName: string; mimeType: string },
  // `ticketId` or `commentId`, decided by the caller.
  ownerIdField: Record<string, number>,
  uploaderId: string,
  resourceType: string,
): Promise<Omit<SeedAttachmentRow, "ticketId">> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      options,
      (error, response) => {
        if (error || !response) {
          reject(error ?? new Error("Cloudinary returned an empty response"));
          return;
        }
        resolve({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: bytes.length,
          url: response.secure_url,
          publicId: response.public_id,
          resourceType,
          uploadedById: uploaderId,
          ...ownerIdField,
        });
      },
    );
    stream.end(bytes);
  });

  const ticketRows: SeedAttachmentRow[] = [];
  const commentRows: SeedCommentAttachmentRow[] = [];

  // One ordinal across both kinds, so generated PNGs get distinct colours and a
  // comment file is never a byte-identical copy of a ticket file.
  let ordinal = 0;

  for (const { attachment, ticketId, uploaderId } of plannedTickets) {
    const isPdf = attachment.mimeType === "application/pdf";
    const resourceType = isPdf ? "raw" : "image";
    const bytes = bytesFor(attachment.mimeType, attachment.fileName, ordinal++);

    try {
      ticketRows.push(
        (await uploadOne(
          bytes,
          {
            folder: SEED_ATTACHMENTS_FOLDER,
            resource_type: resourceType,
            overwrite: false,
          },
          attachment,
          { ticketId },
          uploaderId,
          resourceType,
        )) as SeedAttachmentRow,
      );
    } catch (error) {
      // Non-fatal on purpose: a seed without attachments is still usable, and a
      // flaky network should not abort the whole reset half way through.
      console.warn(
        `  ! Unggahan ${attachment.fileName} gagal, lampiran dilewati: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  for (const { attachment, commentId, uploaderId } of plannedComments) {
    if (commentId === undefined) {
      // The planner only attaches files to comments that survive into the
      // database, so a missing id means the id map is out of step. Throwing
      // beats silently dropping the file or attaching it to the wrong comment.
      throw new Error(
        `Seed comment attachment ${attachment.fileName} has no comment id`,
      );
    }

    const isPdf = attachment.mimeType === "application/pdf";
    const resourceType = isPdf ? "raw" : "image";
    const bytes = bytesFor(attachment.mimeType, attachment.fileName, ordinal++);

    try {
      commentRows.push(
        (await uploadOne(
          bytes,
          {
            folder: SEED_ATTACHMENTS_FOLDER,
            resource_type: resourceType,
            overwrite: false,
          },
          attachment,
          { commentId },
          uploaderId,
          resourceType,
        )) as SeedCommentAttachmentRow,
      );
    } catch (error) {
      console.warn(
        `  ! Unggahan lampiran komentar ${attachment.fileName} gagal, dilewati: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { ticketRows, commentRows };
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  const attachmentsRequested = attachmentsEnabled;

  const plan = buildSeedPlan({
    seed: process.env.SEED_RANDOM_SEED,
    userCount: intFromEnv("SEED_USERS", DEFAULT_USER_COUNT),
    ticketsPerUser: ticketsPerUserFromEnv(),
    staffCount: intFromEnv("SEED_STAFF", 4),
    attachmentTicketRatio: attachmentsRequested ? undefined : 0,
    commentAttachmentRatio: attachmentsRequested ? undefined : 0,
  });

  console.log("Membersihkan database...");
  // Order matters and is not negotiable: Ticket.userId and
  // TicketAttachment.uploadedById deliberately have no onDelete, so users
  // cannot be deleted while tickets still reference them. Deleting tickets
  // first cascades to attachments and comments, which empties both tables.
  //
  // This bare deleteMany() is the ONE place in the repository where a
  // whole-table delete is the correct thing to do. Never copy the pattern into a
  // verification script -- that mistake wiped the database on 2026-09-29.
  await prisma.ticket.deleteMany();
  await prisma.user.deleteMany();

  console.log("Menyiapkan hash password...");
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  console.log(
    `Menulis ${plan.users.length} user dan ${plan.tickets.length} tiket (seed "${process.env.SEED_RANDOM_SEED ?? "quickticket"}")...`,
  );

  const createdUsers = await prisma.user.createManyAndReturn({
    data: plan.users.map((user) => ({
      email: user.email,
      name: user.name,
      role: user.role,
      password: hashedPassword,
      createdAt: user.createdAt,
    })),
    select: { id: true },
  });
  // Insert order matches VALUES order on Postgres, but sorting the returned ids
  // makes that assumption unnecessary.
  const userIds = createdUsers.map((user) => user.id);

  const createdTickets = await prisma.ticket.createManyAndReturn({
    data: plan.tickets.map((ticket) => ({
      subject: ticket.subject,
      description: ticket.description,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt,
      userId: userIds[ticket.ownerIndex],
      assigneeId:
        ticket.assigneeStaffIndex === null
          ? null
          : userIds[ticket.assigneeStaffIndex],
    })),
    select: { id: true },
  });
  const ticketIds = createdTickets
    .map((ticket) => ticket.id)
    .sort((a, b) => a - b);

  const adminIndex = 0;
  const staffIndexes = plan.users
    .map((user, index) => (user.role === "CLIENT" ? -1 : index))
    .filter((index) => index >= 0);

  const commentRows = plan.tickets.flatMap((ticket, ticketIndex) =>
    ticket.comments.map((comment) => {
      const authorIndex =
        comment.authorKind === "staff" ? comment.staffIndex! : ticket.ownerIndex;

      let removedByIndex: number | null = null;
      if (comment.removedBy === "author") {
        removedByIndex = authorIndex;
      } else if (comment.removedBy) {
        // A moderator must never be the author, or "removed by" would point at
        // the very person whose message disappeared.
        const candidates = staffIndexes.filter((index) => index !== authorIndex);
        const preferred = comment.removedBy === "admin" ? adminIndex : null;
        removedByIndex =
          preferred !== null && candidates.includes(preferred)
            ? preferred
            : candidates[0] ?? adminIndex;
      }

      return {
        body: comment.body,
        createdAt: comment.createdAt,
        ticketId: ticketIds[ticketIndex],
        userId: userIds[authorIndex],
        // Removed a few hours after it was written, never in the future -- a row
        // stamped with its own createdAt would read as "removed the instant it
        // was posted".
        deletedAt:
          removedByIndex === null
            ? null
            : new Date(
                Math.min(
                  comment.createdAt.getTime() + 6 * 60 * 60 * 1000,
                  Date.now(),
                ),
              ),
        deletedById: removedByIndex === null ? null : userIds[removedByIndex],
      };
    }),
  );

  // Comments come back with their ids because comment attachments need a
  // commentId to attach to.
  //
  // The returned rows are matched back to the plan by (ticketId, createdAt)
  // rather than by position. Position would work — Postgres returns VALUES in
  // insert order — but it is an assumption about the driver, and getting it
  // wrong silently attaches a screenshot to the wrong message. The pair is safe
  // to key on because the planner guarantees each thread is strictly ordered by
  // createdAt, so no two comments on a ticket share one.
  let createdComments: { id: number; ticketId: number; createdAt: Date }[] = [];
  if (commentRows.length > 0) {
    createdComments = await prisma.ticketComment.createManyAndReturn({
      data: commentRows,
      select: { id: true, ticketId: true, createdAt: true },
    });
  }

  const idByTicketAndTime = new Map<string, number>();
  for (const comment of createdComments) {
    idByTicketAndTime.set(
      `${comment.ticketId}:${comment.createdAt.getTime()}`,
      comment.id,
    );
  }

  const commentIds: number[][] = plan.tickets.map((ticket, ticketIndex) =>
    ticket.comments.map(
      (comment) =>
        idByTicketAndTime.get(
          `${ticketIds[ticketIndex]}:${comment.createdAt.getTime()}`,
        ) ?? -1,
    ),
  );

  if (attachmentsRequested) {
    console.log(`Mengunggah lampiran ke Cloudinary...`);
    const rows = await uploadPlannedAttachments(
      plan,
      ticketIds,
      commentIds,
      userIds,
    );
    if (rows) {
      if (rows.ticketRows.length > 0) {
        await prisma.ticketAttachment.createMany({ data: rows.ticketRows });
      }
      if (rows.commentRows.length > 0) {
        await prisma.commentAttachment.createMany({ data: rows.commentRows });
      }
    }
  }

  // --- notifications --------------------------------------------------------
  // Recipients and content come from `buildNotificationJobs`, the SAME pure
  // helper the ticket actions use. An earlier draft re-implemented the rules
  // here, which meant the seed could quietly disagree with the app about who
  // gets told — and it did: customer replies were titled "New reply on your
  // ticket", and it keyed NEW_COMMENT on the comment's position instead of its
  // id. Reusing the helper makes both impossible by construction.
  console.log(`Menulis notifikasi...`);

  const staffIds = staffIndexes.map((index) => userIds[index]);
  const adminId = userIds[adminIndex];
  const seededAt = new Date();
  const notificationRows: {
    userId: string;
    type: NotificationType;
    ticketId: number;
    title: string;
    body: string;
    dedupeKey: string;
    createdAt: Date;
    readAt: Date | null;
  }[] = [];

  plan.tickets.forEach((plannedTicket, ticketIndex) => {
    const ticketId = ticketIds[ticketIndex];
    const ownerId = userIds[plannedTicket.ownerIndex];
    const assigneeId =
      plannedTicket.assigneeStaffIndex === null
        ? null
        : userIds[plannedTicket.assigneeStaffIndex];

    const baseContext = {
      ticket: {
        id: ticketId,
        userId: ownerId,
        assigneeId,
        subject: plannedTicket.subject,
      },
      staffIds,
    };

    // TICKET_CREATED is the customer filing their own ticket, so the actor is
    // the owner and every member of staff hears about it.
    const created = plannedTicket.createdAt;
    for (const job of buildNotificationJobs(
      { type: "TICKET_CREATED", ticketId },
      { ...baseContext, actor: { id: ownerId, role: "CLIENT" } },
    )) {
      notificationRows.push({
        ...job,
        createdAt: created,
        readAt: readAtFor(created, seededAt),
      });
    }

    if (assigneeId) {
      const assignedAt = addMinutes(created, 2);
      for (const job of buildNotificationJobs(
        { type: "TICKET_ASSIGNED", ticketId, assigneeId },
        { ...baseContext, actor: { id: adminId, role: "ADMIN" } },
      )) {
        notificationRows.push({
          ...job,
          createdAt: assignedAt,
          readAt: readAtFor(assignedAt, seededAt),
        });
      }
    }

    plannedTicket.comments.forEach((plannedComment, commentIndex) => {
      const authorIndex =
        plannedComment.authorKind === "staff"
          ? plannedComment.staffIndex!
          : plannedTicket.ownerIndex;
      const authorId = userIds[authorIndex];
      const role = plan.users[authorIndex].role;
      const commentId = commentIds[ticketIndex]?.[commentIndex];
      if (commentId === undefined || commentId === -1) return;

      // A soft-deleted comment notifies nobody — the same rule the app applies,
      // which is why `removedBy` is checked before anything is written.
      if (plannedComment.removedBy) return;

      for (const job of buildNotificationJobs(
        { type: "NEW_COMMENT", ticketId, commentId },
        {
          ...baseContext,
          actor: { id: authorId, role },
          commentAuthor: { id: authorId, role },
          commentDeletedAt: null,
        },
      )) {
        notificationRows.push({
          ...job,
          createdAt: plannedComment.createdAt,
          readAt: readAtFor(plannedComment.createdAt, seededAt),
        });
      }
    });
  });

  if (notificationRows.length > 0) {
    // `skipDuplicates` is load-bearing here, not defensive: the unique index on
    // (userId, type, ticketId, dedupeKey) is what makes a QStash retry a no-op,
    // and the seed asserts on the same constraint.
    const { count } = await prisma.notification.createMany({
      data: notificationRows,
      skipDuplicates: true,
    });
    console.log(
      `  ${notificationRows.length} notifikasi direncanakan, ${count} ditulis.`,
    );
  }

  // --- report ---------------------------------------------------------------
  const [
    totalUsers,
    totalTickets,
    totalComments,
    totalAttachments,
    totalCommentAttachments,
    totalNotifications,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.ticket.count(),
    prisma.ticketComment.count(),
    prisma.ticketAttachment.count(),
    prisma.commentAttachment.count(),
    prisma.notification.count(),
  ]);

  /**
 * Renders `groupBy` rows as `key=count`.
   *
   * The count lives in the row's `_count`, never in the key. An earlier version
   * tallied the group keys themselves, which produced a reassuring but entirely
   * fictional "ADMIN=1 SUPPORT_AGENT=1 CLIENT=1" for a 30-user database.
   */
const tallyGroups = <T extends { _count: number }>(
    rows: readonly T[],
    key: (row: T) => string,
  ): string =>
    rows
      .map((row) => `${key(row)}=${row._count}`)
      .sort()
      .join("  ");

  const byStatus = await prisma.ticket.groupBy({ by: ["status"], _count: true });
  const byPriority = await prisma.ticket.groupBy({ by: ["priority"], _count: true });
  const byRole = await prisma.user.groupBy({ by: ["role"], _count: true });
  const assigned = await prisma.ticket.count({
    where: { assigneeId: { not: null } },
  });
  const removed = await prisma.ticketComment.count({
    where: { deletedAt: { not: null } },
  });

  const times = plan.tickets.map((ticket) => ticket.createdAt.getTime());
  const spanDays =
    times.length > 0
      ? ((Math.max(...times) - Math.min(...times)) / 86_400_000).toFixed(1)
      : "0";

  console.log("\nSeeding selesai!");
  console.log(`- User        : ${totalUsers}`);
  console.log(`- Tiket       : ${totalTickets}`);
  console.log(`- Komentar    : ${totalComments}  (${removed} sudah dihapus)`);
  console.log(`- Lampiran    : ${totalAttachments} tiket, ${totalCommentAttachments} komentar`);
  console.log(`- Notifikasi  : ${totalNotifications}`);
  console.log(`- Ter-assign  : ${assigned}`);
  console.log(`- Peran       : ${tallyGroups(byRole, (row) => row.role)}`);
  console.log(`- Status      : ${tallyGroups(byStatus, (row) => row.status)}`);
  console.log(`- Prioritas   : ${tallyGroups(byPriority, (row) => row.priority)}`);
  console.log(`- Rentang hari: ${spanDays}`);
  console.log(`- Durasi      : ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`\nLogin: user1 (ADMIN), user2..${intFromEnv("SEED_STAFF", 4)} (SUPPORT_AGENT), sisanya CLIENT -- password "${SEED_PASSWORD}"`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Error saat seeding:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
