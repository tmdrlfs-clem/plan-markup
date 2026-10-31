// Angle measurements (Story 4.9, FR26). Framework-free.
//
// An angle is three points in PDF user space: the start of the first leg, the
// vertex, the end of the second leg (Revu's order). It is measured in real
// space: each leg is scaled by the page calibration's X / Y factors first (as
// core/calibration measureLength), so with equal factors or no calibration it
// is the angle on paper. UserUnit scales both axes alike and changes nothing.

import type { Calibration } from "@/core/calibration/calibration";

type Point = { x: number; y: number };

/** The angle at `vertex` between the legs to `a` and `b`, in degrees, 0–180; null when a leg has no length. */
export function angleDegrees(a: Point, vertex: Point, b: Point, calibration: Pick<Calibration, "xFactor" | "yFactor"> | null = null): number | null {
  const kx = calibration?.xFactor ?? 1;
  const ky = calibration?.yFactor ?? 1;
  const ux = (a.x - vertex.x) * kx;
  const uy = (a.y - vertex.y) * ky;
  const vx = (b.x - vertex.x) * kx;
  const vy = (b.y - vertex.y) * ky;
  if ((ux === 0 && uy === 0) || (vx === 0 && vy === 0)) return null;
  // atan2 of the cross and dot products: exact near 0° and 180°, where acos is not.
  return Math.abs((Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI);
}

/** Founder default D1: degrees with one decimal. */
export function formatAngle(degrees: number): string {
  return `${degrees.toFixed(1)}°`;
}

/** An angle's caption ("90.0°"); an angle needs no scale (D4), so it is always "scaled". */
export function angleCaption(points: readonly Point[], calibration: Pick<Calibration, "xFactor" | "yFactor"> | null): { text: string; scaled: boolean } {
  const deg = points.length >= 3 ? angleDegrees(points[0], points[1], points[2], calibration) : null;
  return { text: formatAngle(deg ?? 0), scaled: true };
}

/**
 * The unit direction (user space) halving the angle at `vertex` on paper: where its caption
 * sits. Opposite legs (180°) or a missing leg: perpendicular to the first leg, or straight up.
 */
export function bisector(a: Point, vertex: Point, b: Point): Point {
  const unit = (p: Point): Point | null => {
    const d = Math.hypot(p.x - vertex.x, p.y - vertex.y);
    return d > 0 ? { x: (p.x - vertex.x) / d, y: (p.y - vertex.y) / d } : null;
  };
  const u = unit(a);
  const v = unit(b);
  if (!u || !v) return u ?? v ?? { x: 0, y: 1 };
  const s = { x: u.x + v.x, y: u.y + v.y };
  const d = Math.hypot(s.x, s.y);
  return d > 1e-9 ? { x: s.x / d, y: s.y / d } : { x: -u.y, y: u.x };
}
