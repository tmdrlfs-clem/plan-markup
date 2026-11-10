// Story 9.13 (M2 review, tests only): the spacing between heads that are real neighbours.
//
// The oracle's C4 reads "max spacing" as each head's nearest visible peer (design H4). That
// cannot see two rows that are too far apart while the heads along each row are close. This
// helper measures the stricter reading without a frame: two heads are neighbours when their
// cells (each lattice point belongs to its nearest visible head) share a boundary at least
// `minShared` mm long and the heads see each other; the gap is their distance. In a
// rectangular grid the neighbours are the next head along the row and the one in the next
// row; diagonal heads share a corner only. Written on its own (no oracle, no placer imports).

export type GapPt = { x: number; y: number };
export type GapZone = { outer: readonly GapPt[]; holes?: readonly (readonly GapPt[])[] };
export type NeighbourGap = { a: string; b: string; distance: number; shared: number };

const STEP = 100;

function inside(p: GapPt, ring: readonly GapPt[]): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
  }
  return odd;
}

/** Proper crossing of p→q with a→b (touching at an end of p→q does not count). */
function cuts(p: GapPt, q: GapPt, a: GapPt, b: GapPt): boolean {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1;
}

/** The gaps between neighbouring heads of one zone (mm), widest first. */
export function neighbourGaps(zone: GapZone, heads: readonly { id: string; x: number; y: number }[], minShared = 800): NeighbourGap[] {
  const rings = [zone.outer, ...(zone.holes ?? [])];
  const edges: [GapPt, GapPt][] = rings.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]] as [GapPt, GapPt]));
  const sees = (p: GapPt, q: GapPt) => !edges.some(([a, b]) => cuts(p, q, a, b));
  const inZone = (p: GapPt) => inside(p, zone.outer) && !(zone.holes ?? []).some((h) => inside(p, h));
  const xs = zone.outer.map((p) => p.x);
  const ys = zone.outer.map((p) => p.y);
  const x0 = Math.min(...xs) + 43;
  const y0 = Math.min(...ys) + 29;
  const cols = Math.ceil((Math.max(...xs) - x0) / STEP);
  const rows = Math.ceil((Math.max(...ys) - y0) / STEP);
  const label = new Int32Array(cols * rows).fill(-1);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p = { x: x0 + i * STEP, y: y0 + j * STEP };
      if (!inZone(p)) continue;
      const order = heads.map((h, k) => [Math.hypot(h.x - p.x, h.y - p.y), k] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, k] of order)
        if (sees(heads[k], p)) {
          label[j * cols + i] = k;
          break;
        }
    }
  const shared = new Map<string, number>();
  const touch = (a: number, b: number) => {
    if (a < 0 || b < 0 || a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    shared.set(key, (shared.get(key) ?? 0) + STEP);
  };
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      if (i + 1 < cols) touch(label[j * cols + i], label[j * cols + i + 1]);
      if (j + 1 < rows) touch(label[j * cols + i], label[(j + 1) * cols + i]);
    }
  const out: NeighbourGap[] = [];
  for (const [key, len] of shared) {
    if (len < minShared) continue;
    const [a, b] = key.split(",").map(Number);
    if (!sees(heads[a], heads[b])) continue;
    out.push({ a: heads[a].id, b: heads[b].id, distance: Math.hypot(heads[a].x - heads[b].x, heads[a].y - heads[b].y), shared: len });
  }
  return out.sort((p, q) => q.distance - p.distance);
}
