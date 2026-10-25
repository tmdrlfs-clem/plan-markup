import { describe, expect, it } from "vitest";

import { MM_PER_POINT, calibrationsFor, factorForRatio, factorFromPoints, measureLength, sideways } from "./calibration";
import { precisionStepMm, roundToPrecision } from "./units";
import { formatPercent, formatSigned, verifyCalibration } from "./verify";

const at = (ratio: number, unit: "mm" | "m" | "in" | "ft-in" = "mm", precision: "0" | "0.0" | "0.00" | "1/8" | "1/16" = "0") => ({
  xFactor: factorForRatio(ratio),
  yFactor: factorForRatio(ratio),
  unit,
  precision,
});

describe("verifyCalibration (Story 4.4)", () => {
  it("measures the picked line at the calibration's unit and precision; no known length: no verdict", () => {
    const r = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100), null);
    expect(r.measuredMm).toBeCloseTo(200 * 100 * MM_PER_POINT, 9);
    expect(r).toMatchObject({ measuredText: "7056 mm", knownMm: null, differenceText: null, percent: null, matches: null });
  });

  it("matches when the shown values are equal; otherwise the signed difference of the shown values and the percentage", () => {
    const same = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100), 7056);
    expect(same).toMatchObject({ matches: true, knownText: "7056 mm", differenceMm: 0, differenceText: "0 mm" });
    // The percentage is of the unrounded measurement (7055.6 mm).
    expect(formatPercent(same.percent!)).toBe("-0.01 %");
    const off = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100), 7000);
    expect(off).toMatchObject({ matches: false, knownText: "7000 mm", differenceText: "+56 mm" });
    expect(off.differenceMm).toBeCloseTo(56, 9);
    expect(formatPercent(off.percent!)).toBe("+0.79 %");
    const short = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100), 7100);
    expect(short.differenceText).toBe("-44 mm");
    expect(formatPercent(short.percent!)).toBe("-0.63 %");
  });

  it("separate X and Y factors apply along the line (measureLength)", () => {
    const c = { xFactor: factorForRatio(100), yFactor: factorForRatio(50), unit: "mm" as const, precision: "0.0" as const };
    const mm = Math.hypot(30 * factorForRatio(100), 40 * factorForRatio(50));
    expect(measureLength(30, 40, c)).toBeCloseTo(mm, 9);
    expect(verifyCalibration({ dxPt: 30, dyPt: 40 }, c, null).measuredText).toBe(`${mm.toFixed(1)} mm`);
  });

  it("a two-point calibration verified on the same two points gives the typed distance exactly (NFR8)", () => {
    for (const [pt, known] of [
      [72, 1905],
      [123.456, 4321.5],
      [17.3, 12 * 304.8 + 6 * 25.4],
    ] as const) {
      const f = factorFromPoints(pt, known);
      const r = verifyCalibration({ dxPt: pt * 0.6, dyPt: pt * 0.8 }, { xFactor: f, yFactor: f, unit: "mm", precision: "0.0" }, known);
      expect(r.matches).toBe(true);
      expect(Math.abs(r.percent!)).toBeLessThan(1e-9);
    }
  });

  it("compares at the precision: half a step rounds like the formatter", () => {
    const c = { xFactor: 1, yFactor: 1, unit: "mm" as const, precision: "0" as const };
    expect(verifyCalibration({ dxPt: 1904.5, dyPt: 0 }, c, 1905).matches).toBe(true);
    const below = verifyCalibration({ dxPt: 1904.49, dyPt: 0 }, c, 1905);
    expect(below).toMatchObject({ matches: false, measuredText: "1904 mm", differenceText: "-1 mm" });
  });

  it("metres, inches and feet-inches with fractions", () => {
    const m = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100, "m", "0.00"), 7000);
    expect(m).toMatchObject({ measuredText: "7.06 m", knownText: "7.00 m", differenceText: "+0.06 m" });
    // 200 pt at 1:100 is 277.78" = 23'-1 3/4" (to 1/8").
    const ftin = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100, "ft-in", "1/8"), (23 * 12 + 1.75) * 25.4);
    expect(ftin).toMatchObject({ measuredText: `23'-1 3/4"`, matches: true });
    const ftinOff = verifyCalibration({ dxPt: 200, dyPt: 0 }, at(100, "ft-in", "1/8"), (23 * 12 + 1.5) * 25.4);
    expect(ftinOff).toMatchObject({ matches: false, differenceText: `+0'-1/4"` });
    const inches = verifyCalibration({ dxPt: 72, dyPt: 0 }, at(1, "in", "1/16"), 25.4 * 1.0625);
    expect(inches).toMatchObject({ measuredText: `1"`, knownText: `1 1/16"`, differenceText: `-1/16"` });
  });

  it("review V4: on a /Rotate 90 page with a separate vertical scale, a line along user space x reads at the vertical scale", () => {
    const m = calibrationsFor({ kind: "ratio", ratio: 100, sheet: null, yRatio: 50 }, [{ index: 0, size: { width: 842, height: 595, rotate: 90 } }], { unit: "mm", precision: "0" });
    const c = m.get(0)!;
    // 72 pt along user x is the page's vertical as it reads: 1:50, 1270 mm.
    expect(verifyCalibration({ dxPt: 72, dyPt: 0 }, c, 1270)).toMatchObject({ measuredText: "1270 mm", matches: true });
    expect(verifyCalibration({ dxPt: 0, dyPt: 72 }, c, null).measuredText).toBe("2540 mm");
  });

  it("precision steps, rounding and signs", () => {
    expect(precisionStepMm("mm", "0.0")).toBeCloseTo(0.1, 12);
    expect(precisionStepMm("m", "0.00")).toBeCloseTo(10, 12);
    expect(precisionStepMm("in", "1/8")).toBeCloseTo(25.4 / 8, 12);
    expect(precisionStepMm("ft-in", "0")).toBeCloseTo(25.4, 12);
    expect(roundToPrecision(1904.6, "mm", "0")).toBe(1905);
    expect(formatSigned(0.2, "mm", "0")).toBe("0 mm");
    expect(formatSigned(-12, "mm", "0")).toBe("-12 mm");
    expect(formatSigned(50, "m", "0.00")).toBe("+0.05 m");
    // Review V3: a difference under 0.005 % never reads as none.
    expect(formatPercent(-0.001)).toBe("-<0.01 %");
    expect(formatPercent(0.004)).toBe("+<0.01 %");
    expect(formatPercent(0)).toBe("0.00 %");
    expect(sideways(-90)).toBe(true);
  });
});
