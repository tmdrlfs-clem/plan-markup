// Story 9.4 (design §4.1): the oracle's own minimal geometry kernel. It is
// deliberately duplicated from (and written differently to) anything the
// placer uses, so a bug shared by both cannot hide. Imports nothing.

export type Pt = { x: number; y: number };

/** An edge with its inward unit normal (the region lies on that side). */
export type Edge = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  inx: number;
  iny: number;
  /** A zone edge with no wall (open plan): no sight blocking, no wall-distance rule. */
  open: boolean;
  /** A column face: blocks sight and needs clearance, but carries no Wmax rule. */
  column: boolean;
};

/** Shoelace area, positive for a counter-clockwise ring (y up). */
export function signedArea(ring: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[i === ring.length - 1 ? 0 : i + 1];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return -s / 2;
}

/** Winding-number point-in-ring. */
export function insideRing(px: number, py: number, ring: readonly Pt[]): boolean {
  let wn = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) wn++;
    } else if (b.y <= py && side < 0) wn--;
  }
  return wn !== 0;
}

export function segPointDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** Does the open segment p→q touch the closed edge e (contact at p or q excluded)? Parallel edges never block. */
export function crosses(px: number, py: number, qx: number, qy: number, e: Edge): boolean {
  const rx = qx - px;
  const ry = qy - py;
  const sx = e.bx - e.ax;
  const sy = e.by - e.ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false;
  const wx = e.ax - px;
  const wy = e.ay - py;
  const t = (wx * sy - wy * sx) / den;
  const u = (wx * ry - wy * rx) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-12 && u <= 1 + 1e-12;
}

/** A uniform grid of edges (cell `size` mm) for range and sight queries. */
export class EdgeBuckets {
  private readonly cells = new Map<string, number[]>();
  private readonly seen: Uint32Array;
  private tick = 1;

  constructor(
    readonly edges: readonly Edge[],
    private readonly size: number,
  ) {
    this.seen = new Uint32Array(edges.length);
    edges.forEach((e, k) => {
      const c0 = Math.floor(Math.min(e.ax, e.bx) / size);
      const c1 = Math.floor(Math.max(e.ax, e.bx) / size);
      const r0 = Math.floor(Math.min(e.ay, e.by) / size);
      const r1 = Math.floor(Math.max(e.ay, e.by) / size);
      for (let c = c0; c <= c1; c++)
        for (let r = r0; r <= r1; r++) {
          const key = `${c},${r}`;
          const list = this.cells.get(key);
          if (list) list.push(k);
          else this.cells.set(key, [k]);
        }
    });
  }

  /** Calls `fn` once per edge whose cells meet the box; stops (true) when `fn` returns true. */
  each(x0: number, y0: number, x1: number, y1: number, fn: (e: Edge) => boolean): boolean {
    const s = this.size;
    this.tick++;
    for (let c = Math.floor(x0 / s); c <= Math.floor(x1 / s); c++) {
      for (let r = Math.floor(y0 / s); r <= Math.floor(y1 / s); r++) {
        const list = this.cells.get(`${c},${r}`);
        if (!list) continue;
        for (const k of list) {
          if (this.seen[k] === this.tick) continue;
          this.seen[k] = this.tick;
          if (fn(this.edges[k])) return true;
        }
      }
    }
    return false;
  }

  /** Whether the segment p→q crosses no edge. */
  clearSight(px: number, py: number, qx: number, qy: number): boolean {
    return !this.each(Math.min(px, qx), Math.min(py, qy), Math.max(px, qx), Math.max(py, qy), (e) => crosses(px, py, qx, qy, e));
  }
}

export function centroidOf(ring: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}
