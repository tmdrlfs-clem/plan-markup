// The viewer's markup layers (Story 4.5, AR10): the viewer paints layer 2
// (static markups) and the drawing part of layer 3 (the tool in progress)
// through one registered painter, and passes a measuring tool's clicks and Esc
// to it. The editor feature registers it, so the viewer never imports the
// editor (the dependency points the other way).

import type { PageText } from "@/core/markup/text-select";

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
  /** `selection`: the selected markups' outline (Story 4.11, UX-DR13). */
  colors: { halo: string; warning: string; selection: string; fontFamily: string };
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

/** Story 5.1: where a Select gesture works, as the engine sees it. */
export type SelectContext = {
  documentId: string;
  pageIndex: number;
  view: LayerView;
  /** The pointer in canvas device px (captions are hit there). */
  device: Point;
  /** One CSS px in user units at this zoom. */
  px: number;
  /** The hit tolerance in user units. */
  tolerance: number;
  shift: boolean;
  alt: boolean;
  /** Story 5.2: Ctrl (or Cmd) + drag copies. */
  ctrl: boolean;
};
/** Story 5.1: a selection key: Delete / Backspace, an arrow's nudge (user space) and its release, Ctrl+A. */
export type SelectionKey =
  | { kind: "delete" }
  | { kind: "nudge"; dx: number; dy: number }
  | { kind: "nudge-end" }
  | { kind: "all" }
  // Story 5.2: Ctrl+C; Ctrl+V at `at` (user space), Ctrl+Shift+V in place.
  | { kind: "copy" }
  | { kind: "paste"; inPlace: boolean; at: Point }
  // Story 5.3: Ctrl+G / Ctrl+Shift+G, the drawing order, align, lock / unlock.
  | { kind: "group" }
  | { kind: "ungroup" }
  | { kind: "order"; step: "front" | "forward" | "backward" | "back" }
  | { kind: "align"; to: "left" | "centre" | "right" | "top" | "middle" | "bottom" }
  | { kind: "lock"; locked: boolean };

/** Story 5.3: the cursor over a locked markup with Select, and the canvas's tooltip with it. */
export const LOCKED_CURSOR = "not-allowed";
export const LOCKED_TOOLTIP = "Locked: right-click to unlock";

/**
 * Story 5.3: a selection command as the keys, the menus and the context menu name it (the
 * engine turns it into a SelectionKey on the shown page); a nudge in screen px.
 */
export type SelectionCommand =
  | "delete"
  | "all"
  | "nudge-end"
  | "copy"
  | "paste"
  | "paste-in-place"
  | "group"
  | "ungroup"
  | "lock"
  | "unlock"
  | "order:front"
  | "order:forward"
  | "order:backward"
  | "order:back"
  | "align:left"
  | "align:centre"
  | "align:right"
  | "align:top"
  | "align:middle"
  | "align:bottom"
  | { dx: number; dy: number };

export interface MarkupPainter {
  /** Layer 2: the page's markups. Returns the captions drawn, in drawing order (e2e, diagnostics). */
  paintStatic(c: CanvasRenderingContext2D, view: LayerView): readonly string[];
  /**
   * Story 5.7: under layer 2, a layer multiplied over the sheet: the page's highlights (layer 2
   * lists them and draws their selection, not their strokes).
   */
  paintUnder?(c: CanvasRenderingContext2D, view: LayerView): void;
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
  /**
   * Story 5.7: a Pen or Highlight stroke's press, drag, release or cancel at `point` (user
   * space); `straight`: Shift holds this part of it straight (the input has held the point).
   */
  ink?(phase: "start" | "move" | "end" | "cancel", point: Point, at: { documentId: string; pageIndex: number; view: LayerView }, straight: boolean): void;
  /**
   * Story 5.9: an Underline or Strikethrough drag's press, move, release or cancel at `point` (user
   * space); `text`: the page's text in user space, null while it is still being read (or there is none).
   */
  textMark?(phase: "start" | "move" | "end" | "cancel", point: Point, at: { documentId: string; pageIndex: number; view: LayerView; text: PageText | null }): void;
  /** Story 5.1: a Select press, drag, release or cancel at `point` (user space). */
  select?(phase: "start" | "move" | "end" | "cancel", point: Point, at: SelectContext): void;
  /** Story 5.1 / 5.2: the cursor at `point` with Select (a markup: move; a handle: its action); null: the default. */
  cursorAt?(point: Point, at: SelectContext): string | null;
  /** Story 5.1: a selection key on the shown page (5.3: as shown in `view`, for align); true when it acted. */
  selectionKey?(key: SelectionKey, at: { documentId: string; pageIndex: number; view?: LayerView }): boolean;
  /**
   * Story 5.3: a right-click (or the menu key: `keyboard`, nothing is hit) at `point` with Select:
   * selects what is under it as needed and opens the context menu at `client` (viewport CSS px of
   * the window); true when it opened.
   */
  contextMenu?(point: Point, at: SelectContext, client: Point, keyboard: boolean): boolean;
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
