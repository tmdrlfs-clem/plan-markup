// Length measurements (Story 4.5, FR26, NFR8). Framework-free.
//
// A measurement's points are in PDF user space (its page's own box, before
// UserUnit); its real length comes from the page's calibration through
// core/calibration measureLength (separate X / Y factors along user space
// axes), so it agrees exactly with Verify (4.4) for the same two points.

import { measureLength, type Calibration } from "@/core/calibration/calibration";
import { formatMeasured } from "@/core/calibration/units";

type Point = { x: number; y: number };

/** What a page without a calibration shows instead of a number (UX-DR15). */
export const SCALE_NOT_SET = "Scale not set";

/** The polyline's length on paper in points (UserUnit applied). */
export function paperLengthPt(points: readonly Point[], userUnit = 1): number {
  const u = userUnit > 0 ? userUnit : 1;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot((points[i].x - points[i - 1].x) * u, (points[i].y - points[i - 1].y) * u);
  return total;
}

/**
 * The real length in millimetres of the polyline through `points` (user
 * space) on a page with `userUnit`, segment by segment under `calibration`;
 * null without a calibration (never an unscaled number).
 */
export function lengthMm(points: readonly Point[], calibration: Pick<Calibration, "xFactor" | "yFactor"> | null, userUnit = 1): number | null {
  if (!calibration) return null;
  const u = userUnit > 0 ? userUnit : 1;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += measureLength((points[i].x - points[i - 1].x) * u, (points[i].y - points[i - 1].y) * u, calibration);
  }
  return total;
}

/** The caption of a length: its value in the calibration's unit and precision, or "Scale not set". */
export function lengthCaption(points: readonly Point[], calibration: Calibration | null, userUnit = 1): { text: string; scaled: boolean } {
  const mm = lengthMm(points, calibration, userUnit);
  if (mm === null || !calibration) return { text: SCALE_NOT_SET, scaled: false };
  return { text: formatMeasured(mm, calibration.unit, calibration.precision), scaled: true };
}

/**
 * Where a two-point caption goes, in screen (device) space: centred on the
 * line, `gap` px off it on the side above (screen up), turned along the line
 * but never upside down. `a`, `b` are the line's ends on screen.
 */
export function captionPlacement(a: Point, b: Point, gap: number): { x: number; y: number; angle: number } {
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  // Keep the text readable: within [-90°, 90°) (a vertical line reads upwards, like drawing dimensions).
  if (angle >= Math.PI / 2) angle -= Math.PI;
  else if (angle < -Math.PI / 2) angle += Math.PI;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // The normal pointing up on screen for the readable direction.
  const nx = Math.sin(angle);
  const ny = -Math.cos(angle);
  return { x: mx + nx * gap, y: my + ny * gap, angle };
}
