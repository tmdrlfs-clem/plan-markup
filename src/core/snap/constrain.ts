// Shift constraint (Story 4.1 AC 6). Pure and framework-free.
//
// Holding Shift with a "from" point keeps the direction at a multiple of 45°
// as seen on screen (after the view's rotation): visually horizontal stays
// horizontal whatever the page's /Rotate, the view rotation or the user space.
// The direction is chosen on screen and carried back to user space; snap
// candidates are then projected onto that line.

import type { Point } from "./resolve";

/** The linear part of user space → screen (a, b, c, d as in x' = a x + c y). */
export type Linear = readonly [number, number, number, number];

export type Constraint = { from: Point; /** Unit direction in user space. */ direction: Point };

/** The constraint line through `from` nearest in direction (on screen) to `to`; null when `to` is `from`. */
export function constraintFor(from: Point, to: Point, toScreen: Linear): Constraint | null {
  const [a, b, c, d] = toScreen;
  const ux = to.x - from.x;
  const uy = to.y - from.y;
  // The movement on screen, its angle snapped to 45°.
  const sx = a * ux + c * uy;
  const sy = b * ux + d * uy;
  if (sx === 0 && sy === 0) return null;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(sy, sx) / step) * step;
  const dsx = Math.cos(angle);
  const dsy = Math.sin(angle);
  // Back to user space (inverse of the linear map).
  const det = a * d - b * c;
  if (det === 0) return null;
  const dx = (d * dsx - c * dsy) / det;
  const dy = (-b * dsx + a * dsy) / det;
  const len = Math.hypot(dx, dy);
  return { from, direction: { x: dx / len, y: dy / len } };
}

/** `p` projected onto the constraint line. */
export function projectOnto(constraint: Constraint, p: Point): Point {
  const { from, direction } = constraint;
  const t = (p.x - from.x) * direction.x + (p.y - from.y) * direction.y;
  return { x: from.x + t * direction.x, y: from.y + t * direction.y };
}

/** The cursor held to the nearest 45° direction from `from` (on screen). */
export function constrainPoint(from: Point, to: Point, toScreen: Linear): Point {
  const c = constraintFor(from, to, toScreen);
  return c ? projectOnto(c, to) : to;
}
