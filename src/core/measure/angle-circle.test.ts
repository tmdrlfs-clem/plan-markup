import { describe, expect, it } from "vitest";

import { factorForRatio, measureLength } from "@/core/calibration/calibration";
import { markupSchema } from "@/core/schema/markup";

import { angleCaption, angleDegrees, bisector, formatAngle } from "./angle";
import { POINTS_IN_A_LINE, circleCaption, circleThrough, radiusMm } from "./circle";
import { SCALE_NOT_SET } from "./length";

const k100 = factorForRatio(100);
const cal = { xFactor: k100, yFactor: k100, unit: "mm" as const, precision: "0" as const };
const o = { x: 0, y: 0 };
// The fixture rectangle (snap.pdf): 200 × 150 pt.
const A = { x: 100, y: 100 };
const B = { x: 300, y: 100 };
const C = { x: 300, y: 250 };

describe("angleDegrees (Story 4.9)", () => {
  it("measures right, acute, obtuse, straight and zero angles, either order", () => {
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: 0, y: 10 })).toBeCloseTo(90, 9);
    expect(angleDegrees({ x: 0, y: 10 }, o, { x: 10, y: 0 })).toBeCloseTo(90, 9);
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: 10, y: 10 })).toBeCloseTo(45, 9);
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: -10, y: 10 })).toBeCloseTo(135, 9);
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: -5, y: 0 })).toBeCloseTo(180, 9);
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: 5, y: 0 })).toBe(0);
    expect(angleDegrees(A, B, C)).toBeCloseTo(90, 9);
  });

  it("has no value when a leg has no length", () => {
    expect(angleDegrees(o, o, { x: 1, y: 0 })).toBeNull();
    expect(angleCaption([o, o, { x: 1, y: 0 }], null)).toEqual({ text: "0.0°", scaled: true });
  });

  it("is measured in real space: X ≠ Y factors change it, equal factors do not", () => {
    // 45° on paper; Y twice as long in reality: atan(2) = 63.43°.
    const xy = { xFactor: factorForRatio(50), yFactor: factorForRatio(100) };
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: 10, y: 10 }, xy)).toBeCloseTo((Math.atan(2) * 180) / Math.PI, 9);
    expect(angleDegrees({ x: 10, y: 0 }, o, { x: 10, y: 10 }, cal)).toBeCloseTo(45, 9);
  });

  it("formats one decimal; the caption needs no scale", () => {
    expect(formatAngle(90)).toBe("90.0°");
    expect(formatAngle(37.46)).toBe("37.5°");
    expect(angleCaption([A, B, C], null)).toEqual({ text: "90.0°", scaled: true });
  });

  it("bisects the angle on paper; opposite legs: perpendicular to the first", () => {
    const b = bisector({ x: 10, y: 0 }, o, { x: 0, y: 10 });
    expect(b.x).toBeCloseTo(Math.SQRT1_2, 9);
    expect(b.y).toBeCloseTo(Math.SQRT1_2, 9);
    expect(bisector({ x: 10, y: 0 }, o, { x: -10, y: 0 })).toEqual({ x: -0, y: 1 });
    expect(bisector(o, o, o)).toEqual({ x: 0, y: 1 });
  });
});

describe("circleThrough / radius / diameter (Story 4.9)", () => {
  it("finds the circle through three points: three corners of a rectangle give its diagonal", () => {
    const c = circleThrough(A, B, C)!;
    expect(c.centre.x).toBeCloseTo(200, 9);
    expect(c.centre.y).toBeCloseTo(175, 9);
    expect(c.radius).toBeCloseTo(125, 9);
    // Far from the origin, still exact.
    const far = circleThrough({ x: 1e6 + 10, y: 1e6 }, { x: 1e6, y: 1e6 + 10 }, { x: 1e6 - 10, y: 1e6 })!;
    expect(far.radius).toBeCloseTo(10, 6);
  });

  it("refuses points in a line and repeated points", () => {
    expect(circleThrough(o, { x: 10, y: 0 }, { x: 20, y: 0 })).toBeNull();
    expect(circleThrough(o, o, { x: 20, y: 0 })).toBeNull();
    expect(circleThrough(o, o, o)).toBeNull();
    expect(circleCaption("radius", [o, { x: 10, y: 0 }, { x: 20, y: 0 }], cal)).toEqual({ text: POINTS_IN_A_LINE, scaled: false });
  });

  it("reads R 4410 mm and Ø 8819 mm for the fixture's corners at 1:100; Scale not set without a calibration", () => {
    expect(radiusMm([A, B, C], cal)).toBeCloseTo(measureLength(125, 0, cal), 6);
    expect(circleCaption("radius", [A, B, C], cal)).toEqual({ text: "R 4410 mm", scaled: true });
    expect(circleCaption("diameter", [A, B, C], cal)).toEqual({ text: "Ø 8819 mm", scaled: true });
    expect(circleCaption("diameter", [A, B, C], null)).toEqual({ text: SCALE_NOT_SET, scaled: false });
  });

  it("applies the UserUnit and measures to the first point under X ≠ Y factors", () => {
    expect(radiusMm([A, B, C], cal, 2)).toBeCloseTo(2 * radiusMm([A, B, C], cal)!, 6);
    const xy = { xFactor: factorForRatio(100), yFactor: factorForRatio(50) };
    // Centre (200, 175); the first point (100, 100): dx -100, dy -75.
    expect(radiusMm([A, B, C], xy)).toBeCloseTo(measureLength(-100, -75, xy), 6);
  });
});

describe("angle, radius and diameter markups in the schema (Story 4.9)", () => {
  const base = { id: "0190a8a0-0000-7000-8000-000000000000", pageId: "x:0", createdAt: "2026-11-01T00:00:00Z", style: { color: "#ff0000", width: 1, fontSize: 10 } };
  it("take exactly three points", () => {
    for (const type of ["angle", "radius", "diameter"]) {
      expect(markupSchema.safeParse({ ...base, type, points: [A, B, C] }).success).toBe(true);
      expect(markupSchema.safeParse({ ...base, type, points: [A, B] }).success).toBe(false);
      expect(markupSchema.safeParse({ ...base, type, points: [A, B, C, A] }).success).toBe(false);
      expect(markupSchema.safeParse({ ...base, type, points: [A, B, C], captionOffset: { x: 1, y: 2 } }).success).toBe(true);
    }
  });
});
