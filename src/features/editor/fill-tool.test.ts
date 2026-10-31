import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { setTool, viewerStore, type LayerView, type PressContext } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { FILL_LEAKED, FILL_NO_LINES, FILL_OUTSIDE, fillFrames, fillOf } from "./fill-tool";
import { ADD_AREA, installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const SHA = "f".repeat(64);
const PAGE = pageIdOf(SHA, 0);
const cal: Calibration = { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100 };

const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: -p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 0,
  height: 0,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

/** snap.pdf's rectangle (100, 100)-(300, 250) as linework; an optional gap in its bottom edge. */
function segments(gap = false): PressContext["segments"] {
  const lines = gap
    ? [100, 100, 180, 100, 220, 100, 300, 100]
    : [100, 100, 300, 100];
  const coords = [...lines, 300, 100, 300, 250, 300, 250, 100, 250, 100, 250, 100, 100];
  return { coords, count: coords.length / 4 };
}

const at = (segs: PressContext["segments"] = segments()): PressContext => ({
  documentId: SHA,
  pageIndex: 0,
  view,
  window: { x0: 0, y0: 0, x1: 400, y1: 300 },
  cell: 2,
  segments: segs,
});

let frames: (() => void)[] = [];
let clock = 0;
const realFrames = { ...fillFrames };
function runFrames(n: number): void {
  for (let i = 0; i < n && frames.length; i++) {
    clock += 16;
    frames.shift()!();
  }
}
const toasts = () => [...toastStore.getState().visible, ...toastStore.getState().queue].map((t) => t.title);

let uninstall: () => void;
beforeEach(() => {
  frames = [];
  clock = 0;
  fillFrames.request = (cb) => frames.push(cb);
  fillFrames.cancel = () => {
    frames = [];
  };
  fillFrames.now = () => clock;
  toastStore.setState({ visible: [], queue: [] });
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: { [PAGE]: cal } });
  uninstall = installMeasureTools();
  setTool("fill");
});
afterEach(() => {
  uninstall();
  Object.assign(fillFrames, realFrames);
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Dynamic fill (Story 4.10)", () => {
  it("spreads a frame at a time while held; Enter adds the room as an area ('Add area')", () => {
    measurePainter.press!("start", { x: 200, y: 175 }, at(), "grow");
    expect(editorStore.getState().tools.drawing?.tool).toBe("fill");
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Fill stroke");
    runFrames(1);
    const one = fillOf(PAGE)!.count;
    expect(one).toBeGreaterThan(0);
    runFrames(1);
    expect(fillOf(PAGE)!.count).toBeGreaterThan(one);
    runFrames(200);
    expect(frames).toHaveLength(0); // done: nothing left to spread
    measurePainter.press!("end", { x: 200, y: 175 }, at(), "grow");
    // The live area beside the pointer.
    expect(measurePainter.paintActive(recorderCtx(), view, { x: 200, y: 175 })).toMatch(/ m²$/);
    expect(measurePainter.finish()).toBe("done");
    const [m] = markupsOf(editorStore.getState(), SHA);
    expect(m).toMatchObject({ type: "area", pageId: PAGE });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_AREA);
    expect(measurePainter.paintStatic(recorderCtx(), view)).toEqual(["37.34 m², P 24694 mm"]);
    expect(editorStore.getState().tools.drawing).toBeNull();
  });

  it("leaks through a gap and says how to close it; Enter refuses; Ctrl+Z undoes the stroke", () => {
    measurePainter.press!("start", { x: 200, y: 175 }, at(segments(true)), "grow");
    runFrames(300);
    expect(fillOf(PAGE)!.leaked).toBe(true);
    expect(toasts()).toContain(FILL_LEAKED);
    measurePainter.press!("end", { x: 200, y: 175 }, at(), "grow");
    expect(measurePainter.finish()).toBe("ignored");
    expect(undoActive()).toBe(true);
    expect(fillOf(PAGE)!.leaked).toBe(false);
    expect(fillOf(PAGE)!.count).toBe(0);
  });

  it("a Length across the gap is a barrier", () => {
    editorStore.setState((s) => ({
      doc: {
        ...s.doc,
        markups: {
          [SHA]: [
            {
              id: "0190a8a0-0000-7000-8000-000000000001",
              pageId: PAGE,
              createdAt: "2026-11-01T00:00:00Z",
              style: { color: "#ff0000", width: 1, fontSize: 10 },
              type: "length",
              points: [
                { x: 170, y: 100 },
                { x: 230, y: 100 },
              ],
            },
          ],
        },
      },
    }));
    measurePainter.press!("start", { x: 200, y: 175 }, at(segments(true)), "grow");
    runFrames(300);
    expect(fillOf(PAGE)!.leaked).toBe(false);
  });

  it("Esc discards it; another tool discards it; no linework yet: a note, no fill", () => {
    measurePainter.press!("start", { x: 200, y: 175 }, at(), "grow");
    runFrames(3);
    expect(measurePainter.escape()).toBe(true);
    expect(fillOf(PAGE)).toBeNull();
    expect(editorStore.getState().tools.drawing).toBeNull();
    measurePainter.press!("start", { x: 200, y: 175 }, at(), "grow");
    setTool("area");
    expect(fillOf(PAGE)).toBeNull();
    setTool("fill");
    measurePainter.press!("start", { x: 200, y: 175 }, at(null), "grow");
    expect(fillOf(PAGE)).toBeNull();
    expect(toasts()).toContain(FILL_NO_LINES);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });

  it("review R1: a press outside the fill's view starts again when nothing is filled, otherwise says why", () => {
    const moved = (): PressContext => ({ ...at(), window: { x0: 150, y0: 120, x1: 550, y1: 420 } });
    measurePainter.press!("start", { x: 50, y: 50 }, at(), "grow");
    measurePainter.press!("end", { x: 50, y: 50 }, at(), "grow");
    // Nothing spread yet (no frame ran): a press beyond the first view starts a fill in the new one.
    measurePainter.press!("start", { x: 500, y: 400 }, moved(), "grow");
    expect(fillOf(PAGE)!.grid.x0).toBe(150);
    measurePainter.press!("end", { x: 500, y: 400 }, moved(), "grow");
    measurePainter.press!("start", { x: 200, y: 175 }, moved(), "grow");
    runFrames(300);
    measurePainter.press!("end", { x: 200, y: 175 }, moved(), "grow");
    const count = fillOf(PAGE)!.count;
    measurePainter.press!("start", { x: 50, y: 50 }, at(), "grow");
    expect(toasts()).toContain(FILL_OUTSIDE);
    expect(fillOf(PAGE)!.count).toBe(count);
  });

  it("Ctrl + drag erases a hole, Shift + drag paints, strokes undo one by one", () => {
    measurePainter.press!("start", { x: 200, y: 175 }, at(), "grow");
    runFrames(300);
    measurePainter.press!("end", { x: 200, y: 175 }, at(), "grow");
    const full = fillOf(PAGE)!.count;
    measurePainter.press!("start", { x: 200, y: 175 }, at(), "erase");
    measurePainter.press!("move", { x: 210, y: 175 }, at(), "erase");
    measurePainter.press!("end", { x: 210, y: 175 }, at(), "erase");
    expect(fillOf(PAGE)!.count).toBeLessThan(full);
    expect(measurePainter.removeLastPoint()).toBe(true);
    expect(fillOf(PAGE)!.count).toBe(full);
    measurePainter.press!("start", { x: 200, y: 175 }, at(), "erase");
    measurePainter.press!("end", { x: 200, y: 175 }, at(), "erase");
    expect(measurePainter.finish()).toBe("done");
    const [m] = markupsOf(editorStore.getState(), SHA);
    expect(m.type === "area" && m.holes).toHaveLength(1);
  });
});

/** A canvas context that records nothing (jsdom has no canvas). */
function recorderCtx(): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, prop: string) => (prop in t ? t[prop] : prop === "measureText" ? (s: string) => ({ width: s.length * 6 }) : () => undefined),
    set: (t, prop: string, v) => ((t[prop] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}
