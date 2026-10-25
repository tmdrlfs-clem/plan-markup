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
  colors: { halo: string; warning: string; fontFamily: string };
};

export interface MarkupPainter {
  /** Layer 2: the page's markups. Returns the captions drawn, in drawing order (e2e, diagnostics). */
  paintStatic(c: CanvasRenderingContext2D, view: LayerView): readonly string[];
  /** Layer 3: the drawing in progress, its rubber band to `pointer` (the tool point) and its live value. Returns the live text. */
  paintActive(c: CanvasRenderingContext2D, view: LayerView, pointer: Point | null): string | null;
  /** A drawing follows the pointer (the overlay repaints on every move). */
  readonly tracking: boolean;
  /** A measuring tool's click at `point` (user space): "continue" while drawing, "done" when a markup was added. */
  place(point: Point, at: { documentId: string; pageIndex: number }): "continue" | "done" | "ignored";
  /** Esc: true when it cancelled a drawing (Esc again leaves the tool). */
  escape(): boolean;
}

export type MarkupChange = { drawingEnded?: boolean };
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
