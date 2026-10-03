import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@/lib/prisma";
import {
  buildSeedPlan,
  DEFAULT_TICKETS_PER_USER,
  DEFAULT_USER_COUNT,
  type SeedPlan,
} from "@/prisma/seed-data";
import { bytesFor } from "@/prisma/seed-files";
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

/**
 * Uploads every planned attachment and returns rows ready for `createMany`.
 * Returns null when attachments are unavailable, which is not an error: seeding
 * without them still produces a usable database.
 */
const uploadPlannedAttachments = async (
  plan: SeedPlan,
  ticketIds: number[],
  userIds: string[],
): Promise<SeedAttachmentRow[] | null> => {
  const planned = plan.tickets.flatMap((ticket, ticketIndex) =>
    ticket.attachments.map((attachment) => ({
      attachment,
      ticketId: ticketIds[ticketIndex],
      uploaderId:
        attachment.uploaderKind === "staff"
          ? userIds[attachment.staffIndex!]
          : userIds[ticket.ownerIndex],
    })),
  );
  if (planned.length === 0) return [];

  if (!cloudinaryConfigured()) {
    console.warn(
      "  ! Cloudinary tidak dikonfigurasi, lampiran dilewati. Isi CLOUDINARY_* atau set SEED_NO_ATTACHMENTS=1.",
    );
    return null;
  }

  try {
    // Previous runs uploaded real assets that the database wipe is about to make
    // unreachable: the rows are gone, so nothing can ever call destroyAsset on
    // them again. Clearing the folder by prefix is what keeps a re-seed from
    // leaking assets on every run. Only the seed folder is touched.
    //
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
  ticketId: number,
  uploaderId: string,
  resourceType: string,
): Promise<SeedAttachmentRow> =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, response) => {
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
        ticketId,
        uploadedById: uploaderId,
      });
    });
    stream.end(bytes);
  });

const rows: SeedAttachmentRow[] = [];

  let ordinal = 0;
  for (const { attachment, ticketId, uploaderId } of planned) {
    const isPdf = attachment.mimeType === "application/pdf";
    const resourceType = isPdf ? "raw" : "image";
    const bytes = bytesFor(attachment.mimeType, attachment.fileName, ordinal++);

    try {
      rows.push(
        await uploadOne(
          bytes,
          {
            folder: SEED_ATTACHMENTS_FOLDER,
            resource_type: resourceType,
            overwrite: false,
          },
          attachment,
          ticketId,
          uploaderId,
          resourceType,
        ),
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

  return rows;
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

  if (commentRows.length > 0) {
    await prisma.ticketComment.createMany({ data: commentRows });
  }

  if (attachmentsRequested) {
    console.log(`Mengunggah lampiran ke Cloudinary...`);
    const rows = await uploadPlannedAttachments(plan, ticketIds, userIds);
    if (rows && rows.length > 0) {
      await prisma.ticketAttachment.createMany({ data: rows });
    }
  }

  // --- report ---------------------------------------------------------------
  const [totalUsers, totalTickets, totalComments, totalAttachments] =
    await Promise.all([
      prisma.user.count(),
      prisma.ticket.count(),
      prisma.ticketComment.count(),
      prisma.ticketAttachment.count(),
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
  console.log(`- Lampiran    : ${totalAttachments}`);
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
