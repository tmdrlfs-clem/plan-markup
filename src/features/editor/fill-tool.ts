// Dynamic fill (Story 4.10, FR28, NFR5): press and hold inside a room and the
// fill spreads every animation frame, stopped by the drawing's lines (the
// page's snap linework, core/fill) and by the page's Length and Polylength
// measurements (a line across a doorway closes it). Shift + drag paints,
// Ctrl + drag erases; Ctrl+Z / Backspace undo a stroke. Enter turns the fill
// into an area markup (the measure painter adds it); Esc, another tool, page
// or tab discard it. A fill that reaches the edge of the view has leaked: it
// stops and says how to close the room.
//
// The session is the measure painter's "fill" drawing (editorStore's drawing
// slice: the undo label, tracking and the "another tool cancels" rules come
// with it); the fill itself, a grid as big as the view, lives here.

import { toast } from "@/components/ui/toast-store";
import { burnPolyline, burnSegments, cellAt, createGrid } from "@/core/fill/grid";
import { fillRings, type FillRings } from "@/core/fill/polygon";
import { FillSpread, type Dirty } from "@/core/fill/spread";
import { pageIdOf } from "@/core/calibration/calibration";
import { notifyMarkups, type LayerView, type PressBrush, type PressContext } from "@/features/viewer";

import { editorStore, pageMarkups, setDrawing } from "./editor-store";

type Point = { x: number; y: number };

/** NFR5: the spread's radius per frame in CSS px, for the first second of a hold and after it. */
export const SPREAD_PX = { first: 8, after: 24 } as const;
/** D4: the brush's diameter in CSS px. */
export const BRUSH_PX = 18;
/** D5: the fill's colour (the measure colour) at 35 % opacity. */
const FILL_RGBA = [255, 0, 0, 89] as const;

export const FILL_LEAKED =
  "The fill leaked out of the room. Block the opening with a Length line or erase it with Ctrl + drag, or zoom out if the room is bigger than the view. Ctrl+Z undoes the stroke.";
export const FILL_EMPTY = "Nothing is filled yet. Press and hold inside a room.";
export const FILL_NO_LINES = "The drawing's lines are still being read. Try again in a moment.";
export const FILL_OUTSIDE = "This fill covers the view it started in. Press inside it, or Esc to start a fill in this view.";

type Session = {
  pageId: string;
  spread: FillSpread;
  /** CSS px per cell at the zoom the fill started at. */
  cellPx: number;
  image: ImageData | null;
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  pressed: { brush: PressBrush; last: { x: number; y: number }; since: number } | null;
  frame: number | null;
  leakShown: boolean;
};

let session: Session | null = null;

/** Frame scheduling (tests replace it). */
export const fillFrames = {
  request: (cb: () => void): number => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number)),
  cancel: (id: number): void => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id)),
  now: (): number => performance.now(),
};

/** The fill in progress on `pageId` (tests, the painter). */
export function fillOf(pageId: string): FillSpread | null {
  return session && session.pageId === pageId ? session.spread : null;
}

function overlayOf(w: number, h: number): Pick<Session, "canvas" | "image"> {
  try {
    const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const c = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    return c ? { canvas, image: c.createImageData(w, h) } : { canvas: null, image: null };
  } catch {
    return { canvas: null, image: null };
  }
}

/** Starts a fill on the page: the grid over the view, its walls and barriers. Null (with a toast) without linework. */
function start(at: PressContext): Session | null {
  if (!at.segments) {
    toast({ title: FILL_NO_LINES, variant: "info" });
    return null;
  }
  const pageId = pageIdOf(at.documentId, at.pageIndex);
  const grid = createGrid(at.window, at.cell);
  burnSegments(grid, at.segments.coords, at.segments.count);
  // D3: Length and Polylength measurements are barriers.
  for (const m of pageMarkups(editorStore.getState(), at.documentId, pageId)) {
    if (m.type === "length" || m.type === "polylength") burnPolyline(grid, m.points);
  }
  const s: Session = {
    pageId,
    spread: new FillSpread(grid),
    cellPx: grid.cell / at.cell,
    ...overlayOf(grid.w, grid.h),
    pressed: null,
    frame: null,
    leakShown: false,
  };
  setDrawing({ tool: "fill", pageId, pageIndex: at.pageIndex, points: [] });
  return s;
}

/** Copies the changed cells into the overlay image. */
function show(s: Session, dirty: Dirty | null): void {
  if (!dirty || !s.image || !s.canvas) return;
  const { w } = s.spread.grid;
  const data = s.image.data;
  const filled = s.spread.filled;
  for (let y = dirty.y0; y <= dirty.y1; y++) {
    for (let x = dirty.x0; x <= dirty.x1; x++) {
      const i = y * w + x;
      const o = i * 4;
      data[o] = FILL_RGBA[0];
      data[o + 1] = FILL_RGBA[1];
      data[o + 2] = FILL_RGBA[2];
      data[o + 3] = filled[i] ? FILL_RGBA[3] : 0;
    }
  }
  const c = s.canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  c?.putImageData(s.image, 0, 0, dirty.x0, dirty.y0, dirty.x1 - dirty.x0 + 1, dirty.y1 - dirty.y0 + 1);
}

function showAll(s: Session): void {
  const { w, h } = s.spread.grid;
  show(s, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 });
}

function checkLeak(s: Session): void {
  if (s.spread.leaked && !s.leakShown) {
    s.leakShown = true;
    toast({ title: FILL_LEAKED, variant: "warning" });
  }
  if (!s.spread.leaked) s.leakShown = false;
}

/** One frame of a hold: the spread grows by a band (faster after the first second). */
function tick(): void {
  const s = session;
  if (!s) return;
  s.frame = null;
  if (!s.pressed || s.pressed.brush === "erase") return;
  const px = fillFrames.now() - s.pressed.since < 1000 ? SPREAD_PX.first : SPREAD_PX.after;
  show(s, s.spread.step((10 * px) / s.cellPx));
  checkLeak(s);
  notifyMarkups({ activeOnly: true });
  // Frames run while there is something to spread (a drag seeding more starts them again).
  if (s.spread.growing) s.frame = fillFrames.request(tick);
}

function brushAt(s: Session, brush: PressBrush, x: number, y: number): void {
  const r = BRUSH_PX / 2 / s.cellPx;
  show(s, brush === "erase" ? s.spread.erase(x, y, r) : s.spread.paint(x, y, r));
}

/** The viewer's press, drag and release with Dynamic fill (user space). */
export function fillPress(phase: "start" | "move" | "end", point: Point, at: PressContext, brush: PressBrush): void {
  if (phase === "start") {
    const pageId = pageIdOf(at.documentId, at.pageIndex);
    // Review R1: a press outside the grid (the view moved since the fill started) starts an
    // empty fill again in this view; a fill with cells stays and says why.
    const outside = session !== null && cellAt(session.spread.grid, point) === null;
    if (outside && session!.spread.count > 0 && session!.pageId === pageId) {
      toast({ title: FILL_OUTSIDE, variant: "info" });
      return;
    }
    if (!session || session.pageId !== pageId || outside) {
      discardFill();
      session = start(at);
    }
  }
  const s = session;
  if (!s) return;
  const c = cellAt(s.spread.grid, point);
  if (phase === "start") {
    if (!c) return; // outside the view the fill started in
    s.spread.beginStroke(brush);
    s.pressed = { brush, last: c, since: fillFrames.now() };
    if (brush === "grow") s.spread.seed(c.x, c.y);
    else brushAt(s, brush, c.x, c.y);
    checkLeak(s);
    if (s.frame === null) s.frame = fillFrames.request(tick);
  } else if (phase === "move" && s.pressed && c) {
    const { last } = s.pressed;
    if (s.pressed.brush === "grow") s.spread.seedLine(last.x, last.y, c.x, c.y);
    else {
      // The brush along the drag, a step per brush radius.
      const n = Math.max(1, Math.ceil(Math.hypot(c.x - last.x, c.y - last.y) / Math.max(1, BRUSH_PX / 4 / s.cellPx)));
      for (let t = 1; t <= n; t++) brushAt(s, s.pressed.brush, Math.round(last.x + ((c.x - last.x) * t) / n), Math.round(last.y + ((c.y - last.y) * t) / n));
      checkLeak(s);
    }
    s.pressed.last = c;
    if (s.frame === null && s.pressed.brush !== "erase" && s.spread.growing) s.frame = fillFrames.request(tick);
  } else if (phase === "end") {
    s.pressed = null;
    s.spread.endStroke();
    if (s.frame !== null) fillFrames.cancel(s.frame);
    s.frame = null;
  }
  notifyMarkups({ activeOnly: true });
}

/** Ctrl+Z / Backspace while filling: undoes the last stroke; false when there is none. */
export function undoFillStroke(): boolean {
  const s = session;
  if (!s || !s.spread.undoStroke()) return false;
  showAll(s);
  checkLeak(s);
  notifyMarkups({ activeOnly: true });
  return true;
}

/** Ends the fill without an area (Esc, another tool, page or tab). */
export function discardFill(): void {
  const s = session;
  if (!s) return;
  if (s.frame !== null) fillFrames.cancel(s.frame);
  session = null;
  if (editorStore.getState().tools.drawing?.tool === "fill") setDrawing(null);
  notifyMarkups({ drawingEnded: true });
}

/**
 * Enter: the fill as an area's rings (user space) and ends it; null (with a toast) when
 * nothing is filled or it leaked. The caller adds the markup.
 */
export function takeFillRings(): (FillRings & { pageId: string }) | null {
  const s = session;
  if (!s) return null;
  if (s.spread.leaked) {
    toast({ title: FILL_LEAKED, variant: "warning" });
    return null;
  }
  s.spread.endStroke();
  const rings = s.spread.count > 0 ? fillRings(s.spread.grid, s.spread.filled, s.spread.erased) : null;
  if (!rings || rings.outer.length < 3) {
    toast({ title: FILL_EMPTY, variant: "info" });
    return null;
  }
  if (rings.stray > 0) {
    toast({
      title: `${rings.stray} unconnected ${rings.stray === 1 ? "patch was" : "patches were"} left out. Fill it separately, or paint a bridge with Shift + drag.`,
      variant: "info",
    });
  }
  const pageId = s.pageId;
  discardFill();
  return { ...rings, pageId };
}

/** The filled area so far in user units² (null without a fill on the page). */
export function fillAreaUser(pageId: string): number | null {
  const s = session && session.pageId === pageId ? session : null;
  return s ? s.spread.count * s.spread.grid.cell * s.spread.grid.cell : null;
}

/** Layer 3: the fill over the page (each cell where the grid maps it). */
export function paintFill(c: CanvasRenderingContext2D, view: LayerView): void {
  const s = session;
  if (!s || !s.canvas || s.pageId !== pageIdOf(view.documentId, view.pageIndex)) return;
  const g = s.spread.grid;
  const o = view.toDevice({ x: g.x0, y: g.y0 });
  const ex = view.toDevice({ x: g.x0 + g.cell, y: g.y0 });
  const ey = view.toDevice({ x: g.x0, y: g.y0 + g.cell });
  c.save();
  c.imageSmoothingEnabled = false;
  c.setTransform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
  c.drawImage(s.canvas as CanvasImageSource, 0, 0);
  c.restore();
}
