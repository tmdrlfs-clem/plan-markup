import { describe, expect, it } from "vitest";
import { MM_PER_INCH, PT_PER_INCH, mmToPt, ptToMm } from "./units";

describe("units", () => {
  it("converts 72 pt to 25.4 mm", () => {
    expect(ptToMm(PT_PER_INCH)).toBeCloseTo(MM_PER_INCH, 12);
    expect(mmToPt(MM_PER_INCH)).toBeCloseTo(PT_PER_INCH, 12);
  });

  it("round-trips within 1e-9", () => {
    for (const pt of [0.5, 1, 595.276, 841.89, 12345.678]) {
      expect(Math.abs(mmToPt(ptToMm(pt)) - pt)).toBeLessThan(1e-9);
    }
  });

  it("maps 0 to 0", () => {
    expect(ptToMm(0)).toBe(0);
    expect(mmToPt(0)).toBe(0);
  });

  it("allows negative values", () => {
    expect(ptToMm(-72)).toBeCloseTo(-25.4, 12);
    expect(mmToPt(-25.4)).toBeCloseTo(-72, 12);
  });
});
