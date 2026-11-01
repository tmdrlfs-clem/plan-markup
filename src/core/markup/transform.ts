// Markup transforms (Story 5.2, FR33). Framework-free.
//
// Resize scales about an anchor, rotate turns about a centre, a vertex edit
// moves one point; all in the markup's page user space. Caption offsets are
// relative: a resize keeps them, a rotation turns them with the markup.
// Copies get new ids, the target page and a new creation time.

import type { Markup } from "@/core/schema/markup";

import type { Point, Rect } from "./geometry";

type Transform = (p: Point) => Point;

/** `m` with every point (an area's holes too) mapped by `f`, its caption offset by `offset`. */
export function transformMarkup<M extends Markup>(m: M, f: Transform, offset?: Transform): M {
  const out = { ...m, points: m.points.map(f) } as M;
  if (m.type === "area" && m.holes) (out as Extract<Markup, { type: "area" }>).holes = m.holes.map((h) => h.map(f));
  if (offset && "captionOffset" in m && m.captionOffset) (out as { captionOffset?: Point }).captionOffset = offset(m.captionOffset);
  return out;
}

/** Scales about `anchor` by `sx`, `sy`. */
export function scaleAbout(anchor: Point, sx: number, sy: number): Transform {
  return (p) => ({ x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy });
}

/** Turns by `radians` (anticlockwise in user space) about `centre`. */
export function rotateAbout(centre: Point, radians: number): Transform {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return (p) => {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
  };
}

/** The same turn for a relative vector (a caption offset). */
export function rotateVector(radians: number): Transform {
  return rotateAbout({ x: 0, y: 0 }, radians);
}

/** `m` with vertex `index` of its points (an area's outline, a count's marker) at `p`. */
export function setVertex<M extends Markup>(m: M, index: number, p: Point): M {
  if (index < 0 || index >= m.points.length) return m;
  return { ...m, points: m.points.map((q, i) => (i === index ? { x: p.x, y: p.y } : q)) } as M;
}

/** A resize handle as a position on the box (0, 0.5 or 1 along x and y; the box's y grows upward in user space). */
export type HandleAt = { u: number; v: number };

/** The point of the box at handle position `h`. */
export function boxPoint(box: Rect, h: HandleAt): Point {
  return { x: box.x + h.u * box.width, y: box.y + h.v * box.height };
}

/**
 * The scale of a resize: handle `h` of `box` dragged to `p`. The anchor is the opposite
 * handle (`fromCentre`: the centre); an edge handle scales one axis; `proportional` uses one
 * factor for both (the larger change of a corner, the dragged axis of an edge).
 */
export function resizeOf(box: Rect, h: HandleAt, p: Point, proportional: boolean, fromCentre: boolean): { anchor: Point; sx: number; sy: number } {
  const anchor = fromCentre ? boxPoint(box, { u: 0.5, v: 0.5 }) : boxPoint(box, { u: 1 - h.u, v: 1 - h.v });
  const from = boxPoint(box, h);
  const factor = (to: number, at: number, a: number) => (Math.abs(at - a) > 1e-9 ? (to - a) / (at - a) : 1);
  let sx = h.u === 0.5 ? 1 : factor(p.x, from.x, anchor.x);
  let sy = h.v === 0.5 ? 1 : factor(p.y, from.y, anchor.y);
  if (proportional) {
    if (h.u === 0.5) sx = Math.abs(sy);
    else if (h.v === 0.5) sy = Math.abs(sx);
    else {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = Math.sign(sx || 1) * s;
      sy = Math.sign(sy || 1) * s;
    }
  }
  return { anchor, sx, sy };
}

/** The turn from `start` to `p` about `centre`, in whole steps of `stepDeg` degrees (radians). */
export function rotationOf(centre: Point, start: Point, p: Point, stepDeg: number): number {
  const a = Math.atan2(p.y - centre.y, p.x - centre.x) - Math.atan2(start.y - centre.y, start.x - centre.x);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(a / step) * step;
  // Within (-180°, 180°].
  return Math.atan2(Math.sin(snapped), Math.cos(snapped));
}

/** `d` held to the nearest of the 0°, 45°, 90° … directions (its length along it). */
export function constrain45(d: Point): Point {
  const len = Math.hypot(d.x, d.y);
  if (len === 0) return d;
  const step = Math.PI / 4;
  const a = Math.round(Math.atan2(d.y, d.x) / step) * step;
  const along = d.x * Math.cos(a) + d.y * Math.sin(a);
  const x = along * Math.cos(a);
  const y = along * Math.sin(a);
  return { x: Math.abs(x) < 1e-12 ? 0 : x, y: Math.abs(y) < 1e-12 ? 0 : y };
}

/** Copies of `markups` moved by `d` onto page `pageId`, each with a new id from `newId` and `createdAt`. */
export function copiesOf(markups: readonly Markup[], d: Point, pageId: string, newId: () => string, createdAt: string): Markup[] {
  const move: Transform = (p) => ({ x: p.x + d.x, y: p.y + d.y });
  // Story 5.3 (D5): copies are unlocked; a copied group becomes a new group (its id from the first copy's).
  const groups = new Map<string, string>();
  return markups.map((m) => {
    const id = newId();
    const { locked: _locked, groupId, ...rest } = transformMarkup(m, move);
    void _locked;
    if (groupId && !groups.has(groupId)) groups.set(groupId, id);
    return { ...rest, id, pageId, createdAt, ...(groupId ? { groupId: groups.get(groupId) } : {}) } as Markup;
  });
}
