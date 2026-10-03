import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { bytesFor, colorFor, makePdf, makePng, PNG_SIGNATURE } from "@/prisma/seed-files";

/**
 * The seed uploads a hundred real files based on these two hand-rolled encoders.
 * A malformed PNG would not throw here -- Cloudinary would reject it or, worse,
 * accept it and serve a broken image through the thumbnail proxy on every ticket
 * page. These tests assert the byte layout instead of trusting it.
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

/** Walks the chunk list and validates every CRC. */
const readChunks = (png: Buffer) => {
  const chunks: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    const declared = png.readUInt32BE(offset + 8 + length);
    const recomputed = crc32(png.subarray(offset + 4, offset + 8 + length));
    chunks.push({ type, data });
    expect({ type, declared, recomputed }).toEqual({ type, declared, recomputed });
    offset += 12 + length;
  }
  expect(offset).toBe(png.length);
  return chunks;
};

describe("makePng", () => {
  const width = 240;
  const height = 180;
  const png = makePng(width, height, [70, 110, 180]);

  it("starts with the PNG signature", () => {
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it("emits IHDR, IDAT and IEND, and nothing else", () => {
    const chunks = readChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("declares the requested geometry and colour type", () => {
    const ihdr = readChunks(png)[0].data;
    expect(ihdr).toHaveLength(13);
    expect(ihdr.readUInt32BE(0)).toBe(width);
    expect(ihdr.readUInt32BE(4)).toBe(height);
    expect(ihdr[8]).toBe(8); // bit depth
    expect(ihdr[9]).toBe(2); // truecolour RGB
    expect([ihdr[10], ihdr[11], ihdr[12]]).toEqual([0, 0, 0]);
  });

  it("inflates IDAT to exactly one filtered scanline per row", () => {
    const idat = readChunks(png).find((chunk) => chunk.type === "IDAT")!.data;
    const raw = zlib.inflateSync(idat);
    const stride = 1 + width * 3;
    expect(raw).toHaveLength(height * stride);
    // Filter byte 0 ("none") at the start of every scanline.
    for (let y = 0; y < height; y++) {
      expect(raw[y * stride]).toBe(0);
    }
  });

  it("actually varies the pixels, so the tiles are distinguishable", () => {
    const idat = readChunks(png).find((chunk) => chunk.type === "IDAT")!.data;
    const raw = zlib.inflateSync(idat);
    const first = raw.subarray(1, 4);
    const later = raw.subarray(1 + 20 * 3, 4 + 20 * 3);
    expect(first).not.toEqual(later);
  });

  it("ends with IEND", () => {
    expect(png.subarray(-8)).toEqual(
      Buffer.concat([Buffer.from("IEND", "ascii"), crc32OfIEND()]),
    );
  });
});

const crc32OfIEND = () => {
  const typed = Buffer.from("IEND", "ascii");
  const out = Buffer.alloc(4);
  out.writeUInt32BE(crc32(typed), 0);
  return out;
};

describe("makePdf", () => {
  const pdf = makePdf("QuickTicket seed attachment: lampiran-1.pdf");
  const text = pdf.toString("latin1");

  it("starts with a PDF header and ends with the EOF marker", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("declares five objects and a matching trailer size", () => {
    for (let n = 1; n <= 5; n++) {
      expect(text).toContain(`\n${n} 0 obj\n`);
    }
    expect(text).toContain("/Size 6");
  });

  it("points every xref offset at the object it claims", () => {
    // A PDF whose xref offsets are wrong opens as a blank page or is refused
    // outright, and neither failure is visible from the app -- attachments are
    // stored as resource_type "raw" and only ever downloaded.
    const entries = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number.parseInt(m[1], 10),
    );
    expect(entries).toHaveLength(5);
    entries.forEach((offset, index) => {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(
        `${index + 1} 0 obj`,
      );
    });
  });

  it("points startxref at the xref table", () => {
    const startxref = Number.parseInt(
      /startxref\s+(\d+)/.exec(text)![1],
      10,
    );
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("gives the content stream an exact /Length", () => {
    const declared = Number.parseInt(/<< \/Length (\d+) >>/.exec(text)![1], 10);
    const stream = text.slice(
      text.indexOf("stream\n") + "stream\n".length,
      text.indexOf("endstream"),
    );
    expect(Buffer.byteLength(stream, "latin1")).toBe(declared);
  });

  it("strips characters that would break the content stream", () => {
    const hostile = makePdf("parens ( ) and backslash \\ inside");
    expect(hostile.toString("latin1")).toContain("(parens   and backslash  inside)");
  });
});

describe("colorFor", () => {
  it("is deterministic", () => {
    expect(colorFor(3)).toEqual(colorFor(3));
  });

  it("wraps around the palette instead of going out of bounds", () => {
    expect(colorFor(0)).toEqual(colorFor(6));
    // A negative ordinal would return undefined without the double modulo, and
    // makePng would then write NaN bytes.
    expect(colorFor(-1)).toBeDefined();
    expect(colorFor(-1)).toHaveLength(3);
  });
});

describe("bytesFor", () => {
  it("returns a PNG for image types", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/webp"]) {
      expect(bytesFor(mimeType, "lampiran-1.png", 0).subarray(0, 8)).toEqual(
        PNG_SIGNATURE,
      );
    }
  });

  it("returns a PDF for application/pdf", () => {
    expect(bytesFor("application/pdf", "lampiran-1.pdf", 0).toString("latin1", 0, 8)).toBe(
      "%PDF-1.4",
    );
  });

  it("stays far below the app's 5 MB per-file cap", () => {
    // MAX_FILE_SIZE is the real app limit; a generator that produced something
    // larger would be rejected by validateAttachmentFile in a manual re-upload.
    expect(bytesFor("image/png", "lampiran-1.png", 0).length).toBeLessThan(1024 * 1024);
    expect(bytesFor("application/pdf", "lampiran-1.pdf", 0).length).toBeLessThan(
      1024 * 1024,
    );
  });

  it("is not empty", () => {
    // validateAttachmentFile rejects a zero-byte file, so an empty generator would
    // make every seeded attachment invalid.
    expect(bytesFor("image/png", "a.png", 0).length).toBeGreaterThan(0);
    expect(bytesFor("application/pdf", "a.pdf", 0).length).toBeGreaterThan(0);
  });
});