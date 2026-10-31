// The viewer's markup layers (Story 4.5, AR10): the viewer paints layer 2
// (static markups) and the drawing part of layer 3 (the tool in progress)
// through one registered painter, and passes a measuring tool's clicks and Esc
// to it. The editor feature registers it, so the viewer never imports the
// editor (the dependency points the other way).

type Point = { x: number; y: number };

/** What a painter needs to draw a page's markups on a canvas. */
export type LayerView = {
  documentId: string;
  pageIndex: number;
  /** The page's UserUnit (1 when the page has none). */
  userUnit: number;
  /** User space → canvas device px (page box, UserUnit, zoom, view rotation, device pixel ratio). */
  toDevice(p: Point): Point;
  /** Device px per page point (PDF point with UserUnit applied) at this zoom: page-unit sizes. */
  devicePerPt: number;
  /** Device pixel ratio (screen-unit sizes, such as the live label). */
  dpr: number;
  /** The canvas in device px: markups wholly outside it are not drawn (review R6). */
  width: number;
  height: number;
  colors: { halo: string; warning: string; fontFamily: string };
};

/** Story 4.10: where a press-and-hold tool (Dynamic fill) works, as the engine sees it at the press. */
export type PressContext = {
  documentId: string;
  pageIndex: number;
  view: LayerView;
  /** The part of the page in view, in user space. */
  window: { x0: number; y0: number; x1: number; y1: number };
  /** One CSS px in user units at this zoom. */
  cell: number;
  /** The page's linework (x1, y1, x2, y2 per segment, user space); null while it is still being read. */
  segments: { coords: ArrayLike<number>; count: number } | null;
};
/** Story 4.10: what a press does: spread (a plain press), paint (Shift) or erase (Ctrl). */
export type PressBrush = "grow" | "paint" | "erase";

export interface MarkupPainter {
  /** Layer 2: the page's markups. Returns the captions drawn, in drawing order (e2e, diagnostics). */
  paintStatic(c: CanvasRenderingContext2D, view: LayerView): readonly string[];
  /** Layer 3: the drawing in progress, its rubber band to `pointer` (the tool point) and its live value. Returns the live text. */
  paintActive(c: CanvasRenderingContext2D, view: LayerView, pointer: Point | null): string | null;
  /** A drawing follows the pointer (the overlay repaints on every move). */
  readonly tracking: boolean;
  /**
   * A measuring tool's click at `point` (user space): "continue" while drawing, "done" when a
   * markup was added. `tolerance`: user units within which a click repeats the last point
   * (a double-click's second click).
   */
  place(point: Point, at: { documentId: string; pageIndex: number; tolerance: number }): "continue" | "done" | "ignored";
  /** Story 4.6: Enter or a double-click: "done" when it added the markup in progress. */
  finish(): "done" | "ignored";
  /** Story 4.6: Backspace: removes the drawing's last point; false when nothing is drawn. */
  removeLastPoint(): boolean;
  /** The drawing's last point (the "from" point of Shift's 45° steps), if drawing. */
  readonly lastPoint: Point | null;
  /** Esc: true when it cancelled a drawing (Esc again leaves the tool). */
  escape(): boolean;
  /** Story 4.6: the markup whose caption is at `at` (device px) on the page as last painted with `view`, if any. */
  captionAt(view: LayerView, at: Point): string | null;
  /** Story 4.6: previews a caption moved by `delta` (user space) from where it was. */
  dragCaption(id: string, documentId: string, delta: Point): void;
  /** Story 4.6: ends a caption move; `commit` keeps it (one undo step). True when it moved one. */
  endCaptionDrag(commit: boolean): boolean;
  /** Story 4.10: a press-and-hold tool's press, drag and release at `point` (user space). */
  press?(phase: "start" | "move" | "end", point: Point, at: PressContext, brush: PressBrush): void;
}

/** `activeOnly`: only the drawing in progress changed (review 4.10 R2: layer 2 is not painted again). */
export type MarkupChange = { drawingEnded?: boolean; activeOnly?: boolean };
type Listener = (change: MarkupChange) => void;

let painter: MarkupPainter | null = null;
const listeners = new Set<Listener>();

/** Registers the painter (the editor, once); returns the unregister function. */
export function registerMarkupPainter(p: MarkupPainter): () => void {
  painter = p;
  notifyMarkups({});
  return () => {
    if (painter !== p) return;
    painter = null;
    notifyMarkups({ drawingEnded: true });
  };
}

export function markupPainter(): MarkupPainter | null {
  return painter;
}

/** The markups or the drawing changed: the shown engine paints again, synchronously (NFR3). */
export function notifyMarkups(change: MarkupChange): void {
  for (const l of [...listeners]) l(change);
}

/** The engines listen; returns the unsubscribe function. */
export function onMarkupsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
