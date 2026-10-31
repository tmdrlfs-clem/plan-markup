// Area measurements (Story 4.8, FR26, NFR8). Framework-free.
//
// An area is a closed polygon in PDF user space (its closing edge implied)
// less its holes. Its real area comes from the page's calibration with the
// separate X / Y factors along user space axes (as core/calibration
// measureLength) and the page's UserUnit, so a rectangle reads the product of
// the two lengths Verify would report for its sides.

import type { Calibration, DisplayUnit, Precision } from "@/core/calibration/calibration";
import { formatMeasured } from "@/core/calibration/units";

import { SCALE_NOT_SET, lengthMm } from "./length";

type Point = { x: number; y: number };

const MM2_PER_M2 = 1_000_000;
const MM2_PER_FT2 = 304.8 * 304.8;

/** Twice the signed area of a ring (shoelace), in the ring's units. */
function signedArea2(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  return -s;
}

/**
 * The real area in mm² of `outer` less `holes` (user space) under
 * `calibration` on a page with `userUnit`; null without a calibration (never
 * an unscaled number).
 */
export function areaMm2(
  outer: readonly Point[],
  holes: readonly (readonly Point[])[] | undefined,
  calibration: Pick<Calibration, "xFactor" | "yFactor"> | null,
  userUnit = 1,
): number | null {
  if (!calibration) return null;
  const u = userUnit > 0 ? userUnit : 1;
  // Scaling x and y separately scales every area by the same xFactor · yFactor.
  const k = u * u * calibration.xFactor * calibration.yFactor;
  let total = Math.abs(signedArea2(outer)) / 2;
  for (const hole of holes ?? []) total -= Math.abs(signedArea2(hole)) / 2;
  return Math.max(0, total) * k;
}

/** The outer ring's perimeter in mm (closing edge included); null without a calibration. */
export function perimeterMm(outer: readonly Point[], calibration: Pick<Calibration, "xFactor" | "yFactor"> | null, userUnit = 1): number | null {
  return outer.length < 2 ? (calibration ? 0 : null) : lengthMm([...outer, outer[0]], calibration, userUnit);
}

/** Founder default D1: m² for metric display units, ft² for imperial, two decimals. */
export function formatArea(mm2: number, unit: DisplayUnit): string {
  const imperial = unit === "in" || unit === "ft-in";
  const value = mm2 / (imperial ? MM2_PER_FT2 : MM2_PER_M2);
  return `${value.toFixed(2)} ${imperial ? "ft²" : "m²"}`;
}

export type AreaCaption = { area: string; perimeter: string | null; scaled: boolean };

/** An area's caption: its value and perimeter in the calibration's units, or "Scale not set". */
export function areaCaption(
  outer: readonly Point[],
  holes: readonly (readonly Point[])[] | undefined,
  calibration: (Pick<Calibration, "xFactor" | "yFactor"> & { unit: DisplayUnit; precision: Precision }) | null,
  userUnit = 1,
): AreaCaption {
  const mm2 = areaMm2(outer, holes, calibration, userUnit);
  const p = perimeterMm(outer, calibration, userUnit);
  if (mm2 === null || p === null || !calibration) return { area: SCALE_NOT_SET, perimeter: null, scaled: false };
  return { area: formatArea(mm2, calibration.unit), perimeter: formatMeasured(p, calibration.unit, calibration.precision), scaled: true };
}

/** The caption text in one line (layer 2's list, e2e): "37.34 m², P 24694 mm". */
export function areaCaptionText(c: AreaCaption): string {
  return c.perimeter ? `${c.area}, P ${c.perimeter}` : c.area;
}

/** The polygon's centroid (area-weighted); the vertices' mean for a degenerate one. */
export function polygonCentroid(ring: readonly Point[]): Point {
  const a2 = signedArea2(ring);
  if (Math.abs(a2) < 1e-9) {
    const n = ring.length || 1;
    return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    cx += (ring[j].x + ring[i].x) * cross;
    cy += (ring[j].y + ring[i].y) * cross;
  }
  // Cx = Σ / (6A) and a2 = 2A.
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

const EPS = 1e-9;

function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < EPS ? 0 : Math.sign(v);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS && Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS;
}

/** Whether segments ab and cd share any point (touching and collinear overlap included). */
export function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d)) || (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b));
}

/**
 * Whether the closed polygon is not a simple polygon an area can be measured
 * on (founder default D3: refused): fewer than three distinct vertices, no
 * area, or two edges that meet anywhere but at their shared vertex (crossing,
 * touching, or overlapping along a line; a vertex back on an earlier edge).
 */
export function selfIntersects(ring: readonly Point[]): boolean {
  const n = ring.length;
  if (n < 3 || new Set(ring.map((p) => `${p.x},${p.y}`)).size < 3) return true;
  if (Math.abs(signedArea2(ring)) < EPS) return true;
  const edge = (i: number): [Point, Point] => [ring[i], ring[(i + 1) % n]];
  for (let i = 0; i < n; i++) {
    const [a, b] = edge(i);
    // A zero-length edge (a repeated vertex) or an edge folding back on the next one is not simple.
    if (a.x === b.x && a.y === b.y) return true;
    for (let j = i + 1; j < n; j++) {
      const [c, d] = edge(j);
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Neighbours share one vertex; they must not overlap beyond it (a spike back along the edge).
        const shared = j === i + 1 ? b : a;
        const [p, q] = j === i + 1 ? [a, d] : [b, c];
        if (orient(p, shared, q) === 0 && (p.x - shared.x) * (q.x - shared.x) + (p.y - shared.y) * (q.y - shared.y) > 0) return true;
        continue;
      }
      if (segmentsMeet(a, b, c, d)) return true;
    }
  }
  return false;
}
