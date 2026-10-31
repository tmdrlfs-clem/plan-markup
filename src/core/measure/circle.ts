// Radius and diameter measurements (Story 4.9, FR26, NFR8). Framework-free.
//
// A radius or diameter is three points on a circle in PDF user space (the
// snapping finds points on a drawn circle or arc; there is no centre snap).
// The circle is their circumcircle; its real radius is the length from the
// centre to the first point under the page calibration (measureLength: X / Y
// factors, UserUnit). With X ≠ Y factors a paper circle is an ellipse in
// reality: the first point, the one chosen first, decides.

import { measureLength, type Calibration } from "@/core/calibration/calibration";
import { formatMeasured } from "@/core/calibration/units";

import { SCALE_NOT_SET } from "./length";

type Point = { x: number; y: number };

/** What the live value says while three points lie in a line (no circle). */
export const POINTS_IN_A_LINE = "Points in a line";

/** Relative tolerance below which three points count as collinear. */
const EPS = 1e-9;

/** The circle through `a`, `b`, `c` (user space), or null when they are in a line or repeated. */
export function circleThrough(a: Point, b: Point, c: Point): { centre: Point; radius: number } | null {
  // Relative to a, for precision far from the origin.
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  const scale = Math.max(bx * bx + by * by, cx * cx + cy * cy);
  if (!(scale > 0) || Math.abs(d) <= EPS * scale) return null;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { centre: { x: a.x + ux, y: a.y + uy }, radius: Math.hypot(ux, uy) };
}

/** The real radius in mm of the circle through the three points (to the first); null without a calibration or a circle. */
export function radiusMm(points: readonly Point[], calibration: Pick<Calibration, "xFactor" | "yFactor"> | null, userUnit = 1): number | null {
  if (!calibration || points.length < 3) return null;
  const circle = circleThrough(points[0], points[1], points[2]);
  if (!circle) return null;
  const u = userUnit > 0 ? userUnit : 1;
  return measureLength((points[0].x - circle.centre.x) * u, (points[0].y - circle.centre.y) * u, calibration);
}

/**
 * A radius's or diameter's caption: "R 4410 mm" / "Ø 8819 mm" (founder default D3) in the
 * calibration's unit and precision; "Scale not set" without one; "Points in a line" without a circle.
 */
export function circleCaption(
  kind: "radius" | "diameter",
  points: readonly Point[],
  calibration: Calibration | null,
  userUnit = 1,
): { text: string; scaled: boolean } {
  if (points.length >= 3 && !circleThrough(points[0], points[1], points[2])) return { text: POINTS_IN_A_LINE, scaled: false };
  const r = radiusMm(points, calibration, userUnit);
  if (r === null || !calibration) return { text: SCALE_NOT_SET, scaled: false };
  const value = kind === "radius" ? r : 2 * r;
  return { text: `${kind === "radius" ? "R" : "Ø"} ${formatMeasured(value, calibration.unit, calibration.precision)}`, scaled: true };
}
