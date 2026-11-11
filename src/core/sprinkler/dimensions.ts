/**
 * Head dimensions (founder request 2026-11-12): the distances an installer sets heads out by,
 * shown on the drawing and switched on or off from the 4541 panel. For each zone: the gaps between
 * the heads of a row, each row's end heads to the wall, the distance from one row to the next, and
 * the outer rows to the wall. Rows that repeat the row before them are not dimensioned again.
 *
 * The dimensions are ordinary dimension markups made on the fly (never stored), so the canvas, the
 * exported PDF and the print all draw them the way they draw a dimension. Pure.
 */
import type { Calibration } from "@/core/calibration/calibration";
import type { Point } from "@/core/markup/geometry";
import type { DimensionMarkup, MarkupStyle, ZoneMarkup } from "@/core/schema/markup";

import { headCentre, pageScaleOf, toMm, toPage, type HeadMarkup } from "./heads";

/** Thin and small, in a blue that is neither a head nor a markup default. */
export const HEAD_DIMENSION_STYLE: MarkupStyle = { color: "#1d4ed8", width: 0.35, fontSize: 5 };

/** Heads within this of one line (mm, across the rows) are one row. */
const ROW_TOL = 150;
/** Shorter than this (mm) is not worth a dimension. */
const MIN_DIM = 50;
/** Two figures within this (mm) are the same figure (a repeated row). */
const SAME = 5;

type Seg = [Point, Point];

const rot = (p: Point, a: number): Point => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

/** The distance from `p` along the unit vector `d` to the first wall (Infinity: none). */
function rayToWall(p: Point, d: Point, rings: readonly (readonly Point[])[]): number {
  let best = Infinity;
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
      const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
      if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
    }
  return best;
}

/** The direction the rows run (radians, within ±45° of the page's x axis or y axis folded onto it). */
function rowAngle(heads: readonly Point[], outer: readonly Point[]): number {
  let sx = 0;
  let sy = 0;
  const add = (dx: number, dy: number, w: number) => {
    const a = 4 * Math.atan2(dy, dx);
    sx += w * Math.cos(a);
    sy += w * Math.sin(a);
  };
  if (heads.length >= 2) {
    for (const h of heads) {
      let best: Point | null = null;
      let bd = Infinity;
      for (const g of heads) {
        const d = Math.hypot(g.x - h.x, g.y - h.y);
        if (g !== h && d > 1 && d < bd) {
          bd = d;
          best = g;
        }
      }
      if (best) add(best.x - h.x, best.y - h.y, 1);
    }
  }
  if (Math.hypot(sx, sy) < 1e-6) outer.forEach((p, i) => add(outer[(i + 1) % outer.length].x - p.x, outer[(i + 1) % outer.length].y - p.y, Math.hypot(outer[(i + 1) % outer.length].x - p.x, outer[(i + 1) % outer.length].y - p.y)));
  return Math.atan2(sy, sx) / 4;
}

/** The dimension segments of one zone, in mm (zone frame undone): [from, to] each. */
export function headDimensionSegments(outer: readonly Point[], holes: readonly (readonly Point[])[], heads: readonly Point[]): Seg[] {
  if (heads.length === 0 || outer.length < 3) return [];
  const theta = rowAngle(heads, outer);
  const loc = (p: Point) => rot(p, -theta);
  const rings = [outer, ...holes].map((r) => r.map(loc));
  const pts = heads.map(loc).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Point[][] = [];
  for (const p of pts) {
    const last = rows[rows.length - 1];
    if (last && p.y - last[last.length - 1].y <= ROW_TOL) last.push(p);
    else rows.push([p]);
  }
  for (const r of rows) r.sort((a, b) => a.x - b.x);

  const out: Seg[] = [];
  const push = (a: Point, b: Point) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_DIM) out.push([rot(a, theta), rot(b, theta)]);
  };
  const wall = (p: Point, dx: number, dy: number) => {
    const t = rayToWall(p, { x: dx, y: dy }, rings);
    if (Number.isFinite(t)) push(p, { x: p.x + dx * t, y: p.y + dy * t });
    return t;
  };

  let prevSig: number[] | null = null;
  rows.forEach((row, ri) => {
    // Along the row: wall, gaps, wall. A row with the figures of the row before it is not repeated.
    const first = row[0];
    const last = row[row.length - 1];
    const sig = [rayToWall(first, { x: -1, y: 0 }, rings), ...row.map((p) => p.x), rayToWall(last, { x: 1, y: 0 }, rings)];
    const repeat = prevSig !== null && prevSig.length === sig.length && sig.every((v, i) => Math.abs(v - prevSig![i]) <= SAME || (v === Infinity && prevSig![i] === Infinity));
    prevSig = sig;
    if (!repeat) {
      wall(first, -1, 0);
      for (let i = 0; i + 1 < row.length; i++) {
        const a = row[i];
        const b = row[i + 1];
        const gap = b.x - a.x;
        // A wall between two heads of a row: each is dimensioned to the wall, not to the other.
        if (rayToWall(a, { x: 1, y: 0 }, rings) < gap - 1) {
          wall(a, 1, 0);
          wall(b, -1, 0);
        } else push(a, { x: b.x, y: a.y });
      }
      wall(last, 1, 0);
    }
    // Across the rows, at the row's first head: up to the row before (or the wall when it is nearer
    // or there is none), and down to the wall from the last row (or when a wall is nearer than the next row).
    const up = rayToWall(first, { x: 0, y: -1 }, rings);
    const prevY = ri > 0 ? rows[ri - 1][0].y : null;
    if (prevY === null || up < first.y - prevY - 1) wall(first, 0, -1);
    else push({ x: first.x, y: prevY }, first);
    const down = rayToWall(first, { x: 0, y: 1 }, rings);
    const nextY = ri + 1 < rows.length ? rows[ri + 1][0].y : null;
    if (nextY === null || down < nextY - first.y - 1) wall(first, 0, 1);
  });
  return out;
}

const dimId = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

/**
 * The head dimensions of `zone` as dimension markups on its page (ids from `firstId` up; they are
 * never stored). Empty on an uncalibrated page.
 */
export function headDimensions(
  zone: ZoneMarkup,
  heads: readonly HeadMarkup[],
  calibration: Pick<Calibration, "xFactor" | "yFactor"> | null,
  userUnit = 1,
  firstId = 0,
): DimensionMarkup[] {
  if (!calibration || heads.length === 0) return [];
  const s = pageScaleOf(calibration, userUnit);
  const mm = (r: readonly Point[]) => r.map((p) => toMm(p, s));
  const segs = headDimensionSegments(
    mm(zone.points),
    (zone.holes ?? []).map(mm),
    heads.map((h) => toMm(headCentre(h), s)),
  );
  return segs.map(([a, b], i) => {
    const pa = toPage(a, s);
    const pb = toPage(b, s);
    return {
      id: dimId(firstId + i),
      pageId: zone.pageId,
      createdAt: "",
      style: HEAD_DIMENSION_STYLE,
      type: "dimension" as const,
      // The dimension line runs through the measured points themselves (no offset).
      points: [pa, pb, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }],
    };
  });
}
