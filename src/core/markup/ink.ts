// Freehand strokes (Story 5.7, FR31): Pen and Highlight. Framework-free.
//
// A stroke is captured as the pointer moves, simplified when it ends
// (Douglas–Peucker within a fraction of a screen pixel) and painted smoothed
// through its points (quadratic curves through the midpoints). Shift holds a
// part of the stroke straight, horizontal or vertical on screen, from where
// Shift was pressed (or the stroke's start).

type Point = { x: number; y: number };

/** The point `p` held horizontal or vertical from `anchor` (screen space): along whichever it is nearer. */
export function straightFrom(anchor: Point, p: Point): Point {
  return Math.abs(p.x - anchor.x) >= Math.abs(p.y - anchor.y) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The stroke's points within `tol` of it (Douglas–Peucker), its ends kept; repeated points dropped. */
export function simplifyStroke(points: readonly Point[], tol: number): Point[] {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  // An explicit stack: a long stroke would overflow a recursive one.
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(pts[i], pts[from], pts[to]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > tol) {
      keep[at] = 1;
      stack.push([from, at], [at, to]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1).map((p) => ({ ...p }));
}

/** Whether a stroke has any length (a click, or a press that never moved, has none). */
export function strokeHasLength(points: readonly Point[]): boolean {
  return points.some((p) => p.x !== points[0].x || p.y !== points[0].y);
}

/**
 * The smoothed path through a stroke's points: it starts at the first point, runs through the
 * midpoints of its segments with each inner point as the control point, and ends at the last.
 */
export function smoothPath(points: readonly Point[]): { start: Point; curves: { control: Point; to: Point }[] } | null {
  if (points.length < 2) return null;
  const curves: { control: Point; to: Point }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    curves.push({ control: p, to: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } });
  }
  const last = points[points.length - 1];
  curves.push({ control: last, to: last });
  return { start: points[0], curves };
}
