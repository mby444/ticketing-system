/**
 * Stub for the `cloudinary` SDK, aliased in vitest.config.ts.
 *
 * lib/cloudinary.ts exports genuinely useful pure logic (validateAttachmentFile
 * and the size/count constants) but importing it drags in the real SDK, which
 * took the suite from ~1.7s to ~35s. Only the SDK is replaced here — the
 * module's own code, including the validation under test, still runs for real.
 */
export const v2 = {
  config: () => undefined,
  url: () => "https://example.invalid/thumbnail",
  uploader: {
    upload_stream: () => ({ end: () => undefined }),
    destroy: async () => ({}),
  },
};

export type UploadApiResponse = {
  secure_url: string;
  public_id: string;
};
