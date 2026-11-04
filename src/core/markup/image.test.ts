import { describe, expect, it } from "vitest";

import { IMAGE_MAX_BYTES, IMAGE_MAX_PIXELS, fitSize, imageRefusal, sniffImage } from "./image";

/** A PNG header declaring `width` × `height` (signature and IHDR; no pixel data needed). */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** A JPEG header: SOI, an APP0 segment, then SOF0 declaring `width` × `height`. */
function jpegHeader(width: number, height: number, sof = 0xc0): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46,
    0xff, sof, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0, 0, 0,
  ]);
}

describe("sniffImage (Story 5.8)", () => {
  it("reads a PNG's and a JPEG's declared size", () => {
    expect(sniffImage(pngHeader(640, 480))).toEqual({ kind: "png", width: 640, height: 480 });
    expect(sniffImage(jpegHeader(1024, 768))).toEqual({ kind: "jpeg", width: 1024, height: 768 });
    // A progressive JPEG (SOF2).
    expect(sniffImage(jpegHeader(30, 20, 0xc2))).toEqual({ kind: "jpeg", width: 30, height: 20 });
  });

  it("refuses anything else: SVG, GIF, a PNG without IHDR, no size, a JPEG with no frame", () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a\x01\x00\x01\x00"))).toBeNull();
    const noIhdr = pngHeader(1, 1);
    noIhdr[12] = 0x41;
    expect(sniffImage(noIhdr)).toBeNull();
    expect(sniffImage(pngHeader(0, 10))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("imageRefusal", () => {
  it("refuses a file too large, not an image, or declaring too many pixels", () => {
    expect(imageRefusal(1000, { kind: "png", width: 10, height: 10 })).toBeNull();
    expect(imageRefusal(IMAGE_MAX_BYTES + 1, { kind: "png", width: 10, height: 10 })).toMatch(/larger than 10 MB/);
    expect(imageRefusal(1000, null)).toMatch(/Only PNG and JPEG/);
    expect(imageRefusal(1000, { kind: "png", width: 10_000, height: IMAGE_MAX_PIXELS / 10_000 + 1 })).toMatch(/too many pixels/);
  });
});

describe("fitSize", () => {
  it("scales down to fit, never up, keeping the aspect", () => {
    expect(fitSize(400, 200, 100, 100)).toEqual({ width: 100, height: 50 });
    expect(fitSize(40, 20, 100, 100)).toEqual({ width: 40, height: 20 });
    expect(fitSize(100, 400, 100, 100)).toEqual({ width: 25, height: 100 });
  });
});
