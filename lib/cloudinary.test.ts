import { describe, expect, it } from "vitest";
import { makeFile } from "@/test-utils/factories";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILES,
  MAX_FILE_SIZE,
  validateAttachmentFile,
} from "@/lib/cloudinary";

/**
 * Pure server-side validation. No SDK calls involved — importing this module
 * does configure nothing, because the Cloudinary config is lazy.
 *
 * These constants are duplicated in the client forms on purpose (the SDK must
 * never enter the browser bundle), so the client copy can drift; these tests
 * pin the server-side truth.
 */

describe("validateAttachmentFile", () => {
  it("accepts every allowed MIME type", () => {
    // Length asserted so this cannot pass vacuously if the list is emptied.
    expect(ALLOWED_MIME_TYPES.length).toBe(4);

    for (const type of ALLOWED_MIME_TYPES) {
      const extension = type.split("/")[1];
      expect(
        validateAttachmentFile(makeFile(`file.${extension}`, type, 1024)),
      ).toBeNull();
    }
  });

  it("rejects a disallowed MIME type", () => {
    const res = validateAttachmentFile(makeFile("notes.txt", "text/plain", 100));
    expect(res).toContain("Unsupported file type");
    expect(res).toContain("notes.txt");
  });

  it("rejects an empty file", () => {
    const res = validateAttachmentFile(makeFile("empty.png", "image/png", 0));
    expect(res).toContain("Empty file");
  });

  it("rejects a file over the size limit", () => {
    const res = validateAttachmentFile(
      makeFile("big.png", "image/png", MAX_FILE_SIZE + 1),
    );
    expect(res).toContain("too large");
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateAttachmentFile(makeFile("edge.png", "image/png", MAX_FILE_SIZE))).toBeNull();
  });

  it("keeps MAX_FILES at the documented value", () => {
    // The form copy and the 30MB bodySizeLimit in next.config.ts both assume 5.
    expect(MAX_FILES).toBe(5);
  });
});
