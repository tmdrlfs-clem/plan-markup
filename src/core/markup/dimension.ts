// Dimension markups (Story 5.8, FR31). Framework-free.
//
// A dimension is its two measured points and a third that sets the dimension
// line's offset: the line runs parallel to the measured points through the
// third point's projection on their normal; extension lines run from the
// measured points out to it (and a little past).

type Point = { x: number; y: number };

/**
 * The dimension line (from `a` and `b` moved by the offset), the unit normal toward the offset
 * (the left of a→b when there is none) and the offset's signed length; null when `a` and `b` meet.
 */
export function dimensionLine(a: Point, b: Point, c: Point): { from: Point; to: Point; normal: Point; offset: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const left = { x: -dy / length, y: dx / length };
  const along = (c.x - a.x) * left.x + (c.y - a.y) * left.y;
  const normal = along < 0 ? { x: -left.x, y: -left.y } : left;
  const offset = Math.abs(along);
  return {
    from: { x: a.x + normal.x * offset, y: a.y + normal.y * offset },
    to: { x: b.x + normal.x * offset, y: b.y + normal.y * offset },
    normal,
    offset,
  };
}

/** The dimension's outline: its measured points and its line's ends (selection, bounds). */
export function dimensionOutline(points: readonly Point[]): Point[] {
  const [a, b, c] = points;
  const line = dimensionLine(a, b, c);
  return line ? [a, b, line.to, line.from] : [a, b];
}
