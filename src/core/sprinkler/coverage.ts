/**
 * Story 9.9 (FR75, UX-DR25): each head's coverage polygon, for the coverage overlay. Framework-free, mm.
 *
 * A head covers what it can see within its coverage shape:
 * - `circle` (default): radius Rc = ½·√(Smax² + (Amax/Smax)²), the oracle's coverage radius;
 * - `square`: the square inscribed in that circle (side Rc·√2, so its area is about Amax), turned to the
 *   zone's longest outline edge.
 * Walls, columns and shafts all block the spray, so each polygon is the shape clipped by the head's
 * visibility (spray shadows). Polygons are built by casting rays from the head: at a fixed angular step
 * (arcs), at every barrier corner (just either side, so shadows are exact) and where an edge crosses
 * the circle. Everything is drawn from polygons, so post-MVP obstructions only add barriers.
 */
import type { Point } from "@/core/markup/geometry";

export type CoverageShape = "circle" | "square";
export const COVERAGE_SHAPES: readonly CoverageShape[] = ["circle", "square"];

export type CoverageBarrier = { kind: string; ring: readonly Point[] };
export type CoverageHead = { id: string; x: number; y: number };
/** One head's coverage; `ring` is empty when the head is outside its zone. */
export type HeadCoverage = { id: string; ring: Point[] };

/** The coverage radius (mm) from the rule figures (metres, m²), as the oracle computes it. */
export function coverageRadiusMm(rule: { Smax: number; Amax: number }): number {
  const S = rule.Smax * 1000;
  const L = (rule.Amax * 1e6) / S;
  return Math.sqrt(S * S + L * L) / 2;
}

const ARC_STEP = (2 * Math.PI) / 96; // 3.75°: an arc's chord is within 0.06 % of Rc
const EPS_ANGLE = 1e-5;
const TAU = 2 * Math.PI;

type Seg = { ax: number; ay: number; bx: number; by: number };

function segmentsOf(barriers: readonly CoverageBarrier[]): Seg[] {
  const out: Seg[] = [];
  for (const b of barriers) {
    const r = b.ring;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const c = r[(i + 1) % r.length];
      if (a.x !== c.x || a.y !== c.y) out.push({ ax: a.x, ay: a.y, bx: c.x, by: c.y });
    }
  }
  return out;
}

function insideRing(px: number, py: number, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The angle (radians) the square is turned to: the zone outline's longest edge, folded into [0, 90°). */
export function squareAngleOf(barriers: readonly CoverageBarrier[]): number {
  const wall = barriers.find((b) => b.kind === "wall");
  if (!wall) return 0;
  let best = 0;
  let angle = 0;
  const r = wall.ring;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  const q = Math.PI / 2;
  return ((angle % q) + q) % q;
}

/** The shape's reach along direction `t` from the head. */
function shapeReach(shape: CoverageShape, R: number, t: number, turn: number): number {
  if (shape === "circle") return R;
  const half = R / Math.SQRT2;
  const u = t - turn;
  const cx = Math.abs(Math.cos(u));
  const cy = Math.abs(Math.sin(u));
  return half / Math.max(cx, cy);
}

/** The nearest hit of the ray from (hx, hy) along (dx, dy) on `segs` (ray parameter; Infinity: none). */
function rayHit(hx: number, hy: number, dx: number, dy: number, segs: readonly Seg[]): number {
  let best = Infinity;
  for (const s of segs) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const wx = s.ax - hx;
    const wy = s.ay - hy;
    const t = (wx * ey - wy * ex) / den;
    const u = (wx * dy - wy * dx) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

/** Angles where segment `s` crosses the circle of radius R round (hx, hy). */
function circleCrossings(hx: number, hy: number, R: number, s: Seg, out: number[]): void {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const fx = s.ax - hx;
  const fy = s.ay - hy;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - R * R;
  const disc = b * b - 4 * a * c;
  if (a === 0 || disc < 0) return;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0 || t > 1) continue;
    const t0 = Math.atan2(fy + t * dy, fx + t * dx);
    out.push(t0 - EPS_ANGLE, t0, t0 + EPS_ANGLE);
  }
}

/**
 * The coverage polygon of each head in a zone (mm). `R`: the coverage radius; the square, if any, is
 * turned by `turn` radians (default: the zone's longest edge).
 */
export function coverageOf(
  barriers: readonly CoverageBarrier[],
  heads: readonly CoverageHead[],
  R: number,
  shape: CoverageShape = "circle",
  turn = squareAngleOf(barriers),
): HeadCoverage[] {
  const all = segmentsOf(barriers);
  const wall = barriers.find((b) => b.kind === "wall")?.ring ?? [];
  const holes = barriers.filter((b) => b.kind !== "wall").map((b) => b.ring);
  // The farthest the shape reaches (the square's corners touch the circle).
  return heads.map((h) => {
    if (!(R > 0) || !insideRing(h.x, h.y, wall) || holes.some((r) => insideRing(h.x, h.y, r))) return { id: h.id, ring: [] };
    // Only the edges within reach can clip this head's polygon.
    const segs = all.filter(
      (s) => Math.min(s.ax, s.bx) <= h.x + R && Math.max(s.ax, s.bx) >= h.x - R && Math.min(s.ay, s.by) <= h.y + R && Math.max(s.ay, s.by) >= h.y - R,
    );
    const angles: number[] = [];
    for (let t = 0; t < TAU; t += ARC_STEP) angles.push(t);
    if (shape === "square") for (let k = 0; k < 4; k++) angles.push(turn + Math.PI / 4 + (k * Math.PI) / 2);
    for (const s of segs) {
      for (const [px, py] of [
        [s.ax, s.ay],
        [s.bx, s.by],
      ]) {
        if (Math.hypot(px - h.x, py - h.y) > R) continue;
        const t = Math.atan2(py - h.y, px - h.x);
        angles.push(t - EPS_ANGLE, t, t + EPS_ANGLE);
      }
      if (shape === "circle") circleCrossings(h.x, h.y, R, s, angles);
    }
    const norm = angles.map((t) => ((t % TAU) + TAU) % TAU).sort((a, b) => a - b);
    const ring: Point[] = [];
    let last = -1;
    for (const t of norm) {
      if (t - last < 1e-9) continue;
      last = t;
      const dx = Math.cos(t);
      const dy = Math.sin(t);
      const r = Math.min(rayHit(h.x, h.y, dx, dy, segs), shapeReach(shape, R, t, turn));
      const p = { x: h.x + r * dx, y: h.y + r * dy };
      const prev = ring[ring.length - 1];
      if (!prev || Math.abs(prev.x - p.x) > 1e-6 || Math.abs(prev.y - p.y) > 1e-6) ring.push(p);
    }
    return { id: h.id, ring };
  });
}

/** A ring's area (shoelace, absolute). */
export function ringAreaOf(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
