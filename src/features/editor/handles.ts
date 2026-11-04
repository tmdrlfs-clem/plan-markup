// Selection handles (Story 5.2, UX-DR13): 8 resize handles on the selection's
// box (set a little outside it, so they never sit on a vertex), a rotate
// handle above its top edge, and with one markup selected a handle on each
// vertex (Story 5.5, D3: not a rectangle's or an ellipse's: a corner drag would
// skew the box; Story 5.6: of a text markup only a callout's tip and a Cloud+'s
// cloud corners). Laid out and hit in canvas device px, painted on layer 2 with the
// selection outline.

import { markupBounds, type Point, type Rect } from "@/core/markup/geometry";
import { boxPoint, type HandleAt } from "@/core/markup/transform";
import type { Markup } from "@/core/schema/markup";
import type { LayerView } from "@/features/viewer";

/** A handle's side, in CSS px (the --canvas-handle-size token's default). */
export const HANDLE_PX = 8;
/** The resize handles sit this far outside the selection's box (CSS px). */
const HANDLE_GAP_PX = 8;
/** The rotate handle sits this far above the box's top edge (CSS px). */
const ROTATE_GAP_PX = 24;
/** A pointer this far from a handle's edge still hits it (CSS px). */
const HANDLE_SLOP_PX = 2;

export type Handle =
  | { kind: "resize"; at: HandleAt; device: Point; cursor: string }
  | { kind: "rotate"; device: Point; cursor: string }
  | { kind: "vertex"; index: number; device: Point; cursor: string };

export type Handles = { box: Rect; handles: Handle[] };

const RESIZE_AT: readonly HandleAt[] = [
  { u: 0, v: 0 },
  { u: 0.5, v: 0 },
  { u: 1, v: 0 },
  { u: 1, v: 0.5 },
  { u: 1, v: 1 },
  { u: 0.5, v: 1 },
  { u: 0, v: 1 },
  { u: 0, v: 0.5 },
];

/** The union of the markups' boxes (user space). */
export function boxOf(markups: readonly Markup[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of markups) {
    const b = markupBounds(m);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The resize cursor of a handle `d` (device px) from the box's device centre `c`. */
function resizeCursor(d: Point, c: Point): string {
  const sx = Math.abs(d.x - c.x) < 1 ? 0 : Math.sign(d.x - c.x);
  const sy = Math.abs(d.y - c.y) < 1 ? 0 : Math.sign(d.y - c.y);
  if (sx === 0) return "ns-resize";
  if (sy === 0) return "ew-resize";
  return sx === sy ? "nwse-resize" : "nesw-resize";
}

/** The handles of the selected markups `markups` (on the painted page, as shown); null without any. */
export function handlesOf(markups: readonly Markup[], view: LayerView): Handles | null {
  if (markups.length === 0) return null;
  const box = boxOf(markups);
  const corners = [boxPoint(box, { u: 0, v: 0 }), boxPoint(box, { u: 1, v: 1 }), boxPoint(box, { u: 0, v: 1 }), boxPoint(box, { u: 1, v: 0 })].map((p) => view.toDevice(p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const d = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const centre = { x: (d.x0 + d.x1) / 2, y: (d.y0 + d.y1) / 2 };
  const handles: Handle[] = [];
  // D2: a box too thin for its handles (a straight line) has none.
  const min = 3 * HANDLE_PX * view.dpr;
  if (d.x1 - d.x0 >= min && d.y1 - d.y0 >= min) {
    const gap = HANDLE_GAP_PX * view.dpr;
    for (const at of RESIZE_AT) {
      const p = view.toDevice(boxPoint(box, at));
      // Out from the centre by the gap, along each axis the handle is off-centre.
      const device = { x: p.x + Math.sign(Math.round(p.x - centre.x)) * gap, y: p.y + Math.sign(Math.round(p.y - centre.y)) * gap };
      handles.push({ kind: "resize", at, device, cursor: resizeCursor(device, centre) });
    }
  }
  // Review R2: a point (one count marker) has nothing to turn.
  if (box.width > 0 || box.height > 0) handles.push({ kind: "rotate", device: { x: centre.x, y: d.y0 - ROTATE_GAP_PX * view.dpr }, cursor: "crosshair" });
  if (markups.length === 1) {
    for (const index of vertexIndices(markups[0])) handles.push({ kind: "vertex", index, device: view.toDevice(markups[0].points[index]), cursor: "crosshair" });
  }
  return { box, handles };
}

/** The points of `m` that get a vertex handle. */
export function vertexIndices(m: Markup): number[] {
  const all = (n: number) => Array.from({ length: n }, (_, i) => i);
  switch (m.type) {
    case "rectangle":
    case "ellipse":
    case "text":
    case "typewriter":
    case "note":
    // Story 5.7: a stroke is moved, resized and rotated whole.
    case "pen":
    case "highlight":
      return [];
    case "callout":
      return [4];
    case "cloudplus":
      return all(m.points.length - 4);
    default:
      return all(m.points.length);
  }
}

/** The handle at device point `p`: vertices first, then rotate, then resize; null when none. */
export function handleAt(h: Handles | null, p: Point, dpr: number): Handle | null {
  if (!h) return null;
  const reach = (HANDLE_PX / 2 + HANDLE_SLOP_PX) * dpr;
  const near = (x: Handle) => Math.abs(x.device.x - p.x) <= reach && Math.abs(x.device.y - p.y) <= reach;
  const order: Handle["kind"][] = ["vertex", "rotate", "resize"];
  for (const kind of order) {
    const found = h.handles.find((x) => x.kind === kind && near(x));
    if (found) return found;
  }
  return null;
}

/** Paints the handles: white squares (a circle for rotate) with an accent border, the rotate stalk. */
export function paintHandles(c: CanvasRenderingContext2D, h: Handles, view: LayerView): void {
  const size = HANDLE_PX * view.dpr;
  c.save();
  c.setLineDash([]);
  c.lineWidth = Math.max(1, view.dpr);
  c.strokeStyle = view.colors.selection;
  c.fillStyle = view.colors.halo;
  const rotate = h.handles.find((x) => x.kind === "rotate");
  if (rotate) {
    c.beginPath();
    c.moveTo(rotate.device.x, rotate.device.y);
    c.lineTo(rotate.device.x, rotate.device.y + (ROTATE_GAP_PX - HANDLE_GAP_PX) * view.dpr);
    c.stroke();
  }
  for (const x of h.handles) {
    if (x.kind === "rotate") {
      c.beginPath();
      c.arc(x.device.x, x.device.y, size / 2, 0, 2 * Math.PI);
      c.fill();
      c.stroke();
    } else {
      c.fillRect(x.device.x - size / 2, x.device.y - size / 2, size, size);
      c.strokeRect(x.device.x - size / 2, x.device.y - size / 2, size, size);
    }
  }
  c.restore();
}
