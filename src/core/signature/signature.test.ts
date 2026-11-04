import { describe, expect, it } from "vitest";

import { SIGNATURE_MAX_BYTES, checkSignaturePng, signatureCaption } from "./signature";

/** A PNG header (signature + IHDR) declaring `w` x `h`, padded to `size` bytes. */
function png(w: number, h: number, size = 64): Uint8Array {
  const b = new Uint8Array(Math.max(size, 33));
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}

describe("signature images (Story 5.13)", () => {
  it("takes a PNG of at most 512 KB and 1200 px a side", () => {
    expect(checkSignaturePng(png(600, 200))).toEqual({ ok: true, width: 600, height: 200 });
    expect(checkSignaturePng(new Uint8Array())).toMatchObject({ ok: false });
    expect(checkSignaturePng(png(600, 200, SIGNATURE_MAX_BYTES + 1))).toEqual({ ok: false, reason: "The signature is larger than 512 KB." });
    expect(checkSignaturePng(png(1201, 200))).toEqual({ ok: false, reason: "The signature is larger than 1200 px a side." });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(checkSignaturePng(jpeg)).toEqual({ ok: false, reason: "The signature must be a PNG image." });
    expect(checkSignaturePng(new TextEncoder().encode("<svg onload=alert(1)>"))).toEqual({ ok: false, reason: "The signature must be a PNG image." });
  });

  it("a stamp's caption is the name and the local date", () => {
    expect(signatureCaption("  Seung Gil ", new Date(2026, 10, 5, 23, 59))).toBe("Seung Gil · 2026-11-05");
    expect(signatureCaption("", new Date(2026, 0, 2))).toBe("Signed · 2026-01-02");
  });
});
