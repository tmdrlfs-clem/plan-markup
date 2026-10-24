// Pointer, wheel and key input of the viewer (Story 3.2, FR20). The pure
// helpers (wheel normalisation, the key map with its focus rule, cursors) are
// unit-tested; ViewerInput wires them to the canvas and the engine.
//
// Focus rule (AC 3): single keys (+ - = Z V Shift+V Space) act only while the
// canvas has focus. So do the page keys (Story 3.3 AC 7): PageDown / PageUp,
// Home / End and Ctrl+→ / Ctrl+← (text fields keep word navigation); repeats
// are allowed, the engine cancels the stale renders. Ctrl+9 / Ctrl+0 act when the canvas has focus or the
// pointer is over it, and then preventDefault so the browser's own zoom reset
// does not run; elsewhere the browser keeps its defaults. Ctrl+wheel is only
// listened to on the canvas. The browser's zoom is suppressed whenever a
// document area is shown (also while it loads or shows a render error); the
// viewer only acts once a page is there.
//
// Zoom tool: click zooms in, Alt+click zooms out (one √2 step about the
// point); a drag zooms the rectangle up to the viewport, an Alt+drag zooms
// out so the current view fits into the rectangle (view.ts zoomOutToRect).

import type { Point, Rect } from "@/core/render/view";

import { hasDocument, setTempPan, setTool, viewerStore, type ViewerTool } from "./viewer-store";

/** CSS px per wheel "line" (deltaMode 1, e.g. Firefox: 3 lines per notch). */
export const WHEEL_LINE_PX = 40;
/** Ctrl+wheel: this many px of wheel delta zoom by one √2 step (one mouse notch ≈ 100 px). */
const WHEEL_PX_PER_STEP = 100;
/** A Zoom-tool drag smaller than this (CSS px) is a click. */
export const CLICK_SLOP = 4;

type WheelLike = Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">;

/** Wheel deltas in CSS px; Shift turns a vertical wheel into a horizontal scroll. */
export function normalizeWheel(event: WheelLike, pageHeight: number): { dx: number; dy: number } {
  const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? pageHeight : 1;
  let dx = event.deltaX * unit;
  let dy = event.deltaY * unit;
  if (event.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return { dx, dy };
}

/** Zoom factor of a Ctrl+wheel (or pinch) delta: wheel up/pinch out zooms in. */
export function wheelZoomFactor(dy: number): number {
  const clamped = Math.max(-4 * WHEEL_PX_PER_STEP, Math.min(4 * WHEEL_PX_PER_STEP, dy));
  return Math.SQRT2 ** (-clamped / WHEEL_PX_PER_STEP);
}

export type ViewerKeyAction =
  | { type: "zoom-in" }
  | { type: "zoom-out" }
  | { type: "fit-page" }
  | { type: "fit-width" }
  | { type: "tool"; tool: ViewerTool }
  | { type: "temp-pan" }
  | { type: "page"; to: "next" | "previous" | "first" | "last" };

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">;

/** The printed letter, or the physical key on layouts without Latin letters. */
function isLetter(event: KeyLike, letter: string): boolean {
  const key = event.key.toLowerCase();
  return /^[a-z]$/.test(key) ? key === letter : event.code === `Key${letter.toUpperCase()}`;
}

function isDigit(event: KeyLike, digit: string): boolean {
  return event.key === digit || event.code === `Digit${digit}` || event.code === `Numpad${digit}`;
}

/** The viewer action of a key press, applying the focus rule; null when it is not ours. */
export function resolveViewerKey(
  event: KeyLike,
  context: { canvasFocused: boolean; pointerOver: boolean },
): ViewerKeyAction | null {
  if (event.isComposing) return null;
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && !event.altKey && !event.shiftKey && (context.canvasFocused || context.pointerOver)) {
    if (isDigit(event, "9")) return { type: "fit-page" };
    if (isDigit(event, "0")) return { type: "fit-width" };
  }
  if (ctrl && !event.altKey && !event.shiftKey && context.canvasFocused) {
    if (event.key === "ArrowRight") return { type: "page", to: "next" };
    if (event.key === "ArrowLeft") return { type: "page", to: "previous" };
  }
  if (ctrl || event.altKey || !context.canvasFocused) return null;
  if (!event.shiftKey) {
    if (event.key === "PageDown") return { type: "page", to: "next" };
    if (event.key === "PageUp") return { type: "page", to: "previous" };
    if (event.key === "Home") return { type: "page", to: "first" };
    if (event.key === "End") return { type: "page", to: "last" };
  }
  if (event.key === "+" || event.key === "=") return { type: "zoom-in" };
  if (event.key === "-") return { type: "zoom-out" };
  if (event.code === "Space" && !event.shiftKey) return { type: "temp-pan" };
  if (isLetter(event, "v")) return { type: "tool", tool: event.shiftKey ? "pan" : "select" };
  if (isLetter(event, "z") && !event.shiftKey) return { type: "tool", tool: "zoom" };
  return null;
}

/** The canvas cursor for the tool state. */
export function cursorFor(state: { tool: ViewerTool; tempPan: boolean; dragging: boolean; zoomOut: boolean }): string {
  if (state.tempPan || state.tool === "pan" || state.dragging) return state.dragging ? "grabbing" : "grab";
  if (state.tool === "length") return "crosshair";
  if (state.tool === "zoom") return state.zoomOut ? "zoom-out" : "zoom-in";
  return "default";
}

/** What the input drives (the ViewerEngine). */
export interface ViewerInputTarget {
  zoomBy(factor: number, at?: Point): void;
  zoomStep(direction: 1 | -1, at?: Point): void;
  panBy(dx: number, dy: number): void;
  zoomToRect(rect: Rect): void;
  zoomOutToRect(rect: Rect): void;
  setZoomRect(rect: Rect | null): void;
  fitPage(): void;
  fitWidth(): void;
  goToPage(index: number): void;
  readonly currentPage: number;
  readonly pageCount: number;
  /**
   * The pointer over the canvas (viewport CSS px) or off it (null): the status bar's X/Y
   * (Story 3.7) and snapping (Story 4.1), with the Alt / Shift state of the move.
   */
  pointerAt?(point: Point | null, modifiers?: SnapModifiers): void;
  /** Story 4.1: Alt or Shift pressed or released without a move. */
  setSnapModifiers?(modifiers: SnapModifiers): void;
  /** Story 4.1: a click with a snapping tool (sets the "from" point); Esc clears it. */
  snapClick?(): void;
  clearSnapFrom?(): void;
}

/** Alt turns snapping off while held; Shift holds the direction from the "from" point at 45° steps. */
export type SnapModifiers = { alt: boolean; shift: boolean };

type Drag =
  | { kind: "pan"; pointerId: number; last: Point }
  | { kind: "zoom"; pointerId: number; start: Point; zoomOut: boolean };

/** Normalised rectangle between two points. */
function rectOf(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Attaches the viewer's pointer, wheel and key handling to `canvas`; `detach()` removes it. */
export class ViewerInput {
  private drag: Drag | null = null;
  private pointer: Point | null = null;
  private altDown = false;
  private readonly removers: (() => void)[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly target: ViewerInputTarget,
    private readonly win: Window = window,
  ) {
    this.on(canvas, "wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.on(canvas, "pointerdown", (e) => this.onPointerDown(e as PointerEvent));
    this.on(canvas, "pointermove", (e) => this.onPointerMove(e as PointerEvent));
    this.on(canvas, "pointerup", (e) => this.onPointerUp(e as PointerEvent));
    // Only the dragging pointer ends the drag (another pointer's cancel must not).
    this.on(canvas, "pointercancel", (e) => this.cancelDrag(e as PointerEvent));
    this.on(canvas, "lostpointercapture", (e) => this.cancelDrag(e as PointerEvent));
    this.on(canvas, "pointerleave", () => {
      if (!this.drag) this.pointer = null;
      this.target.pointerAt?.(null);
    });
    // Middle button: no autoscroll, no paste-on-middle-click.
    this.on(canvas, "mousedown", (e) => {
      if ((e as MouseEvent).button === 1) e.preventDefault();
    });
    this.on(canvas, "auxclick", (e) => {
      if ((e as MouseEvent).button === 1) e.preventDefault();
    });
    this.on(win, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
    this.on(win, "keyup", (e) => this.onKeyUp(e as KeyboardEvent));
    // Focus leaving the canvas (also when the window loses focus) ends Space-pan and drags:
    // their keyup / pointerup may never arrive here.
    this.on(canvas, "focusout", () => {
      setTempPan(false);
      this.altDown = false;
      this.target.setSnapModifiers?.({ alt: false, shift: false });
      this.endDrag(false);
    });
    this.removers.push(viewerStore.subscribe(() => this.updateCursor()));
    this.updateCursor();
  }

  detach(): void {
    for (const remove of this.removers.splice(0)) remove();
    this.target.setZoomRect(null);
  }

  private on(el: EventTarget, type: string, fn: (e: Event) => void, options?: AddEventListenerOptions): void {
    el.addEventListener(type, fn, options);
    this.removers.push(() => el.removeEventListener(type, fn, options));
  }

  /** A page is shown: the viewer acts on input. */
  private active(): boolean {
    return hasDocument(viewerStore.getState());
  }

  /** A document area is shown (loading, ready or failed): browser zoom input is suppressed. */
  private documentArea(): boolean {
    return viewerStore.getState().status !== "empty";
  }

  private point(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private updateCursor(): void {
    const { tool, tempPan } = viewerStore.getState();
    const zoomOut = this.drag?.kind === "zoom" ? this.drag.zoomOut : this.altDown;
    const cursor = cursorFor({ tool, tempPan, dragging: this.drag?.kind === "pan", zoomOut });
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  private onWheel(e: WheelEvent): void {
    const zoom = e.ctrlKey || e.metaKey;
    if (zoom && this.documentArea()) e.preventDefault();
    if (!this.active()) return;
    e.preventDefault();
    const { dx, dy } = normalizeWheel(e, this.canvas.clientHeight || 600);
    if (zoom) this.target.zoomBy(wheelZoomFactor(dy), this.point(e));
    else this.target.panBy(-dx, -dy);
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointer = this.point(e);
    if (!this.active() || this.drag) return;
    const { tool, tempPan } = viewerStore.getState();
    if (e.button === 1 || (e.button === 0 && (tempPan || tool === "pan"))) {
      e.preventDefault();
      this.drag = { kind: "pan", pointerId: e.pointerId, last: this.point(e) };
    } else if (e.button === 0 && tool === "zoom") {
      this.drag = { kind: "zoom", pointerId: e.pointerId, start: this.point(e), zoomOut: e.altKey };
    } else {
      // Story 4.1: a snapping tool's click places its point (the snapped one).
      if (e.button === 0 && tool === "length") {
        this.target.pointerAt?.(this.point(e), { alt: e.altKey, shift: e.shiftKey });
        this.target.snapClick?.();
      }
      return;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers (tests) cannot be captured.
    }
    if (e.button === 1) this.canvas.focus({ preventScroll: true });
    this.updateCursor();
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.point(e);
    this.pointer = p;
    this.target.pointerAt?.(p, { alt: e.altKey, shift: e.shiftKey });
    const drag = this.drag;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "pan") {
      this.target.panBy(p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    } else {
      this.target.setZoomRect(rectOf(drag.start, p));
    }
  }

  private cancelDrag(e: PointerEvent): void {
    if (this.drag && this.drag.pointerId === e.pointerId) this.endDrag(false);
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    this.pointer = this.point(e);
    this.endDrag(true);
  }

  /** Ends a drag; `commit` finishes a Zoom-tool click or rectangle. */
  private endDrag(commit: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.kind === "zoom") {
      this.target.setZoomRect(null);
      const end = this.pointer;
      if (commit && end) {
        const rect = rectOf(drag.start, end);
        if (rect.width < CLICK_SLOP && rect.height < CLICK_SLOP) this.target.zoomStep(drag.zoomOut ? -1 : 1, drag.start);
        else if (drag.zoomOut) this.target.zoomOutToRect(rect);
        else this.target.zoomToRect(rect);
      }
    }
    try {
      if (this.canvas.hasPointerCapture?.(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
    } catch {
      // Not captured.
    }
    this.updateCursor();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Alt" && !this.altDown) {
      this.altDown = true;
      this.updateCursor();
    }
    if (e.key === "Alt" || e.key === "Shift") {
      this.target.setSnapModifiers?.({ alt: e.altKey, shift: e.shiftKey });
      // Alt over the canvas with a snapping tool only suspends snapping: no browser menu.
      if (e.key === "Alt" && this.pointer && viewerStore.getState().tool === "length") e.preventDefault();
    }
    if (e.key === "Escape" && this.active() && viewerStore.getState().tool === "length") this.target.clearSnapFrom?.();
    if (e.defaultPrevented || !this.documentArea()) return;
    const doc = this.canvas.ownerDocument;
    const action = resolveViewerKey(e, {
      canvasFocused: doc.activeElement === this.canvas,
      pointerOver: this.pointer !== null,
    });
    if (!action) return;
    // Over or focused on the document area the browser never zooms, even before the page is there.
    e.preventDefault();
    if (!this.active()) return;
    const at = this.pointer ?? undefined;
    switch (action.type) {
      case "zoom-in":
        return this.target.zoomStep(1, at);
      case "zoom-out":
        return this.target.zoomStep(-1, at);
      case "fit-page":
        if (!e.repeat) this.target.fitPage();
        return;
      case "fit-width":
        if (!e.repeat) this.target.fitWidth();
        return;
      case "tool":
        if (!e.repeat) setTool(action.tool);
        return;
      case "temp-pan":
        setTempPan(true);
        return;
      case "page": {
        const { currentPage, pageCount } = this.target;
        const index =
          action.to === "first" ? 0 : action.to === "last" ? pageCount - 1 : currentPage + (action.to === "next" ? 1 : -1);
        // At the ends the keys do nothing (AC 4); the engine ignores out-of-range pages.
        if (index >= 0 && index < pageCount && index !== currentPage) this.target.goToPage(index);
        return;
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === "Alt") {
      this.altDown = false;
      this.updateCursor();
    }
    if (e.key === "Alt" || e.key === "Shift") this.target.setSnapModifiers?.({ alt: e.altKey, shift: e.shiftKey });
    if (e.code === "Space") setTempPan(false);
  }
}
