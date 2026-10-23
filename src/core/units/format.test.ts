import { describe, expect, it } from "vitest";

import { DEFAULT_LENGTH_UNIT, formatCursor, formatNumber, fromPoints } from "./format";

describe("units", () => {
  it("converts points to mm, in and pt; millimetres by default", () => {
    expect(fromPoints(72, "in")).toBe(1);
    expect(fromPoints(72, "mm")).toBeCloseTo(25.4, 9);
    expect(fromPoints(5, "pt")).toBe(5);
    expect(DEFAULT_LENGTH_UNIT).toBe("mm");
  });

  it("formats numbers with fixed decimals and never '-0'", () => {
    expect(formatNumber(1234.56, 1)).toBe("1234.6");
    expect(formatNumber(-0.04, 1)).toBe("0.0");
    expect(formatNumber(-1.25, 2)).toBe("-1.25");
  });
});

describe("formatCursor", () => {
  it("shows PDF points with one decimal, two spaces between the axes", () => {
    expect(formatCursor({ x: 1234.54, y: 678.91 })).toBe("X 1234.5  Y 678.9 pt");
    expect(formatCursor({ x: 0, y: 0 })).toBe("X 0.0  Y 0.0 pt");
  });

  it("is empty without a point (off the page, no drawing)", () => {
    expect(formatCursor(null)).toBe("");
    expect(formatCursor({ x: Number.NaN, y: 1 })).toBe("");
  });

  it("is ready for a calibrated scale (Epic 4): unit and real length per point", () => {
    // 1:100 in mm: one point on paper is 25.4 / 72 * 100 mm in reality.
    expect(formatCursor({ x: 72, y: 144 }, { unit: "mm", perPoint: (25.4 / 72) * 100, digits: 0 })).toBe("X 2540  Y 5080 mm");
  });
});
