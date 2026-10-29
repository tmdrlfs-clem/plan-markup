import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";
import { onMarkupsChanged } from "@/features/viewer/markup-layer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { ADD_LENGTH, ADD_POLYLENGTH, installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo, redoActive, undoActive } from "./undo-store";

const SHA = "e".repeat(64);
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0 };
// 1:75 in mm: 72 pt (one inch, 25.4 mm on paper) is 1905 mm.
const cal: Calibration = { xFactor: factorForRatio(75), yFactor: factorForRatio(75), unit: "mm", precision: "0", source: "ratio", ratio: 75 };

type Op = { op: string; args: unknown[]; fillStyle?: unknown };
function recorder() {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) => (prop in props ? props[prop] : (...args: unknown[]) => void ops.push({ op: prop, args, fillStyle: props.fillStyle })),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops, texts: () => ops.filter((o) => o.op === "fillText") };
}

const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: -p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 0,
  height: 0,
  colors: { halo: "#ffffff", warning: "#8a6400", fontFamily: "sans-serif" },
};

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  setTool("length");
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Length tool (Story 4.5)", () => {
  it("two clicks add a length as one undo step 'Add length'; the tool stays armed", () => {
    expect(measurePainter.place({ x: 0, y: 0 }, AT)).toBe("continue");
    expect(measurePainter.tracking).toBe(true);
    // A second click on the first point measures nothing.
    expect(measurePainter.place({ x: 0, y: 0 }, AT)).toBe("continue");
    expect(measurePainter.place({ x: 72, y: 0 }, AT)).toBe("done");
    expect(measurePainter.tracking).toBe(false);
    const [m] = markupsOf(editorStore.getState(), SHA);
    expect(m).toMatchObject({ type: "length", pageId: pageIdOf(SHA, 0), points: [{ x: 0, y: 0 }, { x: 72, y: 0 }], style: { color: "#ff0000", width: 1, fontSize: 10 } });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_LENGTH);
    expect(viewerStore.getState().tool).toBe("length");
    undoActive();
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    redoActive();
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(1);
  });

  it("captions come from the page's calibration; without one they read 'Scale not set' in the warning colour", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    const unscaled = recorder();
    expect(measurePainter.paintStatic(unscaled.ctx, view)).toEqual(["Scale not set"]);
    expect(unscaled.texts()[0]).toMatchObject({ args: ["Scale not set", 0, 0], fillStyle: "#8a6400" });
    // Calibrated afterwards: the same markup now shows its value (stored geometry only, AC 2).
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    const scaled = recorder();
    expect(measurePainter.paintStatic(scaled.ctx, view)).toEqual(["1905 mm"]);
    expect(scaled.texts()[0]).toMatchObject({ args: ["1905 mm", 0, 0], fillStyle: "#ff0000" });
    // Another page's markups are not this page's.
    expect(measurePainter.paintStatic(recorder().ctx, { ...view, pageIndex: 1 })).toEqual([]);
  });

  it("the drawing paints a rubber band to the tool point and the live value beside it", () => {
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    const idle = recorder();
    expect(measurePainter.paintActive(idle.ctx, view, { x: 10, y: 10 })).toBeNull();
    measurePainter.place({ x: 0, y: 0 }, AT);
    const live = recorder();
    expect(measurePainter.paintActive(live.ctx, view, { x: 0, y: 144 })).toBe("3810 mm");
    expect(live.ops.some((o) => o.op === "stroke")).toBe(true);
    expect(live.ops.find((o) => o.op === "fillText")!.args.slice(1)).toEqual([14, -144 + 22]);
    expect(measurePainter.paintActive(recorder().ctx, view, null)).toBeNull();
  });

  it("Esc, Ctrl+Z, another tool, page or tab end the drawing; nothing is added", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.escape()).toBe(true);
    expect(measurePainter.escape()).toBe(false); // idle: the viewer leaves the tool
    measurePainter.place({ x: 0, y: 0 }, AT);
    // Review R5: Edit > Undo names what it does while drawing.
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Length point");
    expect(undoActive()).toBe(true); // the placed point
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBeNull();
    expect(measurePainter.tracking).toBe(false);
    for (const change of [() => setTool("pan"), () => viewerStore.setState({ pageIndex: 1 }), () => viewerStore.setState({ tabId: "t2" })]) {
      setTool("length");
      viewerStore.setState({ pageIndex: 0, tabId: "t1" });
      measurePainter.place({ x: 0, y: 0 }, AT);
      change();
      expect(measurePainter.tracking).toBe(false);
    }
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });

  it("asks the viewer to paint again when markups, the drawing or a calibration change", () => {
    const changes: { drawingEnded?: boolean }[] = [];
    const off = onMarkupsChanged((c) => changes.push(c));
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    off();
    expect(changes.some((c) => c.drawingEnded)).toBe(true);
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  it("review R6: a length wholly off the canvas is not drawn, though its caption is still listed", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    const sized = { ...view, width: 1000, height: 800 };
    const on = recorder();
    expect(measurePainter.paintStatic(on.ctx, sized)).toEqual(["Scale not set"]);
    expect(on.ops.some((o) => o.op === "stroke")).toBe(true);
    const off = recorder();
    const far = { ...sized, toDevice: (p: { x: number; y: number }) => ({ x: p.x + 50_000, y: -p.y }) };
    expect(measurePainter.paintStatic(off.ctx, far)).toEqual(["Scale not set"]);
    expect(off.ops.some((o) => o.op === "stroke" || o.op === "fillText")).toBe(false);
  });

  it("only places with Length armed", () => {
    setTool("select");
    expect(measurePainter.place({ x: 0, y: 0 }, AT)).toBe("ignored");
  });
});

describe("Polylength tool (Story 4.6)", () => {
  beforeEach(() => setTool("polylength"));

  it("each click adds a vertex; finish adds it as one undo step 'Add polylength'; the tool stays armed", () => {
    expect(measurePainter.finish()).toBe("ignored"); // nothing drawn
    expect(measurePainter.place({ x: 0, y: 0 }, AT)).toBe("continue");
    expect(measurePainter.finish()).toBe("ignored"); // one vertex is not a polylength
    expect(measurePainter.place({ x: 72, y: 0 }, AT)).toBe("continue");
    expect(measurePainter.place({ x: 72, y: 72 }, AT)).toBe("continue");
    expect(measurePainter.lastPoint).toEqual({ x: 72, y: 72 });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Polylength point");
    expect(measurePainter.finish()).toBe("done");
    expect(measurePainter.tracking).toBe(false);
    const [m] = markupsOf(editorStore.getState(), SHA);
    expect(m).toMatchObject({ type: "polylength", points: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 72, y: 72 }] });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_POLYLENGTH);
    expect(viewerStore.getState().tool).toBe("polylength");
    undoActive();
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    redoActive();
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(1);
  });

  it("a double-click's second click (within the tolerance of the last vertex) adds no vertex", () => {
    const near = { ...AT, tolerance: 2 };
    measurePainter.place({ x: 0, y: 0 }, near);
    measurePainter.place({ x: 72, y: 0 }, near);
    expect(measurePainter.place({ x: 73, y: 1 }, near)).toBe("continue");
    measurePainter.finish();
    expect(markupsOf(editorStore.getState(), SHA)[0].points).toHaveLength(2);
  });

  it("Backspace and Ctrl+Z remove the last vertex; the last one ends the drawing", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    expect(measurePainter.removeLastPoint()).toBe(true);
    expect(measurePainter.lastPoint).toEqual({ x: 0, y: 0 });
    expect(undoActive()).toBe(true);
    expect(measurePainter.tracking).toBe(false);
    expect(measurePainter.removeLastPoint()).toBe(false);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });

  it("the live total sums the placed segments and the rubber band; the caption is the same sum", () => {
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    // 72 + 72 pt at 1:75 = 3810 mm.
    expect(measurePainter.paintActive(recorder().ctx, view, { x: 72, y: 72 })).toBe("3810 mm");
    measurePainter.place({ x: 72, y: 72 }, AT);
    measurePainter.finish();
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["3810 mm"]);
  });

  it("the caption sits on the longest segment, centred", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 10, y: 0 }, AT);
    measurePainter.place({ x: 10, y: -100 }, AT);
    measurePainter.finish();
    const r = recorder();
    measurePainter.paintStatic(r.ctx, view);
    const at = r.ops.find((o) => o.op === "translate")!.args as number[];
    // The longest segment runs from (10, 0) to (10, 100) on the device: its middle is at y 50.
    expect(at[1]).toBeCloseTo(50, 6);
    expect(Math.abs(at[0] - 10)).toBeLessThan(15);
  });

  it("switching to Length cancels a polylength in progress", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    setTool("length");
    expect(measurePainter.tracking).toBe(false);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });
});
