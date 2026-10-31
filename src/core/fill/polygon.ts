// Dynamic fill → vector polygon (Story 4.10, A11, A12). Framework-free.
//
// The filled cells become an area's rings in user space:
//  1. thin unfilled gaps inside the fill (hatching, lines across the room) are
//     bridged: grow the region by `bridge` cells, fill what it encloses,
//     shrink it back (the outer edge returns to where it was);
//  2. regions the fill encloses (furniture, islands of hatching) are part of
//     the room, except cells the user erased: those stay out as holes;
//  3. diagonal pinches are widened so every boundary walk is unambiguous;
//  4. every boundary loop is traced along cell edges (outer loops
//     anticlockwise, holes clockwise, y up), simplified (RDP) and pushed half a
//     cell outward from the fill (a wall's cells start on average half a cell
//     before the line), then mapped to user space.
// The biggest outer loop is the area; its holes are the clockwise loops inside
// it; other outer loops (unconnected patches) are counted, not kept.
//
// Refactored from the prototype (C:\bluebeam\tool\src\core\60-fill.js:
// closeRegion / fillHoles / closeDiagonals / traceLoops / rdp / polygonFromFill).

import { gridToUser, type FillGrid } from "./grid";

type Point = { x: number; y: number };

export type FillRings = { outer: Point[]; holes: Point[][]; stray: number };

/** Bridge width in cells (gaps up to about twice this close). */
export const BRIDGE_CELLS = 2;
/** RDP tolerance in cells. */
const SIMPLIFY_CELLS = 0.75;
/** Patches smaller than this share of the main area are not counted as stray. */
const STRAY_SHARE = 0.02;

/** Floods the cells where `blocked` is 0 from the box's border; returns the reached mask (box-local). */
function floodOutside(blocked: Uint8Array, bw: number, bh: number): Uint8Array {
  const out = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const seed = (i: number) => {
    if (!blocked[i] && !out[i]) {
      out[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < bw; x++) {
    seed(x);
    seed((bh - 1) * bw + x);
  }
  for (let y = 0; y < bh; y++) {
    seed(y * bw);
    seed(y * bw + bw - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const y = (i / bw) | 0;
    const x = i - y * bw;
    if (x > 0) seed(i - 1);
    if (x < bw - 1) seed(i + 1);
    if (y > 0) seed(i - bw);
    if (y < bh - 1) seed(i + bw);
  }
  return out;
}

/** Separable square dilation (`grow`) or erosion of `a` by r cells into a new mask. */
function morph(a: Uint8Array, bw: number, bh: number, r: number, grow: boolean): Uint8Array {
  const t = new Uint8Array(bw * bh);
  const o = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const row = y * bw;
    for (let x = 0; x < bw; x++) {
      let v = grow ? 0 : 1;
      for (let k = Math.max(0, x - r), e = Math.min(bw - 1, x + r); k <= e; k++) {
        if (grow ? a[row + k] : !a[row + k]) {
          v = grow ? 1 : 0;
          break;
        }
      }
      t[row + x] = v;
    }
  }
  for (let x = 0; x < bw; x++) {
    for (let y = 0; y < bh; y++) {
      let v = grow ? 0 : 1;
      for (let k = Math.max(0, y - r), e = Math.min(bh - 1, y + r); k <= e; k++) {
        if (grow ? t[k * bw + x] : !t[k * bw + x]) {
          v = grow ? 1 : 0;
          break;
        }
      }
      o[y * bw + x] = v;
    }
  }
  return o;
}

/** Widens every diagonal pinch (two cells touching only at a corner) into a 4-connected join. */
function closeDiagonals(f: Uint8Array, bw: number, bh: number): void {
  for (let pass = 0; pass < 3; pass++) {
    let hits = 0;
    for (let y = 0; y < bh - 1; y++) {
      const r = y * bw;
      const r2 = r + bw;
      for (let x = 0; x < bw - 1; x++) {
        const a = f[r + x];
        const b = f[r + x + 1];
        const c = f[r2 + x];
        const d = f[r2 + x + 1];
        if (a && d && !b && !c) {
          f[r + x + 1] = 1;
          hits++;
        } else if (b && c && !a && !d) {
          f[r + x] = 1;
          hits++;
        }
      }
    }
    if (!hits) break;
  }
}

/** Every boundary loop of the mask along cell edges (box-local corner coordinates). */
function traceLoops(f: Uint8Array, bw: number, bh: number): Point[][] {
  // One outgoing edge per boundary corner once diagonal pinches are closed.
  const next = new Map<number, number>();
  const key = (x: number, y: number) => y * (bw + 1) + x;
  for (let y = 0; y < bh; y++) {
    const row = y * bw;
    for (let x = 0; x < bw; x++) {
      if (!f[row + x]) continue;
      // Anticlockwise around the cell with y up: bottom edge east, right edge north, top west, left south.
      if (y === 0 || !f[row - bw + x]) next.set(key(x, y), key(x + 1, y));
      if (x === bw - 1 || !f[row + x + 1]) next.set(key(x + 1, y), key(x + 1, y + 1));
      if (y === bh - 1 || !f[row + bw + x]) next.set(key(x + 1, y + 1), key(x, y + 1));
      if (x === 0 || !f[row + x - 1]) next.set(key(x, y + 1), key(x, y));
    }
  }
  const loops: Point[][] = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const loop: Point[] = [];
    let k = start;
    for (let guard = next.size + 1; guard > 0; guard--) {
      const n = next.get(k);
      if (n === undefined) break;
      next.delete(k);
      loop.push({ x: k % (bw + 1), y: Math.floor(k / (bw + 1)) });
      k = n;
      if (k === start) break;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

/** Twice the signed area (positive anticlockwise with y up). */
export function signedArea2(ring: readonly Point[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer–Douglas–Peucker on an open polyline. */
function rdp(pts: readonly Point[], eps: number): Point[] {
  if (pts.length < 3) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let index = -1;
    let max = 0;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > eps && index > 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** RDP on a closed ring: split at the vertex farthest from the first, simplify both halves. */
export function simplifyRing(ring: readonly Point[], eps: number): Point[] {
  if (ring.length <= 4) return [...ring];
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i].x - ring[0].x, ring[i].y - ring[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdp(ring.slice(0, far + 1), eps);
  const b = rdp([...ring.slice(far), ring[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/**
 * Moves every edge of `ring` by `d` along its outward normal (outward = growing the ring's
 * own area for d > 0), mitred corners (limited where an edge turns back sharply).
 */
export function offsetRing(ring: readonly Point[], d: number): Point[] {
  const n = ring.length;
  if (n < 3 || d === 0) return [...ring];
  // Anticlockwise rings grow to the right of each edge; clockwise ones to the left.
  const sign = signedArea2(ring) > 0 ? 1 : -1;
  const normal = (a: Point, b: Point): Point => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (sign * (b.y - a.y)) / l, y: (-sign * (b.x - a.x)) / l };
  };
  return ring.map((v, i) => {
    const n1 = normal(ring[(i + n - 1) % n], v);
    const n2 = normal(v, ring[(i + 1) % n]);
    const k = 1 + n1.x * n2.x + n1.y * n2.y;
    if (k < 0.25) return { x: v.x + d * n2.x, y: v.y + d * n2.y };
    return { x: v.x + (d * (n1.x + n2.x)) / k, y: v.y + (d * (n1.y + n2.y)) / k };
  });
}

function pointInRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The filled region of `grid` as an area's rings in user space (null when nothing is filled).
 * `erased` cells (the user's eraser) stay out of the area; other enclosed cells are in it.
 */
export function fillRings(grid: FillGrid, filled: Uint8Array, erased: Uint8Array, bridge = BRIDGE_CELLS): FillRings | null {
  const { w, h } = grid;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!filled[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  // A box around the fill with room for the bridge and an empty border (loops close inside it).
  const pad = bridge + 2;
  const bx0 = x0 - pad;
  const by0 = y0 - pad;
  const bw = x1 - x0 + 1 + 2 * pad;
  const bh = y1 - y0 + 1 + 2 * pad;
  let f = new Uint8Array(bw * bh);
  const out = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gx = x + bx0;
      const gy = y + by0;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const i = gy * w + gx;
      f[y * bw + x] = filled[i];
      out[y * bw + x] = erased[i];
    }
  }
  // 1. Bridge thin gaps: grow, fill what is enclosed, shrink back (keeping what was filled).
  if (bridge > 0) {
    const grown = morph(f, bw, bh, bridge, true);
    const outside = floodOutside(grown, bw, bh);
    for (let i = 0; i < grown.length; i++) if (!outside[i]) grown[i] = 1;
    const closed = morph(grown, bw, bh, bridge, false);
    for (let i = 0; i < f.length; i++) if (closed[i] && !out[i]) f[i] = 1;
  }
  // 2. Enclosed regions are room, except the erased cells.
  const outside = floodOutside(f, bw, bh);
  for (let i = 0; i < f.length; i++) if (!f[i] && !outside[i] && !out[i]) f[i] = 1;
  // 3. Unambiguous boundaries.
  closeDiagonals(f, bw, bh);
  // 4. Loops, largest outer one first.
  const loops = traceLoops(f, bw, bh);
  f = new Uint8Array(0);
  const outers = loops.filter((l) => signedArea2(l) > 0).sort((a, b) => signedArea2(b) - signedArea2(a));
  if (outers.length === 0) return null;
  const main = outers[0];
  const mainArea = signedArea2(main);
  // A hole's corners lie strictly inside its outer loop (the boundaries share no corner once
  // diagonal pinches are closed); a quarter-cell nudge keeps the test off grid lines.
  const holes = loops.filter((l) => signedArea2(l) < 0 && pointInRing({ x: l[0].x + 0.25, y: l[0].y + 0.25 }, main));
  const stray = outers.slice(1).filter((l) => signedArea2(l) >= mainArea * STRAY_SHARE).length;
  const toUser = (ring: readonly Point[], grow: number) =>
    offsetRing(simplifyRing(ring, SIMPLIFY_CELLS), grow).map((p) => gridToUser(grid, p.x + bx0, p.y + by0));
  return {
    outer: toUser(main, 0.5),
    // A hole's ring is clockwise: growing its own area by -0.5 shrinks the hole (the fill grows).
    holes: holes.map((l) => toUser(l, -0.5)).filter((l) => l.length >= 3),
    stray,
  };
}
