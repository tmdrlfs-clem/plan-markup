import { describe, expect, it } from "vitest";

import { canonicalSheet, ratioOnSheet } from "@/core/scale/sheet";

import {
  MM_PER_POINT,
  calibrationLabel,
  calibrationSchema,
  calibrationsFor,
  factorForRatio,
  factorFromPoints,
  mixedSizes,
  pageIdOf,
  ratioForPage,
  realLengthMm,
  roundRatioOf,
  type Calibration,
} from "./calibration";
import { parsePageRange, parseRatioInput } from "./range";
import { formatCursorReal, formatReal, parseDistance, precisionsFor } from "./units";

const MM = 72 / 25.4;
const A1 = { width: 841 * MM, height: 594 * MM };
const A3 = { width: 420 * MM, height: 297 * MM };
const cal = (over: Partial<Calibration> = {}): Calibration => ({
  xFactor: factorForRatio(100),
  yFactor: factorForRatio(100),
  unit: "mm",
  precision: "0",
  source: "ratio",
  ratio: 100,
  ...over,
});

describe("calibration model", () => {
  it("a ratio is real mm per point; 1:100 makes 72 pt (1 in of paper) 2540 mm", () => {
    expect(factorForRatio(100)).toBeCloseTo(100 * MM_PER_POINT, 12);
    expect(realLengthMm(72, 0, cal())).toBeCloseTo(2540, 9);
    expect(realLengthMm(30, 40, cal())).toBeCloseTo(50 * 100 * MM_PER_POINT, 9);
  });

  it("a ratio stated for another sheet converts per page (4.2), a bare one does not", () => {
    expect(ratioForPage(100, "A1", A3)).toBeCloseTo(200, 9);
    expect(ratioForPage(100, "A1", A1)).toBe(100);
    expect(ratioForPage(100, null, A3)).toBe(100);
    expect(ratioOnSheet(75, "A1", "A3")).toBeCloseTo(150, 9);
    expect(ratioOnSheet(75, "A1", "A1")).toBe(75);
  });

  it("two points: the factor is real over page distance; zero is refused", () => {
    expect(factorFromPoints(144, 5000)).toBeCloseTo(5000 / 144, 12);
    expect(() => factorFromPoints(0, 10)).toThrow(RangeError);
    expect(() => factorFromPoints(10, 0)).toThrow(RangeError);
  });

  it("round ratios are recognised within 0.5 %", () => {
    expect(roundRatioOf(factorForRatio(100))).toBe(100);
    expect(roundRatioOf(factorForRatio(100.3))).toBe(100);
    expect(roundRatioOf(factorForRatio(101.4))).toBeNull();
    expect(roundRatioOf(factorForRatio(103))).toBeNull();
    expect(roundRatioOf(factorForRatio(95.8))).toBe(96);
    expect(roundRatioOf(factorForRatio(0.4))).toBeNull();
  });

  it("labels: Scale 1:100, Calibrated (not round), both X and Y when they differ", () => {
    expect(calibrationLabel(cal())).toMatchObject({ label: "Scale 1:100" });
    expect(calibrationLabel(cal({ source: "points", xFactor: 3, yFactor: 3 }))).toEqual({
      label: "Calibrated",
      tooltip: "Calibrated from two points: 1 pt = 3 mm",
    });
    expect(calibrationLabel(cal({ yFactor: factorForRatio(50), yRatio: 50 }))).toMatchObject({ label: "Scale 1:100 / 1:50", tooltip: "Calibrated from a ratio: X 1:100, Y 1:50" });
    expect(calibrationLabel(cal({ source: "points", yFactor: 3 })).label).toBe("Calibrated (X ≠ Y)");
    // A typed ratio shows as typed, round or not.
    expect(calibrationLabel(cal({ xFactor: factorForRatio(33.3), yFactor: factorForRatio(33.3) })).label).toBe("Scale 1:33.3");
  });

  it("the schema accepts a calibration and refuses broken ones", () => {
    expect(calibrationSchema.parse(cal({ sheet: "A1" }))).toEqual(cal({ sheet: "A1" }));
    expect(calibrationSchema.safeParse(cal({ xFactor: 0 })).success).toBe(false);
    expect(calibrationSchema.safeParse({ ...cal(), unit: "yd" }).success).toBe(false);
    expect(calibrationSchema.safeParse(cal({ xFactor: Number.POSITIVE_INFINITY })).success).toBe(false);
  });

  it("page ids are the document hash and the page index", () => {
    expect(pageIdOf("abc", 3)).toBe("abc:3");
  });
});

describe("typed distances (mm, m, in, ft, ft-in)", () => {
  it.each([
    ["1905", "mm", 1905],
    ["4.6", "m", 4600],
    ["4600 mm", "m", 4600],
    ["12", "in", 304.8],
    ["12", "ft", 3657.6],
    [`12'-6"`, "ft-in", 12 * 304.8 + 6 * 25.4],
    [`12'6`, "ft-in", 12 * 304.8 + 6 * 25.4],
    ["12-6", "ft-in", 12 * 304.8 + 6 * 25.4],
    [`6 1/2"`, "ft-in", 6.5 * 25.4],
    [`12'-6"`, "mm", 12 * 304.8 + 6 * 25.4],
    ["1.5 m", "ft-in", 1500],
  ])("%j in %s", (text, unit, mm) => {
    expect(parseDistance(text, unit as never)).toEqual({ ok: true, mm: expect.closeTo(mm, 9) });
  });

  it.each(["", "abc", "0", "-5", "0 mm", "6 1/2"])("refuses %j", (text) => {
    expect(parseDistance(text, "mm").ok).toBe(false);
  });
});

describe("shown lengths", () => {
  it("metric with decimals", () => {
    expect(formatReal(1905.4, "mm", "0")).toBe("1905 mm");
    expect(formatReal(1905.46, "mm", "0.0")).toBe("1905.5 mm");
    expect(formatReal(4600, "m", "0.00")).toBe("4.60 m");
  });
  it("inches and feet-inches with fractions or decimals", () => {
    expect(formatReal(12.5 * 25.4, "in", "1/8")).toBe('12 1/2"');
    expect(formatReal(0.0625 * 25.4, "in", "1/16")).toBe('1/16"');
    expect(formatReal(12.25 * 25.4, "in", "0.0")).toBe('12.3"');
    expect(formatReal(150.5 * 25.4, "ft-in", "1/8")).toBe(`12'-6 1/2"`);
    expect(formatReal(150 * 25.4, "ft-in", "1/16")).toBe(`12'-6"`);
    expect(formatReal(143.97 * 25.4, "ft-in", "1/8")).toBe(`12'-0"`); // rounds up into the next foot
    expect(formatReal(150.5 * 25.4, "ft-in", "0.0")).toBe(`12'-6.5"`);
    expect(formatReal(0, "ft-in", "1/8")).toBe(`0'-0"`);
  });
  it("fractions only for inch units", () => {
    expect(precisionsFor("mm")).toEqual(["0", "0.0", "0.00"]);
    expect(precisionsFor("ft-in")).toContain("1/16");
  });
  it("the cursor readout in real units, X and Y with their own factors", () => {
    expect(formatCursorReal({ x: 72, y: 36 }, cal({ precision: "0.0" }))).toBe("X 2540.0  Y 1270.0 mm");
    expect(formatCursorReal({ x: 72, y: 72 }, cal({ unit: "m", precision: "0.00", yFactor: factorForRatio(50) }))).toBe("X 2.54  Y 1.27 m");
    expect(formatCursorReal({ x: 72, y: 72 }, cal({ unit: "ft-in", precision: "1/8" }))).toBe(`X 8'-4"  Y 8'-4"`);
    expect(formatCursorReal({ x: 72, y: 72 }, cal({ unit: "in", precision: "0" }))).toBe("X 100  Y 100 in");
    expect(formatCursorReal(null, cal())).toBe("");
  });
});

describe("page ranges and typed ratios", () => {
  it("parses ranges into 0-based pages, in order, once", () => {
    expect(parsePageRange("1-3, 5", 6)).toEqual({ ok: true, pages: [0, 1, 2, 4] });
    expect(parsePageRange("5; 2-3, 3", 6)).toEqual({ ok: true, pages: [1, 2, 4] });
    expect(parsePageRange("4-", 6)).toEqual({ ok: true, pages: [3, 4, 5] });
    expect(parsePageRange("-2", 6)).toEqual({ ok: true, pages: [0, 1] });
  });
  it.each([
    ["", "Enter pages"],
    ["7", "6 pages"],
    ["3-1", "backwards"],
    ["a", "not a page"],
    ["0", "6 pages"],
  ])("refuses %j", (text, message) => {
    const r = parsePageRange(text, 6);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(message);
  });
  it("parses ratios with an optional sheet", () => {
    expect(parseRatioInput("100", canonicalSheet)).toEqual({ ok: true, value: { ratio: 100, sheet: null } });
    expect(parseRatioInput("1:100 @ A1", canonicalSheet)).toEqual({ ok: true, value: { ratio: 100, sheet: "A1" } });
    expect(parseRatioInput("1 : 50 at a3", canonicalSheet)).toEqual({ ok: true, value: { ratio: 50, sheet: "A3" } });
    expect(parseRatioInput("1/200 ANSI D", canonicalSheet)).toEqual({ ok: true, value: { ratio: 200, sheet: "ANSI D" } });
    expect(parseRatioInput("1:33.3", canonicalSheet)).toEqual({ ok: true, value: { ratio: 33.3, sheet: null } });
    expect(parseRatioInput("1:100 @ Z9", canonicalSheet).ok).toBe(false);
    expect(parseRatioInput("1:0", canonicalSheet).ok).toBe(false);
    expect(parseRatioInput("scale", canonicalSheet).ok).toBe(false);
  });
});

describe("calibrations for a range", () => {
  const pages = [
    { index: 0, size: A1 },
    { index: 1, size: A3 },
  ];
  const display = { unit: "mm" as const, precision: "0" as const };
  it("a ratio stated for a sheet converts per page; a bare ratio stays a ratio", () => {
    const m = calibrationsFor({ kind: "ratio", ratio: 100, sheet: "A1" }, pages, display);
    expect(m.get(0)!.xFactor).toBeCloseTo(factorForRatio(100), 9);
    expect(m.get(1)!.xFactor).toBeCloseTo(factorForRatio(200), 9);
    expect(m.get(1)).toMatchObject({ source: "ratio", ratio: 100, sheet: "A1", unit: "mm", precision: "0" });
    const bare = calibrationsFor({ kind: "detected", ratio: 50, sheet: null }, pages, display);
    expect(bare.get(1)!.xFactor).toBeCloseTo(factorForRatio(50), 9);
    expect(bare.get(1)!.source).toBe("detected");
  });
  it("two points apply the same factor to every page; a vertical ratio sets Y", () => {
    const m = calibrationsFor({ kind: "points", factor: 3, yRatio: 50 }, pages, display);
    expect(m.get(0)).toMatchObject({ xFactor: 3, source: "points", yRatio: 50 });
    expect(m.get(1)!.xFactor).toBe(3);
    expect(m.get(1)!.yFactor).toBeCloseTo(factorForRatio(50), 9);
    expect(m.get(1)!.ratio).toBeUndefined();
  });
  it("mixed sizes: either orientation of one sheet is the same size", () => {
    expect(mixedSizes([A1, { width: A1.height, height: A1.width }])).toBe(false);
    expect(mixedSizes([A1, A3])).toBe(true);
    expect(mixedSizes([A1])).toBe(false);
  });
});
