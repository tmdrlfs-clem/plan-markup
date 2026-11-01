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
import { LOCKED_TOOLTIP } from "./markup-layer";
import { setTempPan, setTool, viewerStore } from "./viewer-store";
import { openDocument, resetViewer } from "./viewer-tabs";

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
    // Story 4.10: J arms Dynamic fill.
    expect(resolveViewerKey(key({ key: "j", code: "KeyJ" }), FOCUSED)).toEqual({ type: "tool", tool: "fill" });
    expect(resolveViewerKey(key({ key: "j", code: "KeyJ" }), OVER)).toBeNull();
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

function target() {
  const fns: Omit<ViewerInputTarget, "currentPage" | "pageCount"> & Record<string, ReturnType<typeof vi.fn>> = {
    zoomBy: vi.fn(),
    zoomStep: vi.fn(),
    panBy: vi.fn(),
    zoomToRect: vi.fn(),
    zoomOutToRect: vi.fn(),
    setZoomRect: vi.fn(),
    fitPage: vi.fn(),
    fitWidth: vi.fn(),
    goToPage: vi.fn(),
    pointerAt: vi.fn(),
    setSnapModifiers: vi.fn(),
    snapClick: vi.fn(),
    clearSnapFrom: vi.fn(),
  };
  return Object.assign(fns, { currentPage: 0, pageCount: 1 });
}

function pointer(type: string, init: { x: number; y: number; button?: number; altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; pointerId?: number }) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, button: init.button ?? 0, altKey: init.altKey, shiftKey: init.shiftKey, ctrlKey: init.ctrlKey });
  Object.defineProperty(e, "pointerId", { value: init.pointerId ?? 1 });
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

  it("tells the target where the pointer is over the canvas, and when it leaves (status bar X/Y, Story 3.7)", () => {
    canvas.dispatchEvent(pointer("pointermove", { x: 25, y: 4 }));
    expect(t.pointerAt).toHaveBeenLastCalledWith({ x: 25, y: 4 }, { alt: false, shift: false });
    canvas.dispatchEvent(new MouseEvent("pointerleave"));
    expect(t.pointerAt).toHaveBeenLastCalledWith(null);
  });

  it("Story 4.1: passes Alt / Shift with each move and when they change; a Length click places the point; Esc clears it", () => {
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 6, altKey: true, shiftKey: true }));
    expect(t.pointerAt).toHaveBeenLastCalledWith({ x: 5, y: 6 }, { alt: true, shift: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }));
    expect(t.setSnapModifiers).toHaveBeenLastCalledWith({ alt: false, shift: true });
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    expect(t.setSnapModifiers).toHaveBeenLastCalledWith({ alt: false, shift: false });
    // Select: a click places nothing.
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0 }));
    expect(t.snapClick).not.toHaveBeenCalled();
    setTool("length");
    canvas.dispatchEvent(pointer("pointerdown", { x: 7, y: 8, button: 0 }));
    expect(t.snapClick).toHaveBeenCalledTimes(1);
    expect(canvas.style.cursor).toBe("crosshair");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(t.clearSnapFrom).toHaveBeenCalledTimes(1);
    setTool("select");
  });

  it("Story 4.5: Esc with Length goes to the tool, leaving it only when the Esc is the canvas's", () => {
    const escapeTool = vi.fn();
    Object.assign(t, { escapeTool });
    setTool("length");
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(escapeTool).toHaveBeenLastCalledWith(false);
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 6 }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(escapeTool).toHaveBeenLastCalledWith(true);
    expect(t.clearSnapFrom).not.toHaveBeenCalled();
    field.remove();
    setTool("select");
  });

  it("Story 4.11: Esc with Select goes to the painter (clears the selection) only when it is the canvas's", () => {
    const escapeTool = vi.fn();
    Object.assign(t, { escapeTool });
    canvas.dispatchEvent(pointer("pointerleave", { x: 5, y: 6 }));
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(escapeTool).not.toHaveBeenCalled();
    field.remove();
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 6 }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(escapeTool).toHaveBeenCalledWith(false);
  });

  it("Story 4.6: Enter, Backspace and a double-click go to the measuring tool, only when the keys are the canvas's", () => {
    const finishTool = vi.fn(() => true);
    const removeToolPoint = vi.fn(() => true);
    Object.assign(t, { finishTool, removeToolPoint });
    // Select: Enter and Backspace are not the tool's.
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 6 }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(finishTool).not.toHaveBeenCalled();
    setTool("polylength");
    expect(canvas.style.cursor).toBe("crosshair");
    const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    window.dispatchEvent(enter);
    expect(finishTool).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    expect(removeToolPoint).toHaveBeenCalledTimes(1);
    canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    expect(finishTool).toHaveBeenCalledTimes(2);
    // Typing in a field keeps its Backspace and Enter.
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(removeToolPoint).toHaveBeenCalledTimes(1);
    expect(finishTool).toHaveBeenCalledTimes(2);
    field.remove();
    setTool("select");
  });

  it("Story 4.10: Dynamic fill presses, drags and releases (Shift paints, Ctrl erases); it places no point", () => {
    const pressTool = vi.fn();
    Object.assign(t, { pressTool });
    setTool("fill");
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0 }));
    expect(pressTool).toHaveBeenLastCalledWith("start", { x: 5, y: 6 }, "grow");
    expect(t.snapClick).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointer("pointermove", { x: 9, y: 6 }));
    expect(pressTool).toHaveBeenLastCalledWith("move", { x: 9, y: 6 }, "grow");
    canvas.dispatchEvent(pointer("pointerup", { x: 9, y: 6 }));
    expect(pressTool).toHaveBeenLastCalledWith("end", { x: 9, y: 6 }, "grow");
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0, shiftKey: true }));
    expect(pressTool).toHaveBeenLastCalledWith("start", { x: 5, y: 6 }, "paint");
    canvas.dispatchEvent(pointer("pointerup", { x: 5, y: 6 }));
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0, ctrlKey: true }));
    expect(pressTool).toHaveBeenLastCalledWith("start", { x: 5, y: 6 }, "erase");
    canvas.dispatchEvent(pointer("pointerup", { x: 5, y: 6 }));
    // A move without a press is not a stroke.
    pressTool.mockClear();
    canvas.dispatchEvent(pointer("pointermove", { x: 20, y: 20 }));
    expect(pressTool).not.toHaveBeenCalled();
    setTool("select");
  });

  it("Story 4.6: Shift + drag with Select on a caption moves it; Esc puts it back; without a caption nothing happens", () => {
    let onCaption = true;
    const startCaptionDrag = vi.fn(() => onCaption);
    const moveCaptionDrag = vi.fn();
    const endCaptionDrag = vi.fn();
    Object.assign(t, { startCaptionDrag, moveCaptionDrag, endCaptionDrag });
    // Without Shift a Select drag is not a caption's.
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0 }));
    expect(startCaptionDrag).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0, shiftKey: true }));
    expect(startCaptionDrag).toHaveBeenLastCalledWith({ x: 5, y: 6 });
    expect(canvas.style.cursor).toBe("move");
    canvas.dispatchEvent(pointer("pointermove", { x: 15, y: 16, shiftKey: true }));
    expect(moveCaptionDrag).toHaveBeenLastCalledWith({ x: 15, y: 16 });
    canvas.dispatchEvent(pointer("pointerup", { x: 15, y: 16 }));
    expect(endCaptionDrag).toHaveBeenLastCalledWith(true);
    expect(canvas.style.cursor).toBe("default");
    // Esc during the drag: put back.
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0, shiftKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(endCaptionDrag).toHaveBeenLastCalledWith(false);
    canvas.dispatchEvent(pointer("pointermove", { x: 25, y: 26 }));
    expect(moveCaptionDrag).toHaveBeenCalledTimes(1);
    // No caption under the pointer: no drag.
    onCaption = false;
    canvas.dispatchEvent(pointer("pointerdown", { x: 50, y: 60, button: 0, shiftKey: true }));
    canvas.dispatchEvent(pointer("pointerup", { x: 50, y: 60 }));
    expect(endCaptionDrag).toHaveBeenCalledTimes(2);
    // Another tool never starts one.
    onCaption = true;
    setTool("length");
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, button: 0, shiftKey: true }));
    expect(startCaptionDrag).toHaveBeenCalledTimes(3);
    setTool("select");
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

  it("focus leaving the canvas ends a held Space pan", () => {
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    expect(viewerStore.getState().tempPan).toBe(true);
    canvas.blur();
    expect(viewerStore.getState().tempPan).toBe(false);
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

  it("Zoom tool: an Alt+drag zooms out into the rectangle, never in", () => {
    setTool("zoom");
    canvas.dispatchEvent(pointer("pointerdown", { x: 100, y: 100, altKey: true }));
    canvas.dispatchEvent(pointer("pointermove", { x: 160, y: 140 }));
    canvas.dispatchEvent(pointer("pointerup", { x: 160, y: 140 }));
    expect(t.zoomOutToRect).toHaveBeenCalledWith({ x: 100, y: 100, width: 60, height: 40 });
    expect(t.zoomToRect).not.toHaveBeenCalled();
  });

  it("another pointer's pointercancel or lostpointercapture does not end the drag", () => {
    setTool("pan");
    canvas.dispatchEvent(pointer("pointerdown", { x: 0, y: 0, pointerId: 1 }));
    canvas.dispatchEvent(pointer("pointercancel", { x: 0, y: 0, pointerId: 2 }));
    canvas.dispatchEvent(pointer("lostpointercapture", { x: 0, y: 0, pointerId: 2 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 7, pointerId: 1 }));
    expect(t.panBy).toHaveBeenCalledWith(5, 7);
    canvas.dispatchEvent(pointer("pointercancel", { x: 5, y: 7, pointerId: 1 }));
    canvas.dispatchEvent(pointer("pointermove", { x: 9, y: 9, pointerId: 1 }));
    expect(t.panBy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["loading", { status: "loading", pageCount: 0 }],
    ["a render error", { status: "error", pageCount: 1, error: "render-failed" }],
  ] as const)("while %s, Ctrl+wheel, Ctrl+0 and Ctrl+9 never reach the browser but do nothing", (_name, patch) => {
    viewerStore.setState(patch);
    canvas.focus();
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    for (const digit of ["0", "9"]) {
      const e = new KeyboardEvent("keydown", { key: digit, code: `Digit${digit}`, ctrlKey: true, bubbles: true, cancelable: true });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    expect(t.zoomBy).not.toHaveBeenCalled();
    expect(t.fitWidth).not.toHaveBeenCalled();
    expect(t.fitPage).not.toHaveBeenCalled();
  });

  it("with no document the browser keeps Ctrl+wheel", () => {
    viewerStore.setState({ status: "empty", pageCount: 0 });
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
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

  it("page keys act with canvas focus: PageDown/PageUp, Ctrl+→/←, Home/End; nothing at the ends", () => {
    const press = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      window.dispatchEvent(e);
      return e;
    };
    Object.assign(t, { currentPage: 0, pageCount: 4 });
    canvas.focus();
    expect(press({ key: "PageUp" }).defaultPrevented).toBe(true); // ours, but already on page 1
    expect(t.goToPage).not.toHaveBeenCalled();
    press({ key: "PageDown" });
    expect(t.goToPage).toHaveBeenLastCalledWith(1);
    Object.assign(t, { currentPage: 2 });
    press({ key: "ArrowLeft", ctrlKey: true });
    expect(t.goToPage).toHaveBeenLastCalledWith(1);
    press({ key: "ArrowRight", ctrlKey: true, repeat: true });
    expect(t.goToPage).toHaveBeenLastCalledWith(3);
    press({ key: "Home" });
    expect(t.goToPage).toHaveBeenLastCalledWith(0);
    press({ key: "End" });
    expect(t.goToPage).toHaveBeenLastCalledWith(3);
    Object.assign(t, { currentPage: 3 });
    vi.mocked(t.goToPage).mockClear();
    press({ key: "PageDown" });
    press({ key: "End" });
    press({ key: "ArrowRight", ctrlKey: true });
    expect(t.goToPage).not.toHaveBeenCalled();
  });

  it("page keys do nothing without canvas focus (text fields keep Ctrl+arrows and Home/End)", () => {
    Object.assign(t, { currentPage: 1, pageCount: 4 });
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 5 })); // pointer over the canvas is not enough
    for (const init of [{ key: "PageDown" }, { key: "Home" }, { key: "ArrowRight", ctrlKey: true }]) {
      const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      window.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(t.goToPage).not.toHaveBeenCalled();
    field.remove();
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
  it("Story 5.1: Select press / drag / release go to the select gesture with their modifiers; Esc cancels", () => {
    const selectGesture = vi.fn(() => true);
    Object.assign(t, { selectGesture });
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, shiftKey: true }));
    canvas.dispatchEvent(pointer("pointermove", { x: 15, y: 16, shiftKey: true }));
    canvas.dispatchEvent(pointer("pointerup", { x: 15, y: 16 }));
    expect(selectGesture.mock.calls).toEqual([
      ["start", { x: 5, y: 6 }, { shift: true, alt: false, ctrl: false }],
      ["move", { x: 15, y: 16 }, { shift: true, alt: false, ctrl: false }],
      ["end", { x: 15, y: 16 }, { shift: true, alt: false, ctrl: false }],
    ]);
    canvas.dispatchEvent(pointer("pointerdown", { x: 5, y: 6, altKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(selectGesture).toHaveBeenLastCalledWith("cancel", { x: 5, y: 6 }, { shift: false, alt: true, ctrl: false });
  });

  it("Story 5.1: the move cursor over a markup; selection keys only with Select and the canvas's keys", () => {
    const selectCursor = vi.fn(() => "nwse-resize");
    const selectionKey = vi.fn(() => true);
    Object.assign(t, { selectCursor, selectionKey });
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 6 }));
    expect(canvas.style.cursor).toBe("nwse-resize");
    canvas.dispatchEvent(pointer("pointermove", { x: 6, y: 6, ctrlKey: true }));
    expect(selectCursor).toHaveBeenLastCalledWith({ x: 6, y: 6 }, { ctrl: true });
    canvas.focus();
    const key = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
      window.dispatchEvent(e);
      return e;
    };
    expect(key({ key: "Delete" }).defaultPrevented).toBe(true);
    expect(selectionKey).toHaveBeenLastCalledWith("delete");
    key({ key: "ArrowLeft", shiftKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith({ dx: -10, dy: 0 });
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft" }));
    expect(selectionKey).toHaveBeenLastCalledWith("nudge-end");
    expect(key({ key: "a", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(selectionKey).toHaveBeenLastCalledWith("all");
    // Story 5.2: copy, paste, paste in place.
    key({ key: "c", ctrlKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("copy");
    key({ key: "v", ctrlKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("paste");
    key({ key: "V", ctrlKey: true, shiftKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("paste-in-place");
    selectionKey.mockClear();
    setTool("pan");
    key({ key: "Delete" });
    expect(selectionKey).not.toHaveBeenCalled();
    setTool("select");
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    key({ key: "Delete" });
    key({ key: "a", ctrlKey: true });
    // Only the focus leaving the canvas (a held nudge is kept).
    expect(selectionKey.mock.calls).toEqual([["nudge-end"]]);
    field.remove();
  });

  it("Story 5.3: Ctrl+G / Ctrl+Shift+G and the bracket keys (by position); the lock tooltip; the context menu", () => {
    const selectionKey = vi.fn(() => false);
    const selectCursor = vi.fn(() => "not-allowed");
    const selectContextMenu = vi.fn(() => true);
    Object.assign(t, { selectionKey, selectCursor, selectContextMenu });
    canvas.dispatchEvent(pointer("pointermove", { x: 5, y: 6 }));
    expect(canvas.title).toBe(LOCKED_TOOLTIP);
    selectCursor.mockReturnValue("move");
    canvas.dispatchEvent(pointer("pointermove", { x: 7, y: 6 }));
    expect(canvas.title).toBe("");
    canvas.focus();
    const key = (init: KeyboardEventInit) => {
      const e = new KeyboardEvent("keydown", { cancelable: true, ...init });
      window.dispatchEvent(e);
      return e;
    };
    // The browser's find next stays blocked even when nothing is grouped.
    expect(key({ key: "g", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(selectionKey).toHaveBeenLastCalledWith("group");
    key({ key: "G", ctrlKey: true, shiftKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("ungroup");
    key({ key: "}", code: "BracketRight", ctrlKey: true, shiftKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("order:front");
    key({ key: "]", code: "BracketRight", ctrlKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("order:forward");
    key({ key: "[", code: "BracketLeft", ctrlKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("order:backward");
    key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true });
    expect(selectionKey).toHaveBeenLastCalledWith("order:back");
    // A right-click over the canvas: the point and where the menu opens; the browser's menu is kept off.
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, right: 210, bottom: 220, width: 200, height: 200, x: 10, y: 20, toJSON: () => ({}) });
    const menu = pointer("contextmenu", { x: 60, y: 70, button: 2 });
    canvas.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(selectContextMenu).toHaveBeenLastCalledWith({ x: 50, y: 50 }, { x: 60, y: 70 }, false);
    // The menu key (no pointer position over the canvas): at the last pointer, nothing hit.
    canvas.dispatchEvent(pointer("contextmenu", { x: 0, y: 0, button: 0 }));
    expect(selectContextMenu).toHaveBeenLastCalledWith(null, { x: 17, y: 26 }, true);
    // Another tool: the browser's own menu.
    setTool("pan");
    const other = pointer("contextmenu", { x: 60, y: 70, button: 2 });
    canvas.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });
});
