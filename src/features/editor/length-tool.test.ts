import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";
import { onMarkupsChanged } from "@/features/viewer/markup-layer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { ADD_LENGTH, installLengthTool, lengthPainter } from "./length-tool";
import { activeUndoLabels, clearUndo, redoActive, undoActive } from "./undo-store";

const SHA = "e".repeat(64);
const AT = { documentId: SHA, pageIndex: 0 };
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
  uninstall = installLengthTool();
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
    expect(lengthPainter.place({ x: 0, y: 0 }, AT)).toBe("continue");
    expect(lengthPainter.tracking).toBe(true);
    // A second click on the first point measures nothing.
    expect(lengthPainter.place({ x: 0, y: 0 }, AT)).toBe("continue");
    expect(lengthPainter.place({ x: 72, y: 0 }, AT)).toBe("done");
    expect(lengthPainter.tracking).toBe(false);
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
    lengthPainter.place({ x: 0, y: 0 }, AT);
    lengthPainter.place({ x: 72, y: 0 }, AT);
    const unscaled = recorder();
    expect(lengthPainter.paintStatic(unscaled.ctx, view)).toEqual(["Scale not set"]);
    expect(unscaled.texts()[0]).toMatchObject({ args: ["Scale not set", 0, 0], fillStyle: "#8a6400" });
    // Calibrated afterwards: the same markup now shows its value (stored geometry only, AC 2).
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    const scaled = recorder();
    expect(lengthPainter.paintStatic(scaled.ctx, view)).toEqual(["1905 mm"]);
    expect(scaled.texts()[0]).toMatchObject({ args: ["1905 mm", 0, 0], fillStyle: "#ff0000" });
    // Another page's markups are not this page's.
    expect(lengthPainter.paintStatic(recorder().ctx, { ...view, pageIndex: 1 })).toEqual([]);
  });

  it("the drawing paints a rubber band to the tool point and the live value beside it", () => {
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    const idle = recorder();
    expect(lengthPainter.paintActive(idle.ctx, view, { x: 10, y: 10 })).toBeNull();
    lengthPainter.place({ x: 0, y: 0 }, AT);
    const live = recorder();
    expect(lengthPainter.paintActive(live.ctx, view, { x: 0, y: 144 })).toBe("3810 mm");
    expect(live.ops.some((o) => o.op === "stroke")).toBe(true);
    expect(live.ops.find((o) => o.op === "fillText")!.args.slice(1)).toEqual([14, -144 + 22]);
    expect(lengthPainter.paintActive(recorder().ctx, view, null)).toBeNull();
  });

  it("Esc, Ctrl+Z, another tool, page or tab end the drawing; nothing is added", () => {
    lengthPainter.place({ x: 0, y: 0 }, AT);
    expect(lengthPainter.escape()).toBe(true);
    expect(lengthPainter.escape()).toBe(false); // idle: the viewer leaves the tool
    lengthPainter.place({ x: 0, y: 0 }, AT);
    // Review R5: Edit > Undo names what it does while drawing.
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Length point");
    expect(undoActive()).toBe(true); // the placed point
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBeNull();
    expect(lengthPainter.tracking).toBe(false);
    for (const change of [() => setTool("pan"), () => viewerStore.setState({ pageIndex: 1 }), () => viewerStore.setState({ tabId: "t2" })]) {
      setTool("length");
      viewerStore.setState({ pageIndex: 0, tabId: "t1" });
      lengthPainter.place({ x: 0, y: 0 }, AT);
      change();
      expect(lengthPainter.tracking).toBe(false);
    }
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });

  it("asks the viewer to paint again when markups, the drawing or a calibration change", () => {
    const changes: { drawingEnded?: boolean }[] = [];
    const off = onMarkupsChanged((c) => changes.push(c));
    lengthPainter.place({ x: 0, y: 0 }, AT);
    lengthPainter.place({ x: 72, y: 0 }, AT);
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    off();
    expect(changes.some((c) => c.drawingEnded)).toBe(true);
    expect(changes.length).toBeGreaterThanOrEqual(3);
  });

  it("review R6: a length wholly off the canvas is not drawn, though its caption is still listed", () => {
    lengthPainter.place({ x: 0, y: 0 }, AT);
    lengthPainter.place({ x: 72, y: 0 }, AT);
    const sized = { ...view, width: 1000, height: 800 };
    const on = recorder();
    expect(lengthPainter.paintStatic(on.ctx, sized)).toEqual(["Scale not set"]);
    expect(on.ops.some((o) => o.op === "stroke")).toBe(true);
    const off = recorder();
    const far = { ...sized, toDevice: (p: { x: number; y: number }) => ({ x: p.x + 50_000, y: -p.y }) };
    expect(lengthPainter.paintStatic(off.ctx, far)).toEqual(["Scale not set"]);
    expect(off.ops.some((o) => o.op === "stroke" || o.op === "fillText")).toBe(false);
  });

  it("only places with Length armed", () => {
    setTool("select");
    expect(lengthPainter.place({ x: 0, y: 0 }, AT)).toBe("ignored");
  });
});
