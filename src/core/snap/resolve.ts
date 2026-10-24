// Snap resolution (Story 4.1 AC 3, FR29). Pure and framework-free.
//
// From the prototype's vectorSnap (score = distance minus a bonus per type)
// to a strict priority, as the UX asks: endpoint □ > intersection ✕ >
// midpoint △ > perpendicular ⊥ (with a "from" point) > on line ○; within a
// type the nearest wins. Work per query is bounded (NFR6): at most
// MAX_CANDIDATES segments are read, and intersections are only computed among
// the MAX_INTERSECTING nearest of them.

import { SEG_END_POINT, SEG_START_POINT, SEG_STRAIGHT } from "./extract";

export type Point = { x: number; y: number };

export type SnapType = "endpoint" | "intersection" | "midpoint" | "perpendicular" | "on-line";

/** Strongest first. */
export const SNAP_PRIORITY: readonly SnapType[] = ["endpoint", "intersection", "midpoint", "perpendicular", "on-line"];

/** One segment offered by a source, user space points, with SEG_* flags. */
export type SnapSegment = { ax: number; ay: number; bx: number; by: number; flags: number };

/** Where snap targets come from: drawing linework (4.1), markups and a grid (later). */
export interface SnapSource {
  /** Segments within `radius` of (x, y), at most `limit`. */
  near(x: number, y: number, radius: number, limit: number): SnapSegment[];
}

export type SnapQuery = {
  /** The cursor in user space. */
  point: Point;
  /** Snap distance in user space units (the CSS px tolerance divided by the zoom). */
  tolerance: number;
  sources: readonly SnapSource[];
  /** The previous point of the tool (perpendicular snaps need it). */
  from?: Point | null;
};

export type SnapResult = { x: number; y: number; type: SnapType; distance: number };

export const MAX_CANDIDATES = 96;
export const MAX_INTERSECTING = 32;
/** Two segments this close to parallel (sine of the angle) do not intersect for snapping. */
const PARALLEL = 1e-6;
/** Share of a segment's length an intersection may lie past its ends (rounding in the PDF). */
const END_SLACK = 1e-6;

/** Resolves the cursor to the strongest snap target within the tolerance, or null. */
export function resolveSnap(query: SnapQuery): SnapResult | null {
  const { point, tolerance, sources, from } = query;
  if (!(tolerance > 0) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const segments: SnapSegment[] = [];
  for (const source of sources) {
    if (segments.length >= MAX_CANDIDATES) break;
    for (const s of source.near(point.x, point.y, tolerance, MAX_CANDIDATES - segments.length)) {
      // Zero-length (or non-finite) segments carry no direction: only their point could matter, and that is never a line end.
      if (!(Number.isFinite(s.ax) && Number.isFinite(s.ay) && Number.isFinite(s.bx) && Number.isFinite(s.by))) continue;
      if (s.ax === s.bx && s.ay === s.by) continue;
      segments.push(s);
    }
  }
  if (segments.length === 0) return null;

  // Work relative to the cursor: huge coordinates keep their precision.
  const ox = point.x;
  const oy = point.y;
  const best = new Map<SnapType, SnapResult>();
  const consider = (dx: number, dy: number, type: SnapType) => {
    const d = Math.hypot(dx, dy);
    if (!(d <= tolerance)) return;
    const current = best.get(type);
    if (!current || d < current.distance) best.set(type, { x: ox + dx, y: oy + dy, type, distance: d });
  };

  for (const s of segments) {
    const ax = s.ax - ox;
    const ay = s.ay - oy;
    const bx = s.bx - ox;
    const by = s.by - oy;
    if (s.flags & SEG_START_POINT) consider(ax, ay, "endpoint");
    if (s.flags & SEG_END_POINT) consider(bx, by, "endpoint");
    if (s.flags & SEG_STRAIGHT) consider((ax + bx) / 2, (ay + by) / 2, "midpoint");
    const near = nearestOnSegment(0, 0, ax, ay, bx, by);
    consider(near.x, near.y, "on-line");
    if (from) {
      const foot = perpendicularFoot(from.x - ox, from.y - oy, ax, ay, bx, by);
      if (foot) consider(foot.x, foot.y, "perpendicular");
    }
  }

  // Intersections among the nearest segments only (sources return nearest first).
  const n = Math.min(segments.length, MAX_INTERSECTING);
  for (let i = 0; i < n; i++) {
    const p = segments[i];
    for (let j = i + 1; j < n; j++) {
      const q = segments[j];
      const hit = intersect(p.ax - ox, p.ay - oy, p.bx - ox, p.by - oy, q.ax - ox, q.ay - oy, q.bx - ox, q.by - oy);
      if (hit) consider(hit.x, hit.y, "intersection");
    }
  }

  for (const type of SNAP_PRIORITY) {
    const found = best.get(type);
    if (found) return found;
  }
  return null;
}

/** The point of segment a-b nearest to (px, py). */
export function nearestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Point {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: ax, y: ay };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { x: ax + t * dx, y: ay + t * dy };
}

/** The foot of the perpendicular from (px, py) onto segment a-b, if it falls on the segment. */
export function perpendicularFoot(px: number, py: number, ax: number, ay: number, bx: number, by: number): Point | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0 || t > 1) return null;
  return { x: ax + t * dx, y: ay + t * dy };
}

/** Where segments p1-p2 and p3-p4 cross, or null (parallel, or crossing outside either). */
export function intersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): Point | null {
  const rx = x2 - x1;
  const ry = y2 - y1;
  const sx = x4 - x3;
  const sy = y4 - y3;
  const den = rx * sy - ry * sx;
  const scale = Math.hypot(rx, ry) * Math.hypot(sx, sy);
  if (scale === 0 || Math.abs(den) <= PARALLEL * scale) return null;
  const t = ((x3 - x1) * sy - (y3 - y1) * sx) / den;
  const u = ((x3 - x1) * ry - (y3 - y1) * rx) / den;
  if (t < -END_SLACK || t > 1 + END_SLACK || u < -END_SLACK || u > 1 + END_SLACK) return null;
  // Two segments that merely meet end to end (a polyline's corner, a flattened curve's
  // joints) do not cross: that point is an endpoint or nothing, never an intersection.
  const atEnd = (v: number) => v <= END_SLACK || v >= 1 - END_SLACK;
  if (atEnd(t) && atEnd(u)) return null;
  return { x: x1 + t * rx, y: y1 + t * ry };
}
