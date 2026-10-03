import type { Role, TicketPriority, TicketStatus } from "@/generated/prisma/client";
import {
  ALLOWED_MIME_TYPES,
  MAX_COMMENT_FILES,
  MAX_FILES,
} from "@/lib/attachment-limits";

/**
 * Pure data planning for `prisma/seed.ts`.
 *
 * IMPORTANT: this module must stay dependency-free — no Prisma, no Next.js, no
 * Cloudinary, and no `Math.random()` for anything that has to be reproducible.
 * It describes *intent* ("this ticket needs two attachments, one of them
 * uploaded by support") and `seed.ts` resolves that intent against the real
 * database and Cloudinary. That split is what lets `seed-data.test.ts` assert
 * the invariants of a whole seed run in milliseconds without touching
 * infrastructure — the same trade-off already made for
 * `lib/dashboard-filters.ts` and `lib/priority.ts`.
 */

// ---------------------------------------------------------------------------
// Attachment bounds
// ---------------------------------------------------------------------------

/**
 * Imported from the dependency-free `lib/attachment-limits` rather than copied.
 * They cannot live in `lib/cloudinary.ts`: this module has to stay importable
 * from a test that runs in about a second, and that module drags in the
 * Cloudinary and Sentry SDKs — importing its constants cost about 12 seconds,
 * which is what prompted the extraction.
 */
export type SeedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** FNV-1a, so the seed can be a readable string such as "quickticket". */
const hashSeed = (input: string): number => {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** mulberry32 — a 32-bit PRNG, small and good enough for fixture data. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Rng = {
  /** Float in [0, 1). */
  next: () => number;
  /** Inclusive at both ends. */
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  /** Picks from `[[value, weight], ...]`. Weights need not sum to anything. */
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
  chance: (probability: number) => boolean;
  /** Fisher-Yates. Returns a new array; never mutates the input. */
  shuffle: <T>(items: readonly T[]) => T[];
};

const makeRng = (seed: string): Rng => {
  const next = mulberry32(hashSeed(seed));
  const int = (min: number, max: number) =>
    Math.floor(next() * (max - min + 1)) + min;

  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error("rng.pick on an empty list");
      return items[Math.floor(next() * items.length)];
    },
    weighted: <T>(entries: readonly (readonly [T, number])[]): T => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
    chance: (probability: number) => next() < probability,
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
};

// ---------------------------------------------------------------------------
// Content pools
// ---------------------------------------------------------------------------

/**
 * Subject and description travel together on purpose. The previous seed drew
 * each from an independent list, so it regularly produced things like
 * "Permintaan reset kata sandi" described as "Sistem menampilkan respon error
 * 500" — data that reads as generated nonsense rather than a real report.
 */
const TICKET_TEMPLATES: readonly {
  subject: string;
  description: string;
}[] = [
  {
    subject: "Kesalahan koneksi database saat membuat laporan",
    description:
      "Setiap kali saya membuka modul laporan, halaman gagal dimuat dan muncul pesan ECONNREFUSED. Sudah saya coba refresh beberapa kali dan hasilnya sama. Mohon dicek koneksi ke server basis data.",
  },
  {
    subject: "Unggah lampiran gagal untuk berkas di atas 2 MB",
    description:
      "Lampiran berupa tangkapan layar berukuran sekitar 3 MB selalu gagal diunggah, sementara berkas kecil berhasil normal. Tampaknya ada batas ukuran yang belum terdokumentasi.",
  },
  {
    subject: "Permintaan atur ulang kata sandi",
    description:
      "Saya lupa kata sandi akun saya dan tidak pernah mengaktifkan pemulihan lewat email. Mohon bantuan untuk mengatur ulang kata sandi tersebut.",
  },
  {
    subject: "Integrasi payment gateway gagal memproses transaksi",
    description:
      "Transaksi sudah dipotong dari saldo saya tetapi statusnya tetap tertahan selama lebih dari satu jam. Nomor referensinya 88213. Mohon dicek apakah dana saya sudah masuk.",
  },
  {
    subject: "Ekspor CSV tidak merespons",
    description:
      "Tombol ekspor menampilkan indikator memuat tanpa akhir dan tidak ada berkas yang terunduh. Saya sudah mencoba dengan rentang tanggal yang lebih kecil, hasilnya tetap sama.",
  },
  {
    subject: "Menu navigasi terpotong di layar ponsel",
    description:
      "Di layar berukuran 5 inci, menu utama hanya menampilkan tiga dari tujuh item dan tidak ada cara untuk menggulir melihat sisanya. Beberapa menu jadi tidak bisa diakses.",
  },
  {
    subject: "Dashboard lambat dimuat pada jam sibuk",
    description:
      "Sejak pukul 09.00 halaman dashboard membutuhkan sekitar 20 detik untuk muncul, sedangkan biasanya di bawah dua detik. Mohon ditelusuri penyebabnya.",
  },
  {
    subject: "Email notifikasi tidak pernah masuk",
    description:
      "Saya tidak menerima email pemberitahuan perubahan status tiket sama sekali selama seminggu terakhir. Folder spam juga sudah saya periksa dan tidak ada.",
  },
  {
    subject: "Permintaan akses modul laporan lanjutan",
    description:
      "Saya memerlukan akses ke modul laporan untuk tim saya, namun peran saya saat ini hanya standar. Mohon diberikan akses tingkat tinggi.",
  },
  {
    subject: "Selisih waktu tidak sesuai dengan zona waktu lokal",
    description:
      "Tanggal di footer halaman selalu tertinggal satu hari dari tanggal sebenarnya. Saya berada di zona WIB, namun yang ditampilkan seolah dalam waktu UTC.",
  },
  {
    subject: "Total invoice tidak sama dengan rincian item",
    description:
      "Rincian item berjumlah Rp1.250.000, sementara total yang tercetak Rp1.450.000. Selisihnya konsisten sebesar Rp200.000.",
  },
  {
    subject: "Tidak bisa masuk setelah mengatur ulang kata sandi",
    description:
      "Setelah mengikuti tautan atur ulang, halaman selalu kembali ke layar masuk dan muncul pesan sesi tidak valid. Saya sudah mencoba dengan dua peramban berbeda.",
  },
  {
    subject: "Filter tanggal tidak mengubah hasil",
    description:
      "Memilih rentang tanggal tertentu tidak mengubah hasil yang ditampilkan, seolah filter diabaikan. Saya harus memfilter berkas hasil secara manual.",
  },
  {
    subject: "Pengguna baru tidak menerima email aktivasi",
    description:
      "Kami mendaftarkan lima pengguna baru hari ini dan tidak seorang pun menerima email aktivasi, padahal kelima alamat email tersebut valid.",
  },
  {
    subject: "Permintaan fitur checkout dua langkah",
    description:
      "Untuk mengurangi barang yang dikembalikan, kami ingin proses checkout menambahkan konfirmasi nomor telepon sebelum pembayaran.",
  },
  {
    subject: "Server sering berhenti merespons pada hari Senin",
    description:
      "Setiap Senin pagi sekitar pukul 08.00 layanan tidak merespons selama 10 sampai 15 menit, lalu pulih sendiri tanpa intervensi.",
  },
  {
    subject: "Laporan menampilkan data pengguna lain",
    description:
      "Laporan yang saya unduh memuat nama dan alamat lengkap pengguna yang bukan bagian dari tim saya. Ini termasuk masalah privasi yang serius.",
  },
  {
    subject: "Notifikasi push tidak sampai ke perangkat Android",
    description:
      "Di ponsel Android saya tidak menerima notifikasi sama sekali, sedangkan di iOS rekan saya normal. Aplikasi sudah diperbarui ke versi terbaru.",
  },
  {
    subject: "Permintaan peningkatan batas ukuran unggahan",
    description:
      "Batas 5 MB terlalu kecil untuk kami yang rutin mengunggah hasil pindai dalam format PDF berukuran 8 sampai 12 MB.",
  },
  {
    subject: "Status tiket tidak berubah setelah ditutup agent",
    description:
      "Tiket sudah ditandai selesai oleh agent kemarin, tetapi di halaman saya statusnya masih berjalan sampai hari ini.",
  },
  {
    subject: "Duplikasi data saat impor massal",
    description:
      "Mengimpor 200 baris data membuat sebagian baris tercatat dua kali. Jumlah akhir tidak sesuai dengan jumlah berkas yang saya unggah.",
  },
  {
    subject: "Sesi habis tanpa aktivitas",
    description:
      "Setelah beberapa menit tidak ada aktivitas, halaman memaksa saya masuk kembali meskipun tidak ada proses lain yang berjalan.",
  },
  {
    subject: "Validasi menolak nomor telepon internasional",
    description:
      "Nomor telepon dengan format internasional ditolak oleh validasi, padahal format tersebut valid dan dipakai banyak pengguna di luar negeri.",
  },
  {
    subject: "Grafik penjualan tidak sesuai dengan laporan",
    description:
      "Grafik menunjukkan penurunan penjualan 30 persen, sedangkan laporan dalam bentuk tabel menunjukkan penurunan 8 persen untuk periode yang sama.",
  },
];

const CLIENT_OPENERS: readonly string[] = [
  "Mohon informasi lebih lanjut tentang estimasi penanganannya.",
  "Apakah ada solusi sementara yang bisa saya pakai selagi ini?",
  "Sudah saya coba langkah yang ada di dokumentasi, hasilnya sama saja.",
  "Mohon dipercepat, karena tim saya sedang menunggu.",
  "Apakah tiket ini bisa diprioritaskan? Deadline kami minggu depan.",
  "Berikut detail tambahan dari pengamatan saya, semoga membantu.",
];

const STAFF_REPLIES: readonly string[] = [
  "Terima kasih atas laporannya. Saya sudah menelusuri log server dan menemukan lonjakan koneksi pada jam yang Anda sebutkan.",
  "Saya sudah mereproduksi masalahnya. Penyebabnya adalah cache yang tidak disegarkan setelah perubahan konfigurasi.",
  "Untuk sementara Anda bisa memakai langkah berikut sebagai solusi sementara, sementara perbaikan permanen kami kerjakan.",
  "Perbaikan sudah saya terapkan ke lingkungan produksi. Mohon konfirmasi apakah masalahnya sudah hilang.",
  "Saya memerlukan satu informasi tambahan: kapan terakhir kali masalah ini muncul, dan apakah terjadi setelah pembaruan terakhir?",
  "Saya sudah berkomunikasi dengan tim infrastruktur. Tampaknya masalah ini berkaitan dengan skenario lain yang belum terpetakan.",
  "Mohon maaf atas ketidaknyamanannya. Insiden ini sudah tercatat dan akan kami tinjau sebagai pencegahan.",
  "Penyebabnya sudah teridentifikasi: proses sinkronisasi berjalan dua kali secara bersamaan.",
];

const STAFF_RESOLUTIONS: readonly string[] = [
  "Masalah ini sudah selesai diperbaiki. Perbaikan permanen akan masuk ke rilis berikutnya.",
  "Tiket saya tutup karena pekerjaannya sudah beres. Silakan buka tiket baru bila keluhan serupa muncul kembali.",
  "Perbaikan sudah diterapkan dan sudah saya verifikasi ulang. Saya menutup tiket ini sebagai selesai.",
  "Akar masalah ditemukan dan diperbaiki. Terima kasih atas kesabarannya menunggu.",
];

/**
 * Only formats the seed can actually produce. `prisma/seed-files.ts` generates a
 * real PNG (hand-rolled encoder) and a real PDF; JPEG and WebP would need real
 * encoders, so listing them here would write a `mimeType` that does not match the
 * uploaded bytes. `seed-data.test.ts` asserts every planned MIME type against the
 * generated magic bytes, which is what keeps this list honest.
 */
const IMAGE_KINDS: readonly { mimeType: SeedMimeType; extension: string }[] = [
  { mimeType: "image/png", extension: "png" },
];

// ---------------------------------------------------------------------------
// Status / priority coherence
// ---------------------------------------------------------------------------

type StatusProfile = {
  status: TicketStatus;
  weight: number;
  /** No ticket with this status is older than this. */
  maxAgeDays: number;
  assignedChance: number;
  /** Possible staff-reply counts, chosen uniformly. */
  staffReplies: readonly number[];
  /**
   * `addTicketComment` bumps Open -> In_Progress on a staff reply, so an Open
   * ticket can never hold one through the UI. Seeding it would create a state
   * the application cannot reach.
   */
  allowsStaffReplies: boolean;
  priorities: readonly TicketPriority[];
};

const STATUS_PROFILES: readonly StatusProfile[] = [
  {
    status: "Open",
    weight: 30,
    maxAgeDays: 14,
    assignedChance: 0.3,
    staffReplies: [0],
    allowsStaffReplies: false,
    priorities: ["Medium", "High", "Critical"],
  },
  {
    status: "In_Progress",
    weight: 25,
    maxAgeDays: 90,
    assignedChance: 0.9,
    staffReplies: [1, 2, 3],
    allowsStaffReplies: true,
    priorities: ["Medium", "High", "Critical"],
  },
  {
    status: "Resolved",
    weight: 25,
    maxAgeDays: 180,
    assignedChance: 0.95,
    staffReplies: [1, 2, 3],
    allowsStaffReplies: true,
    priorities: ["Low", "Medium", "High"],
  },
  {
    status: "Closed",
    weight: 20,
    maxAgeDays: 180,
    assignedChance: 0.9,
    staffReplies: [1, 2, 3],
    allowsStaffReplies: true,
    priorities: ["Low", "Medium"],
  },
];

// ---------------------------------------------------------------------------
// Plan shape
// ---------------------------------------------------------------------------

export type PlannedUser = {
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
};

/** Who removed a soft-deleted comment, relative to its author. */
export type RemovedBy = "author" | "staff" | "admin";

export type PlannedComment = {
  body: string;
  /** "client" = the ticket owner; "staff" = an index into the staff list. */
  authorKind: "client" | "staff";
  staffIndex?: number;
  createdAt: Date;
  /** Only set when the row should be seeded already removed. */
  removedBy?: RemovedBy;
  /**
   * Files attached to this comment.
   *
   * The uploader is always the comment's own author — a customer attaching to
   * their message, staff attaching to their reply. That is both what the UI
   * naturally produces and the state `deleteCommentAttachment`'s author-or-staff
   * rule is actually exercised by.
   *
   * Deliberately never planned for a comment that will be seeded already
   * removed: those rows are hidden in the thread, so their files would be
   * unreachable and the feature would look untested.
   */
  attachments: PlannedCommentAttachment[];
};

export type PlannedCommentAttachment = {
  fileName: string;
  mimeType: SeedMimeType;
};

export type PlannedAttachment = {
  fileName: string;
  mimeType: SeedMimeType;
  /**
   * Who uploaded it. This drives the "Support Staff" badge, whose predicate is
   * `uploader !== ticket owner` — not `isStaff(uploader)` — so a staff member
   * uploading onto their *own* ticket is deliberately not badged. `staffIndex`
   * is therefore always a staff member other than the ticket owner, which is
   * what makes the badge visible for the tickets that should show it.
   */
  uploaderKind: "owner" | "staff";
  staffIndex?: number;
};

export type PlannedTicket = {
  templateIndex: number;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Date;
  ownerIndex: number;
  /** Index into the staff list, or null when unassigned. */
  assigneeStaffIndex: number | null;
  comments: PlannedComment[];
  attachments: PlannedAttachment[];
  // Notifications are NOT planned here on purpose. They are derived in seed.ts
  // from tickets and comments by calling `buildNotificationJobs`, the same pure
  // helper the app uses. An earlier draft planned them here and then re-derived
  // recipients in the writer, which meant two implementations of the same rules
  // that could silently disagree.
};

export type SeedPlan = {
  users: PlannedUser[];
  tickets: PlannedTicket[];
  /** How many comments were seeded in the already-removed state. */
  softDeletedComments: number;
};

export type BuildPlanOptions = {
  seed?: string;
  userCount?: number;
  /** Min and max tickets per user, inclusive. */
  ticketsPerUser?: readonly [number, number];
  /** Injectable so tests get a fixed clock. */
  now?: Date;
  /** How many staff agents exist, the ADMIN included. */
  staffCount?: number;
  /** How many comments to seed in the already-removed state. */
  softDeletedComments?: number;
  /** Fraction of tickets that get attachments. */
  attachmentTicketRatio?: number;
  /** Fraction of comments that get attachments. */
  commentAttachmentRatio?: number;
};

export const DEFAULT_USER_COUNT = 30;
export const DEFAULT_TICKETS_PER_USER: readonly [number, number] = [1, 8];
export const DEFAULT_STAFF_COUNT = 4;
export const DEFAULT_SOFT_DELETED_COMMENTS = 3;
export const DEFAULT_ATTACHMENT_TICKET_RATIO = 0.35;
export const DEFAULT_COMMENT_ATTACHMENT_RATIO = 0.3;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Roles: index 0 is the ADMIN, the next `staffCount - 1` are SUPPORT_AGENTs,
 * everyone else is a CLIENT. Only staff may be assignees — `listAgents()`
 * filters on `STAFF_ROLES`, so a CLIENT assignee would be unreachable from the
 * UI.
 */
export const roleForIndex = (index: number, staffCount: number): Role =>
  index === 0 ? "ADMIN" : index < staffCount ? "SUPPORT_AGENT" : "CLIENT";

/** Indices of the users who may be assigned a ticket. */
export const staffIndices = (userCount: number, staffCount: number): number[] =>
  Array.from({ length: Math.min(staffCount, userCount) }, (_, i) => i);

/**
 * Builds the whole dataset in memory. Deterministic for a given `seed`.
 *
 * `now` is a parameter rather than read from the clock so a test can assert on
 * absolute dates; the relative spacing between records is what actually
 * matters.
 */
export const buildSeedPlan = (options: BuildPlanOptions = {}): SeedPlan => {
  const {
    seed = "quickticket",
    userCount = DEFAULT_USER_COUNT,
    ticketsPerUser = DEFAULT_TICKETS_PER_USER,
    now = new Date(),
    staffCount = DEFAULT_STAFF_COUNT,
    softDeletedComments = DEFAULT_SOFT_DELETED_COMMENTS,
    attachmentTicketRatio = DEFAULT_ATTACHMENT_TICKET_RATIO,
    commentAttachmentRatio = DEFAULT_COMMENT_ATTACHMENT_RATIO,
  } = options;

  if (userCount < staffCount) {
    throw new Error(
      `userCount (${userCount}) must be at least staffCount (${staffCount})`,
    );
  }

  const rng = makeRng(seed);
  const staff = staffIndices(userCount, staffCount);

  const users: PlannedUser[] = Array.from(
    { length: userCount },
    (_, index): PlannedUser => {
      // Users predate the tickets they opened, so spread them over a wider,
      // older window than the tickets.
      const createdAt = new Date(
        now.getTime() - rng.int(30, 730) * DAY - rng.int(0, 12 * HOUR),
      );
      return {
        email: `user${index + 1}@example.com`,
        name: `User Ke-${index + 1}`,
        role: roleForIndex(index, staffCount),
        createdAt,
      };
    },
  );

  const tickets: PlannedTicket[] = [];
  const removalCandidates: { ticketIndex: number; commentIndex: number }[] = [];
  // One counter for BOTH kinds of file, so a comment attachment can never
  // collide with a ticket attachment's name. The seed-data test asserts
  // global uniqueness.
  let attachmentCounter = 0;

  for (let ownerIndex = 0; ownerIndex < userCount; ownerIndex++) {
    const ticketCount = rng.int(ticketsPerUser[0], ticketsPerUser[1]);

    for (let n = 0; n < ticketCount; n++) {
      const profile = rng.weighted(
        STATUS_PROFILES.map((p) => [p, p.weight] as const),
      );

      const templateIndex = rng.int(0, TICKET_TEMPLATES.length - 1);
      const template = TICKET_TEMPLATES[templateIndex];

      // A ticket cannot predate the user who opened it. Clamping keeps the
      // invariant that `users` are spread over a wider, older window than
      // `tickets`, and it can never push a date into the future because every
      // user is at least 30 days old.
      const earliestTicket = users[ownerIndex].createdAt.getTime() + DAY;
      const desired = now.getTime() -
        rng.int(1, profile.maxAgeDays) * DAY -
        rng.int(0, DAY - 1);
      const createdAt = new Date(Math.max(desired, earliestTicket));

      // --- comments -------------------------------------------------------
      // Layout first, then anchor. Picking increasing random fractions and
      // mapping them onto [createdAt + HOUR, now - MINUTE] guarantees three
      // properties at once: every comment is after its ticket, the thread is
      // strictly ordered (the UI orders by createdAt then id), and nothing is
      // dated in the future. Laying the thread out forwards from the ticket and
      // clamping would instead flatten several comments onto the same instant
      // whenever a young ticket overflows the available window.
      const openers = [rng.pick(CLIENT_OPENERS)];
      const staffReplies =
        profile.allowsStaffReplies && rng.chance(0.85)
          ? Array.from({ length: rng.pick(profile.staffReplies) }, () =>
              rng.pick(STAFF_REPLIES),
            )
          : [];

      const bodies = [...openers, ...staffReplies];

      // Resolved and Closed threads end on a resolution line, which is what a
      // real ticket looks like once it reaches those states.
      if (profile.status === "Resolved" || profile.status === "Closed") {
        bodies[bodies.length - 1] = rng.pick(STAFF_RESOLUTIONS);
      }

      const windowStart = createdAt.getTime() + HOUR;
      const windowEnd = now.getTime() - MINUTE;
      const fractions = bodies
        .map(() => rng.next())
        .sort((a, b) => a - b);
      const span = Math.max(0, windowEnd - windowStart);

      const comments: PlannedComment[] = bodies.map((body, index) => {
        const authorKind: "client" | "staff" = index === 0 ? "client" : "staff";

        // Comment attachments. Sampled per comment rather than per thread: the
        // budget is per comment in the app too (MAX_COMMENT_FILES), so a long
        // thread does not run out. Shares `attachmentCounter` with the ticket
        // files below for globally unique names.
        const attachments: PlannedCommentAttachment[] = [];
        if (commentAttachmentRatio > 0 && rng.chance(commentAttachmentRatio)) {
          const count = rng.int(1, Math.min(2, MAX_COMMENT_FILES));
          for (let c = 0; c < count; c++) {
            attachmentCounter++;
            const kind = rng.chance(0.25)
              ? { mimeType: "application/pdf" as const, extension: "pdf" }
              : rng.pick(IMAGE_KINDS);
            attachments.push({
              fileName: `lampiran-${attachmentCounter}.${kind.extension}`,
              mimeType: kind.mimeType,
            });
          }
        }

        return {
          body,
          authorKind,
          staffIndex: authorKind === "staff" ? rng.pick(staff) : undefined,
          createdAt: new Date(windowStart + fractions[index] * span),
          attachments,
        };
      });

      // --- attachments ------------------------------------------------------
      const attachments: PlannedAttachment[] = [];
      if (rng.chance(attachmentTicketRatio)) {
        // Staff uploaders exclude the owner: see PlannedAttachment.
        const staffExceptOwner = staff.filter((i) => i !== ownerIndex);
        const count = rng.int(1, Math.min(3, MAX_FILES));
        for (let a = 0; a < count; a++) {
          attachmentCounter++;
          const kind = rng.chance(0.25)
            ? { mimeType: "application/pdf" as const, extension: "pdf" }
            : rng.pick(IMAGE_KINDS);
          const byStaff = rng.chance(0.3) && staffExceptOwner.length > 0;
          attachments.push({
            fileName: `lampiran-${attachmentCounter}.${kind.extension}`,
            mimeType: kind.mimeType,
            uploaderKind: byStaff ? "staff" : "owner",
            staffIndex: byStaff ? rng.pick(staffExceptOwner) : undefined,
          });
        }
      }

      const ticketIndex = tickets.length;

      const assigneeStaffIndex = rng.chance(profile.assignedChance)
        ? rng.pick(staff)
        : null;

      tickets.push({
        templateIndex,
        subject: template.subject,
        description: template.description,
        priority: rng.pick(profile.priorities),
        status: profile.status,
        createdAt,
        ownerIndex,
        assigneeStaffIndex,
        comments,
        attachments,
      });

      // Every comment is a candidate for the already-removed state, including
      // the opening one: a customer retracting a message posted by mistake is a
      // realistic reason for a removed row, and it exercises the self-retract
      // attribution path that staff moderation never produces.
      comments.forEach((_, commentIndex) => {
        removalCandidates.push({ ticketIndex, commentIndex });
      });
    }
  }

  // --- choose which comments land already removed ----------------------------
  // The three modes are drawn from deliberately different pools rather than
  // sampled, because each demonstrates a different attribution path in the
  // thread:
  //   author  -> a customer retracted their own message
  //   staff   -> support moderated a customer message
  //   admin   -> one staff account moderated another staff reply
  // Sampling the mode would let "author" land on a staff comment, where it is
  // indistinguishable from the other two.
  const clientPool = rng.shuffle(
    removalCandidates.filter((candidate) => candidate.commentIndex === 0),
  );
  const staffPool = rng.shuffle(
    removalCandidates.filter((candidate) => candidate.commentIndex > 0),
  );
  const used = new Set<string>();
  let budget = softDeletedComments;

  const takeFrom = (pool: typeof clientPool, mode: RemovedBy) => {
    if (budget <= 0) return;
    const candidate = pool.find((entry) => {
      const key = `${entry.ticketIndex}:${entry.commentIndex}`;
      return !used.has(key);
    });
    if (!candidate) return;
    used.add(`${candidate.ticketIndex}:${candidate.commentIndex}`);
    const comment = tickets[candidate.ticketIndex].comments[candidate.commentIndex];
    comment.removedBy = mode;
    // A removed comment hides its files in the thread (a soft delete retracts the
    // whole message, screenshots included), and deleteCommentAttachment refuses
    // to touch them. Seeding one would produce rows nothing can reach, so the
    // removal is also the point at which any planned files are dropped. This
    // runs after every candidate is known, so a comment chosen for removal never
    // keeps its attachments regardless of which path selected it.
    comment.attachments = [];
    budget--;
  };

  takeFrom(clientPool, "author");
  takeFrom(clientPool, "staff");
  takeFrom(staffPool, "admin");
  // Any additional removals come from the client pool so the rows stay distinct.
  while (budget > 0) takeFrom(clientPool, "staff");

  return {
    users,
    tickets,
    softDeletedComments: tickets.reduce(
      (sum, ticket) =>
        sum + ticket.comments.filter((c) => c.removedBy).length,
      0,
    ),
  };
};