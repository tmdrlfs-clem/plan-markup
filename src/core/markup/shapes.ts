// Box and cloud shapes (Story 5.5, FR31). Framework-free.
//
// A rectangle and an ellipse are stored as their box's four corners in order:
// the ellipse is the image of the unit circle in that box (its centre and two
// half-axis vectors), so a move, resize or rotation of the corners keeps it
// exact. A cloud's outline is arcs along its edges, their chords about a fixed
// size in the coordinates given (page units, or device px scaled from them),
// each bulging out of the ring.

export type Point = { x: number; y: number };

/** Story 5.5 (D1): a cloud arc's chord in points (page units); the arcs bulge out half that. */
export const CLOUD_CHORD_PT = 9;

/** The four corners of the axis-aligned box from corner `a` to the opposite corner `b`, in order. */
export function boxCorners(a: Point, b: Point): [Point, Point, Point, Point] {
  return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
}

/** An ellipse as its centre and half-axis vectors: the point at angle t is centre + cos t · u + sin t · v. */
export type EllipseFrame = { centre: Point; u: Point; v: Point };

/** The ellipse inscribed in the box of corners `pts` (in order: the first edge gives u, the last v). */
export function ellipseFrame(pts: readonly Point[]): EllipseFrame {
  const [p0, p1, p2, p3] = pts;
  return {
    centre: { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 },
    u: { x: (p1.x - p0.x) / 2, y: (p1.y - p0.y) / 2 },
    v: { x: (p3.x - p0.x) / 2, y: (p3.y - p0.y) / 2 },
  };
}

/** `n` points around the ellipse, from t = 0. */
export function ellipseOutline(f: EllipseFrame, n: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const c = Math.cos(t);
    const s = Math.sin(t);
    out.push({ x: f.centre.x + c * f.u.x + s * f.v.x, y: f.centre.y + c * f.u.y + s * f.v.y });
  }
  return out;
}

/** The ellipse's exact axis-aligned box. */
export function ellipseBounds(f: EllipseFrame): { x: number; y: number; width: number; height: number } {
  const hx = Math.hypot(f.u.x, f.v.x);
  const hy = Math.hypot(f.u.y, f.v.y);
  return { x: f.centre.x - hx, y: f.centre.y - hy, width: 2 * hx, height: 2 * hy };
}

/** `p` in the ellipse's own coordinates (the unit circle is the ellipse); null for a flat box. */
export function ellipseLocal(f: EllipseFrame, p: Point): Point | null {
  const det = f.u.x * f.v.y - f.v.x * f.u.y;
  if (Math.abs(det) < 1e-12) return null;
  const dx = p.x - f.centre.x;
  const dy = p.y - f.centre.y;
  return { x: (dx * f.v.y - f.v.x * dy) / det, y: (f.u.x * dy - dx * f.u.y) / det };
}

/** One cloud arc: a half circle on a chord, for `CanvasRenderingContext2D.arc` (angles as atan2 in the same coordinates). */
export type CloudArc = { centre: Point; radius: number; start: number; end: number; anticlockwise: boolean };

/** Twice the ring's signed area (its orientation). */
function signedArea2(ring: readonly Point[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return a;
}

/**
 * The arcs along the closed ring's edges: each edge split into whole chords of about `chord`
 * (at least one), each a half circle bulging out of the ring. Edges of no length have none.
 */
export function cloudArcs(ring: readonly Point[], chord: number): CloudArc[] {
  if (ring.length < 2 || !(chord > 0)) return [];
  // Outward is the right of each edge for a positive (anticlockwise in y-up terms) ring.
  const sign = signedArea2(ring) >= 0 ? 1 : -1;
  const arcs: CloudArc[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    const n = Math.max(1, Math.round(length / chord));
    const dx = (b.x - a.x) / n;
    const dy = (b.y - a.y) / n;
    const out = { x: sign * dy, y: -sign * dx };
    for (let k = 0; k < n; k++) {
      const s = { x: a.x + k * dx, y: a.y + k * dy };
      const centre = { x: s.x + dx / 2, y: s.y + dy / 2 };
      const start = Math.atan2(s.y - centre.y, s.x - centre.x);
      // Increasing the angle from the start turns (x, y) towards (-y, x): outward or not.
      const turn = { x: -(s.y - centre.y), y: s.x - centre.x };
      arcs.push({ centre, radius: Math.hypot(dx, dy) / 2, start, end: start + Math.PI, anticlockwise: turn.x * out.x + turn.y * out.y < 0 });
    }
  }
  return arcs;
}
