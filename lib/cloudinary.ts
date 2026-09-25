import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { logEvent } from "@/utils/sentry";

/**
 * Server-side Cloudinary helpers for ticket attachments.
 *
 * IMPORTANT: this module pulls in the Cloudinary SDK — never import it from a
 * `"use client"` component. Client-side pre-checks must duplicate the small
 * constants below (see app/tickets/new/ticket-form.tsx).
 */

/** MIME types accepted for attachments (mirrored in ticket-form.tsx). */
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

/** Max 5 MB per file. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Max attachments per ticket (bounds the request body to ~30MB, see next.config.ts). */
export const MAX_FILES = 5;

/** Cloudinary Media Library folder for all ticket attachments. */
export const ATTACHMENTS_FOLDER = "quickticket/tickets";

/** Metadata persisted as a TicketAttachment row after a successful upload. */
export type AttachmentUpload = {
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  publicId: string;
  resourceType: string;
};

let configured = false;

const ensureConfigured = () => {
  if (configured) return;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured (missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)",
    );
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  configured = true;
};

/**
 * Pure server-side validation. Returns an error message describing the
 * problem, or null when the file is acceptable.
 */
export const validateAttachmentFile = (file: File): string | null => {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `Unsupported file type for "${file.name}" — allowed: JPG, PNG, WebP, PDF`;
  }
  if (file.size === 0) {
    return `Empty file "${file.name}"`;
  }
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `File "${file.name}" is too large (${mb} MB) — max 5 MB per file`;
  }
  return null;
};

/**
 * Uploads a single File to Cloudinary through the Node.js SDK (signed
 * server-side upload — the API secret never leaves the server).
 * Images go up as resource_type "image", PDFs as "raw".
 */
export const uploadAttachment = async (file: File): Promise<AttachmentUpload> => {
  ensureConfigured();
  const buffer = Buffer.from(await file.arrayBuffer());
  const resourceType = file.type === "application/pdf" ? "raw" : "image";

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: ATTACHMENTS_FOLDER, resource_type: resourceType },
      (error, res) => {
        if (error || !res) {
          reject(error ?? new Error("Cloudinary returned an empty response"));
          return;
        }
        resolve(res);
      },
    );
    stream.end(buffer);
  });

  return {
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    url: result.secure_url,
    publicId: result.public_id,
    resourceType,
  };
};

/**
 * Best-effort cleanup of an already-uploaded asset (rollback paths).
 * Never throws — failures are reported to Sentry instead.
 */
export const destroyAsset = async (
  publicId: string,
  resourceType: string,
): Promise<void> => {
  try {
    ensureConfigured();
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    logEvent(
      "Failed to destroy Cloudinary asset",
      "ticket",
      { publicId },
      "error",
      error,
    );
  }
};

/** Cloudinary transformation URL for image thumbnails (not valid for raw/PDF). */
export const getThumbnailUrl = (attachment: {
  publicId: string;
  resourceType: string;
  url: string;
}): string => {
  try {
    // Rendering a detail page may happen without any prior upload in this
    // process, so the lazy config must run here too.
    ensureConfigured();
    // Note: no `format: "auto"` — the SDK renders it as a `.auto` extension
    // which 404s on this asset; the /_next/image proxy already negotiates
    // modern formats (webp/avif) on its side.
    return cloudinary.url(attachment.publicId, {
      resource_type: attachment.resourceType as "image" | "raw",
      width: 240,
      height: 240,
      crop: "fill",
      quality: "auto",
      secure: true,
    });
  } catch (error) {
    // Never 500 the page over a thumbnail — fall back to the original file.
    logEvent(
      "Cloudinary thumbnail unavailable; serving original URL",
      "ticket",
      { publicId: attachment.publicId },
      "warning",
      error,
    );
    return attachment.url;
  }
};
