// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLICK_SLOP,
  ViewerInput,
  WHEEL_LINE_PX,
  cursorFor,
  normalizeWheel,
  resolveViewerKey,
  wheelZoomFactor,
  type ViewerInputTarget,
} from "./viewer-input";
import { openDocument, resetViewer, setTempPan, setTool, viewerStore } from "./viewer-store";

const key = (init: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...init }) as KeyboardEvent;
const FOCUSED = { canvasFocused: true, pointerOver: false };
const OVER = { canvasFocused: false, pointerOver: true };
const ELSEWHERE = { canvasFocused: false, pointerOver: false };

describe("normalizeWheel", () => {
  it("converts lines and pages to px", () => {
    expect(normalizeWheel({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false }, 800)).toEqual({ dx: 0, dy: 3 * WHEEL_LINE_PX });
    expect(normalizeWheel({ deltaX: 1, deltaY: 0, deltaMode: 2, shiftKey: false }, 800)).toEqual({ dx: 800, dy: 0 });
    expect(normalizeWheel({ deltaX: 5, deltaY: -7, deltaMode: 0, shiftKey: false }, 800)).toEqual({ dx: 5, dy: -7 });
  });

  it("Shift turns a vertical wheel horizontal (unless the browser already did)", () => {
    expect(normalizeWheel({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true }, 800)).toEqual({ dx: 100, dy: 0 });
    expect(normalizeWheel({ deltaX: 100, deltaY: 0, deltaMode: 0, shiftKey: true }, 800)).toEqual({ dx: 100, dy: 0 });
  });

  it("Ctrl+wheel: one notch is one √2 step, up zooms in, extreme deltas are capped", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.SQRT2, 12);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(wheelZoomFactor(2)).toBeGreaterThan(0.98); // a pinch step is small
    expect(wheelZoomFactor(-10_000)).toBeCloseTo(4, 12);
  });
});

describe("resolveViewerKey (focus rule)", () => {
  it("single keys act only while the canvas has focus", () => {
    expect(resolveViewerKey(key({ key: "+" }), FOCUSED)).toEqual({ type: "zoom-in" });
    expect(resolveViewerKey(key({ key: "=" }), FOCUSED)).toEqual({ type: "zoom-in" });
    expect(resolveViewerKey(key({ key: "+", shiftKey: true }), FOCUSED)).toEqual({ type: "zoom-in" });
    expect(resolveViewerKey(key({ key: "-" }), FOCUSED)).toEqual({ type: "zoom-out" });
    expect(resolveViewerKey(key({ key: "z", code: "KeyZ" }), FOCUSED)).toEqual({ type: "tool", tool: "zoom" });
    expect(resolveViewerKey(key({ key: "v", code: "KeyV" }), FOCUSED)).toEqual({ type: "tool", tool: "select" });
    expect(resolveViewerKey(key({ key: "V", code: "KeyV", shiftKey: true }), FOCUSED)).toEqual({ type: "tool", tool: "pan" });
    expect(resolveViewerKey(key({ key: " ", code: "Space" }), FOCUSED)).toEqual({ type: "temp-pan" });
    for (const k of [{ key: "+" }, { key: "-" }, { key: "z", code: "KeyZ" }, { key: "v", code: "KeyV" }, { key: " ", code: "Space" }]) {
      expect(resolveViewerKey(key(k), OVER)).toBeNull();
      expect(resolveViewerKey(key(k), ELSEWHERE)).toBeNull();
    }
  });

  it("Ctrl+9 / Ctrl+0 act with focus or pointer over the canvas, never elsewhere", () => {
    expect(resolveViewerKey(key({ key: "9", code: "Digit9", ctrlKey: true }), FOCUSED)).toEqual({ type: "fit-page" });
    expect(resolveViewerKey(key({ key: "0", code: "Digit0", ctrlKey: true }), OVER)).toEqual({ type: "fit-width" });
    expect(resolveViewerKey(key({ key: "0", code: "Numpad0", metaKey: true }), OVER)).toEqual({ type: "fit-width" });
    expect(resolveViewerKey(key({ key: "0", code: "Digit0", ctrlKey: true }), ELSEWHERE)).toBeNull();
    expect(resolveViewerKey(key({ key: "0", code: "Digit0", ctrlKey: true, shiftKey: true }), FOCUSED)).toBeNull();
  });

  it("ignores modifier mixes, other letters and composition", () => {
    expect(resolveViewerKey(key({ key: "z", code: "KeyZ", ctrlKey: true }), FOCUSED)).toBeNull(); // Ctrl+Z is Undo
    expect(resolveViewerKey(key({ key: "v", code: "KeyV", altKey: true }), FOCUSED)).toBeNull();
    expect(resolveViewerKey(key({ key: "Z", code: "KeyZ", shiftKey: true }), FOCUSED)).toBeNull();
    expect(resolveViewerKey(key({ key: "q", code: "KeyQ" }), FOCUSED)).toBeNull();
    expect(resolveViewerKey(key({ key: "+", isComposing: true }), FOCUSED)).toBeNull();
    // Non-Latin layouts fall back to the key position.
    expect(resolveViewerKey(key({ key: "м", code: "KeyV" }), FOCUSED)).toEqual({ type: "tool", tool: "select" });
  });
});

describe("cursorFor", () => {
  it("shows the tool cursor, grab while panning and grabbing while dragging", () => {
    expect(cursorFor({ tool: "select", tempPan: false, dragging: false, zoomOut: false })).toBe("default");
    expect(cursorFor({ tool: "select", tempPan: true, dragging: false, zoomOut: false })).toBe("grab");
    expect(cursorFor({ tool: "select", tempPan: true, dragging: true, zoomOut: false })).toBe("grabbing");
    expect(cursorFor({ tool: "pan", tempPan: false, dragging: false, zoomOut: false })).toBe("grab");
    expect(cursorFor({ tool: "zoom", tempPan: false, dragging: false, zoomOut: false })).toBe("zoom-in");
    expect(cursorFor({ tool: "zoom", tempPan: false, dragging: false, zoomOut: true })).toBe("zoom-out");
    expect(cursorFor({ tool: "zoom", tempPan: true, dragging: false, zoomOut: false })).toBe("grab");
    expect(cursorFor({ tool: "select", tempPan: false, dragging: true, zoomOut: false })).toBe("grabbing"); // middle drag
  });
});

describe("viewer store tool transitions", () => {
  beforeEach(() => resetViewer());

  it("Space's temporary pan restores the tool; the tool survives a new document", () => {
    setTool("zoom");
    setTempPan(true);
    expect(viewerStore.getState()).toMatchObject({ tool: "zoom", tempPan: true });
    setTempPan(false);
    expect(viewerStore.getState()).toMatchObject({ tool: "zoom", tempPan: false });
    openDocument(new File(["%PDF"], "a.pdf"));
    expect(viewerStore.getState().tool).toBe("zoom");
  });
});

function target(): ViewerInputTarget & Record<string, ReturnType<typeof vi.fn>> {
  return {
    zoomBy: vi.fn(),
    zoomStep: vi.fn(),
    panBy: vi.fn(),
    zoomToRect: vi.fn(),
    setZoomRect: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
  };
}

function pointer(type: string, init: { x: number; y: number; button?: number; altKey?: boolean }) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, button: init.button ?? 0, altKey: init.altKey });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

describe("ViewerInput", () => {
  let canvas: HTMLCanvasElement;
  let t: ReturnType<typeof target>;
  let input: ViewerInput;

  beforeEach(() => {
    resetViewer();
    viewerStore.setState({ status: "ready", pageCount: 1, tool: "select", tempPan: false });
    canvas = document.createElement("canvas");
    canvas.tabIndex = 0;
    document.body.append(canvas);
    t = target();
    input = new ViewerInput(canvas, t);
  });
  afterEach(() => {
    input.detach();
    canvas.remove();
  });

  it("wheel pans, Shift+wheel pans sideways, Ctrl+wheel zooms at the cursor (and prevents the page default)", () => {
    const wheel = (init: WheelEventInit) => {
      const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 30, clientY: 40, ...init });
      canvas.dispatchEvent(e);
      return e;
    };
    expect(wheel({ deltaY: 50 }).defaultPrevented).toBe(true);
    expect(t.panBy).toHaveBeenLastCalledWith(-0, -50);
    wheel({ deltaY: 50, shiftKey: true });
    expect(t.panBy).toHaveBeenLastCalledWith(-50, -0);
    wheel({ deltaY: -100, ctrlKey: true });
    expect(t.zoomBy).toHaveBeenCalledWith(expect.closeTo(Math.SQRT2, 9), { x: 30, y: 40 });
  });

  it("does nothing without a document", () => {
    viewerStore.setState({ status: "empty", pageCount: 0 });
    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 }));
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    expect(t.panBy).not.toHaveBeenCalled();
    expect(t.zoomStep).not.toHaveBeenCalled();
  });

  it("hold Space and drag pans without leaving the tool; releasing Space restores the cursor", () => {
    setTool("zoom");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    expect(viewerStore.getState()).toMatchObject({ tool: "zoom", tempPan: true });
    expect(canvas.style.cursor).toBe("grab");
    canvas.dispatchEvent(pointer("pointerdown", { x: 10, y: 10 }));
    expect(canvas.style.cursor).toBe("grabbing");
    canvas.dispatchEvent(pointer("pointermove", { x: 25, y: 4 }));
    expect(t.panBy).toHaveBeenLastCalledWith(15, -6);
    canvas.dispatchEvent(pointer("pointerup", { x: 25, y: 4 }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
    expect(viewerStore.getState()).toMatchObject({ tool: "zoom", tempPan: false });
    expect(canvas.style.cursor).toBe("zoom-in");
    expect(t.zoomStep).not.toHaveBeenCalled();
  });

  it("middle-button drag pans with any tool", () => {
    canvas.dispatchEvent(pointer("pointerdown", { x: 0, y: 0, button: 1 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 7 }));
    canvas.dispatchEvent(pointer("pointerup", { x: 5, y: 7, button: 1 }));
    expect(t.panBy).toHaveBeenCalledWith(5, 7);
  });

  it("Pan tool: left drag pans; Select: left drag does nothing yet", () => {
    canvas.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 7 }));
    expect(t.panBy).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointer("pointerup", { x: 5, y: 7 }));
    setTool("pan");
    canvas.dispatchEvent(pointer("pointerdown", { x: 0, y: 0 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 7 }));
    expect(t.panBy).toHaveBeenCalledWith(5, 7);
  });

  it("Zoom tool: click zooms in, Alt+click out, a drag zooms to the rectangle", () => {
    setTool("zoom");
    canvas.dispatchEvent(pointer("pointerdown", { x: 50, y: 60 }));
    canvas.dispatchEvent(pointer("pointerup", { x: 51, y: 60 }));
    expect(t.zoomStep).toHaveBeenLastCalledWith(1, { x: 50, y: 60 });
    canvas.dispatchEvent(pointer("pointerdown", { x: 50, y: 60, altKey: true }));
    canvas.dispatchEvent(pointer("pointerup", { x: 50, y: 60 }));
    expect(t.zoomStep).toHaveBeenLastCalledWith(-1, { x: 50, y: 60 });
    canvas.dispatchEvent(pointer("pointerdown", { x: 100, y: 100 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 40, y: 130 }));
    expect(t.setZoomRect).toHaveBeenLastCalledWith({ x: 40, y: 100, width: 60, height: 30 });
    canvas.dispatchEvent(pointer("pointerup", { x: 40, y: 100 + CLICK_SLOP + 30 }));
    expect(t.zoomToRect).toHaveBeenCalledWith({ x: 40, y: 100, width: 60, height: 30 + CLICK_SLOP });
    expect(t.setZoomRect).toHaveBeenLastCalledWith(null);
  });

  it("keys: +/- zoom at the pointer when it is over the canvas, V/Shift+V/Z pick tools, Ctrl+0 fits width", () => {
    canvas.focus();
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      window.dispatchEvent(e);
      return e;
    };
    press({ key: "+" });
    expect(t.zoomStep).toHaveBeenLastCalledWith(1, undefined); // viewport centre
    canvas.dispatchEvent(pointer("pointermove", { x: 12, y: 34 }));
    press({ key: "-" });
    expect(t.zoomStep).toHaveBeenLastCalledWith(-1, { x: 12, y: 34 });
    press({ key: "V", code: "KeyV", shiftKey: true });
    expect(viewerStore.getState().tool).toBe("pan");
    press({ key: "z", code: "KeyZ" });
    expect(viewerStore.getState().tool).toBe("zoom");
    press({ key: "v", code: "KeyV" });
    expect(viewerStore.getState().tool).toBe("select");
    expect(press({ key: "0", code: "Digit0", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(t.fitWidth).toHaveBeenCalledTimes(1);
    expect(press({ key: "9", code: "Digit9", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(t.fitPage).toHaveBeenCalledTimes(1);
  });

  it("outside the canvas the browser keeps Ctrl+0 and single keys", () => {
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    const e = new KeyboardEvent("keydown", { key: "0", code: "Digit0", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true, cancelable: true }));
    expect(e.defaultPrevented).toBe(false);
    expect(t.fitWidth).not.toHaveBeenCalled();
    expect(t.zoomStep).not.toHaveBeenCalled();
    other.remove();
  });
});
