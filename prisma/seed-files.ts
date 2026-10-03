import zlib from "node:zlib";

/**
 * File generators for seeded attachments.
 *
 * The seed uploads real bytes on purpose: a fake publicId would leave every
 * thumbnail broken on the ticket page, and the "Support Staff" uploader badge is
 * far easier to trust when the file behind it actually opens.
 *
 * Only PNG and PDF are generated. JPEG and WebP would need real encoders and add
 * nothing here -- both go through the same thumbnail path.
 *
 * Kept separate from `seed.ts` because that file runs `main()` on import, which
 * makes it unusable from a test. `seed-files.test.ts` asserts the byte layout
 * of both formats.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
};

/** The eight bytes every PNG starts with. */
export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** A real, valid PNG: signature + IHDR + deflated IDAT + IEND. */
export const makePng = (
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  // bytes 10-12 stay 0: deflate compression, adaptive filtering, no interlace.

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      // A coarse checkerboard, so the tiles are visually distinguishable.
      const shade = ((x >> 4) + (y >> 4)) % 2 === 0 ? 0 : 70;
      const offset = rowStart + 1 + x * 3;
      raw[offset] = (rgb[0] + shade) % 256;
      raw[offset + 1] = (rgb[1] + shade) % 256;
      raw[offset + 2] = (rgb[2] + shade) % 256;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

/** A real, minimal one-page PDF with a correct cross-reference table. */
export const makePdf = (title: string): Buffer => {
  const content = `BT /F1 18 Tf 60 780 Td (${title.replace(/[()\\]/g, "")}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [];
  let position = chunks[0].length;

  objects.forEach((body, index) => {
    const text = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(position);
    chunks.push(text);
    position += text.length;
  });

  const xrefStart = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(chunks.join("") + xref, "latin1");
};

/** Deterministic, pleasant colour for a given attachment ordinal. */
export const colorFor = (ordinal: number): readonly [number, number, number] => {
  const palette: readonly (readonly [number, number, number])[] = [
    [70, 110, 180],
    [190, 90, 70],
    [80, 160, 110],
    [160, 120, 190],
    [200, 160, 60],
    [70, 160, 170],
  ];
  return palette[((ordinal % palette.length) + palette.length) % palette.length];
};

/**
 * Bytes for a planned attachment. PDFs are `resource_type: raw` upstream, so
 * only their stored bytes matter; images must be genuinely decodable because
 * they are served back through the /_next/image thumbnail proxy.
 */
export const bytesFor = (
  mimeType: string,
  fileName: string,
  ordinal: number,
): Buffer =>
  mimeType === "application/pdf"
    ? makePdf(`QuickTicket seed attachment: ${fileName}`)
    : makePng(240, 180, colorFor(ordinal));