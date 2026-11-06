import { describe, expect, it } from "vitest";

import { imageMatches } from "./tool-sets";

describe("tool images (Story 7.2)", () => {
  it("must start like the type they claim", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(imageMatches(png, "image/png")).toBe(true);
    expect(imageMatches(jpeg, "image/jpeg")).toBe(true);
    expect(imageMatches(png, "image/jpeg")).toBe(false);
    expect(imageMatches(jpeg, "image/png")).toBe(false);
    expect(imageMatches(new TextEncoder().encode("<svg onload=x>"), "image/png")).toBe(false);
  });
});
