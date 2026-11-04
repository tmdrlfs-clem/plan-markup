// Markup geometry for selection (Story 5.1, FR33). Framework-free.
//
// Everything is in the markup's page user space. A markup is hit by its
// stroke within a tolerance, an area also by its inside (less its holes), a
// count by any marker; a radius or diameter by its circle and its line; a
// rectangle, ellipse or cloud (Story 5.5) by its outline or inside; a text
// markup (Story 5.6) by its box, its note icon, its cloud or its leader; a
// pen or highlight stroke (Story 5.7) within half its width as well; an
// image (Story 5.8) inside its box, a dimension by its lines; an underline or
// strikethrough (Story 5.9) inside its glyph boxes. A
// marquee or lasso selects a markup when its whole outline is inside.

import { circleThrough } from "@/core/measure/circle";
import type { Markup } from "@/core/schema/markup";

import { dimensionLine, dimensionOutline } from "./dimension";
import { NOTE_PT, cloudRingOf, leaderOf, textBoxOf } from "./text";
import { quadsOf } from "./text-select";
import { CLOUD_CHORD_PT, ellipseBounds, ellipseFrame, ellipseLocal, ellipseOutline } from "./shapes";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Story 4.8: a count marker's radius in points (measure-tool paints it). */
export const COUNT_MARKER_PT = 4;
/** Points on a circle's outline for containment. */
const CIRCLE_SAMPLES = 32;
/** Story 5.5: points on an ellipse's outline, for containment and its stroke's hit. */
const ELLIPSE_SAMPLES = 64;

function circleOf(m: Markup): { centre: Point; radius: number } | null {
  return m.type === "radius" || m.type === "diameter" ? circleThrough(m.points[0], m.points[1], m.points[2]) : null;
}

/** The points that outline a markup: its vertices, or a circle's outline (and its points). */
export function outlinePoints(m: Markup): readonly Point[] {
  if (m.type === "ellipse") return ellipseOutline(ellipseFrame(m.points), ELLIPSE_SAMPLES);
  if (m.type === "dimension") return dimensionOutline(m.points);
  const circle = circleOf(m);
  if (!circle) return m.points;
  const out: Point[] = [];
  for (let i = 0; i < CIRCLE_SAMPLES; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_SAMPLES;
    out.push({ x: circle.centre.x + circle.radius * Math.cos(a), y: circle.centre.y + circle.radius * Math.sin(a) });
  }
  return out;
}

/** The user-space box of a markup: its points, or a radius's / diameter's whole circle. */
export function markupBounds(m: Markup): Rect {
  if (m.type === "ellipse") return ellipseBounds(ellipseFrame(m.points));
  const circle = circleOf(m);
  if (circle) {
    const { centre, radius } = circle;
    return { x: centre.x - radius, y: centre.y - radius, width: 2 * radius, height: 2 * radius };
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of m.type === "dimension" ? dimensionOutline(m.points) : m.points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The distance from `p` to the segment a–b. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function nearPolyline(p: Point, pts: readonly Point[], tol: number, closed: boolean): boolean {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol;
  for (let i = 1; i < pts.length; i++) if (segmentDistance(p, pts[i - 1], pts[i]) <= tol) return true;
  return closed && pts.length > 2 && segmentDistance(p, pts[pts.length - 1], pts[0]) <= tol;
}

/** Even–odd point in polygon. */
export function insidePolygon(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether `p` hits markup `m` within `tol` user units (`userUnit`: the page's, for a count's marker size). */
export function hitMarkup(m: Markup, p: Point, tol: number, userUnit = 1): boolean {
  switch (m.type) {
    case "count": {
      const r = COUNT_MARKER_PT / (userUnit > 0 ? userUnit : 1) + tol;
      return m.points.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= r);
    }
    // Story 5.4 (D2): an unfilled polygon is hit inside as well, like an area.
    // Story 5.5 (D2): so are a rectangle and a cloud (its arcs, out of its corners' ring, hit too).
    case "polygon":
    case "rectangle":
    case "image":
      return nearPolyline(p, m.points, tol, true) || insidePolygon(p, m.points);
    case "cloud":
      return nearPolyline(p, m.points, tol + CLOUD_CHORD_PT / 2 / (userUnit > 0 ? userUnit : 1), true) || insidePolygon(p, m.points);
    case "text":
    case "typewriter":
    case "note":
    case "callout":
    case "cloudplus": {
      const unit = userUnit > 0 ? userUnit : 1;
      if (m.type === "note") {
        const half = NOTE_PT / 2 / unit + tol;
        return Math.abs(p.x - m.points[0].x) <= half && Math.abs(p.y - m.points[0].y) <= half;
      }
      const box = textBoxOf(m)!;
      if (nearPolyline(p, box, tol, true) || insidePolygon(p, box)) return true;
      const leader = leaderOf(m);
      if (leader && segmentDistance(p, leader[0], leader[1]) <= tol) return true;
      if (m.type !== "cloudplus") return false;
      const ring = cloudRingOf(m);
      return nearPolyline(p, ring, tol + CLOUD_CHORD_PT / 2 / unit, true) || insidePolygon(p, ring);
    }
    // Story 5.7: a stroke as wide as it is painted (a highlight's 12 pt).
    case "pen":
    case "highlight":
      return nearPolyline(p, m.points, tol + m.style.width / 2 / (userUnit > 0 ? userUnit : 1), false);
    // Story 5.9: any of its glyph boxes.
    case "underline":
    case "strikethrough":
      return quadsOf(m.points).some((q) => insidePolygon(p, q) || nearPolyline(p, q, tol, true));
    // Story 5.8: the dimension line and the extension lines out to it.
    case "dimension": {
      const [a, b, c] = m.points;
      const line = dimensionLine(a, b, c);
      if (!line) return nearPolyline(p, [a, b], tol, false);
      return segmentDistance(p, line.from, line.to) <= tol || segmentDistance(p, a, line.from) <= tol || segmentDistance(p, b, line.to) <= tol;
    }
    case "ellipse": {
      const local = ellipseLocal(ellipseFrame(m.points), p);
      if (local && Math.hypot(local.x, local.y) <= 1) return true;
      return nearPolyline(p, outlinePoints(m), tol, true);
    }
    case "area": {
      const holes = m.holes ?? [];
      if (nearPolyline(p, m.points, tol, true) || holes.some((h) => nearPolyline(p, h, tol, true))) return true;
      return insidePolygon(p, m.points) && !holes.some((h) => insidePolygon(p, h));
    }
    case "radius":
    case "diameter": {
      const circle = circleOf(m);
      if (!circle) return nearPolyline(p, m.points, tol, false);
      const { centre, radius } = circle;
      if (Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - radius) <= tol) return true;
      // The radius line from the centre to the first point; the diameter's through the centre.
      const first = m.points[0];
      const from = m.type === "radius" ? centre : { x: 2 * centre.x - first.x, y: 2 * centre.y - first.y };
      return segmentDistance(p, from, first) <= tol;
    }
    default:
      return nearPolyline(p, m.points, tol, false);
  }
}

/** Whether markup `m` lies wholly inside rectangle `r`. */
export function insideRect(m: Markup, r: Rect): boolean {
  const b = markupBounds(m);
  return b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width && b.y + b.height <= r.y + r.height;
}

/** Whether markup `m` lies wholly inside the closed loop `loop` (a lasso). */
export function insideLoop(m: Markup, loop: readonly Point[]): boolean {
  return loop.length >= 3 && outlinePoints(m).every((p) => insidePolygon(p, loop));
}

/** A rectangle from two corners. */
export function rectOf(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Markup `m` moved by `d` (its caption offset is relative and moves with it). */
export function translateMarkup<M extends Markup>(m: M, d: Point): M {
  const move = (pts: readonly Point[]) => pts.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
  const moved = { ...m, points: move(m.points) } as M;
  if (m.type === "area" && m.holes) (moved as Extract<Markup, { type: "area" }>).holes = m.holes.map(move);
  return moved;
}
