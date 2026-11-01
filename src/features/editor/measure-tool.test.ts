import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import type { MeasureMarkup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";
import { onMarkupsChanged } from "@/features/viewer/markup-layer";

import { editorStore, markupsOf, resetEditor, setSelection } from "./editor-store";
import {
  ADD_ANGLE,
  ADD_AREA,
  ADD_ARROW,
  ADD_COUNT,
  ADD_DIAMETER,
  ADD_LENGTH,
  ADD_LINE,
  ADD_POLYGON,
  ADD_POLYLENGTH,
  ADD_POLYLINE,
  ADD_RADIUS,
  CROSSES_ITSELF,
  MOVE_CAPTION,
  installMeasureTools,
  measurePainter,
} from "./measure-tool";
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
    get: (_t, prop: string) =>
      prop in props
        ? props[prop]
        : prop === "measureText"
          ? (text: string) => ({ width: text.length * 6 }) // 6 px a character
          : (...args: unknown[]) => void ops.push({ op: prop, args, fillStyle: props.fillStyle }),
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
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
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

describe("Moving a caption (Story 4.6)", () => {
  // A length from (0, 0) to (100, 0): on the device from (0, 0) to (100, 0), its caption centred above x 50.
  function lengthWithCaption() {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 100, y: 0 }, AT);
    const r = recorder();
    measurePainter.paintStatic(r.ctx, view);
    return markupsOf(editorStore.getState(), SHA)[0];
  }
  const translateOf = () => {
    const r = recorder();
    measurePainter.paintStatic(r.ctx, view);
    return r.ops.find((o) => o.op === "translate")!.args as number[];
  };

  it("hits a caption where it was painted (above its line), not the line's far end", () => {
    const m = lengthWithCaption();
    const at = translateOf();
    // "Scale not set" is 13 characters, 78 px wide at 6 px each: centred, 39 px either way (+3 px slop).
    expect(measurePainter.captionAt(view, { x: at[0], y: at[1] - 2 })).toBe(m.id);
    expect(measurePainter.captionAt(view, { x: at[0] + 41, y: at[1] - 5 })).toBe(m.id);
    expect(measurePainter.captionAt(view, { x: at[0] + 43, y: at[1] - 5 })).toBeNull();
    expect(measurePainter.captionAt(view, { x: at[0], y: at[1] + 4 })).toBeNull(); // below the baseline
    expect(measurePainter.captionAt(view, { x: 100, y: 40 })).toBeNull();
    expect(measurePainter.captionAt({ ...view, pageIndex: 1 }, { x: at[0], y: at[1] - 2 })).toBeNull();
  });

  it("previews the move live, commits it as one undo step 'Move caption' and keeps the measurement", () => {
    const m = lengthWithCaption();
    const before = translateOf();
    measurePainter.dragCaption(m.id, SHA, { x: 10, y: 20 });
    const live = translateOf();
    // User y up is device y down (the test view flips y).
    expect([live[0] - before[0], live[1] - before[1]]).toEqual([10, -20]);
    expect((markupsOf(editorStore.getState(), SHA)[0] as MeasureMarkup).captionOffset).toBeUndefined();
    expect(measurePainter.endCaptionDrag(true)).toBe(true);
    const [moved] = markupsOf(editorStore.getState(), SHA);
    expect(moved).toMatchObject({ id: m.id, points: m.points, captionOffset: { x: 10, y: 20 } });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(MOVE_CAPTION);
    // A second move adds to the first.
    measurePainter.dragCaption(m.id, SHA, { x: 5, y: 0 });
    measurePainter.endCaptionDrag(true);
    expect((markupsOf(editorStore.getState(), SHA)[0] as MeasureMarkup).captionOffset).toEqual({ x: 15, y: 20 });
    undoActive();
    expect((markupsOf(editorStore.getState(), SHA)[0] as MeasureMarkup).captionOffset).toEqual({ x: 10, y: 20 });
    undoActive();
    expect((markupsOf(editorStore.getState(), SHA)[0] as MeasureMarkup).captionOffset).toBeUndefined();
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_LENGTH);
  });

  it("Esc (no commit), no movement or another page puts it back; nothing is added to the history", () => {
    const m = lengthWithCaption();
    measurePainter.dragCaption(m.id, SHA, { x: 10, y: 20 });
    expect(measurePainter.endCaptionDrag(false)).toBe(false);
    measurePainter.dragCaption(m.id, SHA, { x: 0, y: 0 });
    expect(measurePainter.endCaptionDrag(true)).toBe(false);
    measurePainter.dragCaption(m.id, SHA, { x: 10, y: 20 });
    viewerStore.setState({ pageIndex: 1 });
    expect(editorStore.getState().tools.captionDrag).toBeNull();
    expect(measurePainter.endCaptionDrag(true)).toBe(false);
    expect((markupsOf(editorStore.getState(), SHA)[0] as MeasureMarkup).captionOffset).toBeUndefined();
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_LENGTH);
    // An unknown markup is not dragged.
    measurePainter.dragCaption("nope", SHA, { x: 1, y: 1 });
    expect(editorStore.getState().tools.captionDrag).toBeNull();
  });
});

describe("Area tool (Story 4.8)", () => {
  beforeEach(() => setTool("area"));
  const square = [
    { x: 0, y: 0 },
    { x: 72, y: 0 },
    { x: 72, y: 72 },
    { x: 0, y: 72 },
  ];

  it("needs three vertices; Enter adds it as one undo step 'Add area'; a click on the first vertex closes it too", () => {
    for (const p of square.slice(0, 2)) measurePainter.place(p, AT);
    expect(measurePainter.finish()).toBe("ignored"); // two vertices are not an area
    measurePainter.place(square[2], AT);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Area point");
    measurePainter.place(square[3], AT);
    expect(measurePainter.finish()).toBe("done");
    expect(markupsOf(editorStore.getState(), SHA)[0]).toMatchObject({ type: "area", points: square });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_AREA);
    expect(viewerStore.getState().tool).toBe("area");
    // Closing on the first vertex (within the tolerance).
    const near = { ...AT, tolerance: 2 };
    for (const p of square) measurePainter.place(p, near);
    expect(measurePainter.place({ x: 1, y: 1 }, near)).toBe("done");
    expect(markupsOf(editorStore.getState(), SHA)[1].points).toEqual(square);
  });

  it("a polygon that crosses itself is not added: the live value says so", () => {
    const bowTie = [
      { x: 0, y: 0 },
      { x: 72, y: 72 },
      { x: 72, y: 0 },
    ];
    for (const p of bowTie) measurePainter.place(p, AT);
    expect(measurePainter.paintActive(recorder().ctx, view, { x: 0, y: 72 })).toBe(CROSSES_ITSELF);
    measurePainter.place({ x: 0, y: 72 }, AT);
    expect(measurePainter.finish()).toBe("ignored");
    expect(measurePainter.tracking).toBe(true);
    // Backspace and a corner that keeps it simple: then it finishes.
    measurePainter.removeLastPoint();
    measurePainter.place({ x: 36, y: -36 }, AT);
    expect(measurePainter.finish()).toBe("done");
  });

  it("the caption: area and perimeter at the centroid, two lines; the live area while drawing", () => {
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    for (const p of square.slice(0, 3)) measurePainter.place(p, AT);
    // 72 pt at 1:75 = 1905 mm: the square is 3.63 m².
    expect(measurePainter.paintActive(recorder().ctx, view, square[3])).toBe("3.63 m²");
    measurePainter.place(square[3], AT);
    // Review R1: the tool point on the last vertex or on the first is no crossing.
    expect(measurePainter.paintActive(recorder().ctx, view, square[3])).toBe("3.63 m²");
    expect(measurePainter.paintActive(recorder().ctx, view, square[0])).toBe("3.63 m²");
    measurePainter.finish();
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["3.63 m², P 7620 mm"]);
    expect(r.texts().map((t) => t.args[0])).toEqual(["3.63 m²", "P 7620 mm"]);
    // Centred on the centroid (36, 36): device (36, -36); the second line one line lower.
    expect(r.ops.find((o) => o.op === "translate")!.args).toEqual([36, -36]);
    expect(r.texts()[1].args[2]).toBeCloseTo(10 * 1.15, 9);
    const [m] = markupsOf(editorStore.getState(), SHA);
    // Both lines hit; below them does not.
    expect(measurePainter.captionAt(view, { x: 36, y: -38 })).toBe(m.id);
    expect(measurePainter.captionAt(view, { x: 36, y: -36 + 10 })).toBe(m.id);
    expect(measurePainter.captionAt(view, { x: 36, y: -36 + 30 })).toBeNull();
    // Without a calibration: Scale not set, one line.
    viewerStore.setState({ calibrations: {} });
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Scale not set"]);
  });
});

describe("Count tool (Story 4.8)", () => {
  beforeEach(() => setTool("count"));

  it("each click places a marker of one count; Enter adds it as 'Add count'; the caption is the total", () => {
    for (const x of [0, 20, 40, 60]) measurePainter.place({ x, y: 0 }, AT);
    expect(measurePainter.paintActive(recorder().ctx, view, { x: 80, y: 0 })).toBe("4");
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Count point");
    expect(measurePainter.finish()).toBe("done");
    expect(markupsOf(editorStore.getState(), SHA)[0]).toMatchObject({ type: "count", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 60, y: 0 }] });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_COUNT);
    const r = recorder();
    // A count needs no scale.
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["4"]);
    expect(r.ops.filter((o) => o.op === "arc")).toHaveLength(4);
    expect(r.texts()[0].fillStyle).toBe("#ff0000");
  });

  it("Esc, another tool or another page finish it (D4); Backspace removes the last marker", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 20, y: 0 }, AT);
    expect(measurePainter.removeLastPoint()).toBe(true);
    expect(measurePainter.escape()).toBe(true);
    expect(markupsOf(editorStore.getState(), SHA).map((m) => m.points.length)).toEqual([1]);
    measurePainter.place({ x: 0, y: 0 }, AT);
    setTool("select");
    setTool("count");
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 9, y: 0 }, AT);
    viewerStore.setState({ pageIndex: 1 });
    expect(markupsOf(editorStore.getState(), SHA).map((m) => m.points.length)).toEqual([1, 1, 2]);
    expect(measurePainter.escape()).toBe(false); // idle: the viewer leaves the tool
  });

  it("a tab switch keeps the count in its own tab's history", () => {
    measurePainter.place({ x: 0, y: 0 }, AT);
    viewerStore.setState({ tabId: "t2", documentId: "f".repeat(64), openSeq: 2 });
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(1);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_COUNT);
    expect(activeUndoLabels(editorStore.getState(), "t2").undo).toBeNull();
  });
});

describe("Angle, Radius and Diameter tools (Story 4.9)", () => {
  const corner = [
    { x: 72, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 72 },
  ];

  it("Angle: the third click adds it as 'Add angle'; no scale needed; the live angle; Enter does not finish it", () => {
    setTool("angle");
    measurePainter.place(corner[0], AT);
    // One leg: drawn, no value yet.
    expect(measurePainter.paintActive(recorder().ctx, view, corner[1])).toBeNull();
    measurePainter.place(corner[1], AT);
    expect(measurePainter.paintActive(recorder().ctx, view, corner[2])).toBe("90.0°");
    expect(measurePainter.finish()).toBe("ignored");
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Angle point");
    expect(measurePainter.place(corner[2], AT)).toBe("done");
    expect(markupsOf(editorStore.getState(), SHA)[0]).toMatchObject({ type: "angle", points: corner });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_ANGLE);
    expect(viewerStore.getState().tool).toBe("angle");
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["90.0°"]);
    expect(r.texts()[0].fillStyle).toBe("#ff0000");
    // The legs and the arc at the vertex.
    expect(r.ops.filter((o) => o.op === "arc")).toHaveLength(1);
    // The caption inside the angle: device x > 0, y < 0 (the page's y up is device y down).
    const [tx, ty] = r.ops.find((o) => o.op === "translate")!.args as number[];
    expect(tx).toBeGreaterThan(0);
    expect(ty).toBeLessThan(0);
    const [m] = markupsOf(editorStore.getState(), SHA);
    expect(measurePainter.captionAt(view, { x: tx, y: ty - 3 })).toBe(m.id);
  });

  it("Radius and Diameter: three points on the circle; R / Ø in the calibration's units; Scale not set without one", () => {
    setTool("radius");
    const arc = [
      { x: 0, y: 0 },
      { x: 72, y: 0 },
      { x: 72, y: 72 },
    ];
    for (const p of arc) measurePainter.place(p, AT);
    setTool("diameter");
    for (const p of arc) measurePainter.place(p, AT);
    expect(markupsOf(editorStore.getState(), SHA).map((m) => m.type)).toEqual(["radius", "diameter"]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_DIAMETER);
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Scale not set", "Scale not set"]);
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    // Centre (36, 36), radius 36√2 pt at 1:75.
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["R 1347 mm", "Ø 2694 mm"]);
    expect(r.ops.filter((o) => o.op === "arc")).toHaveLength(2);
    undoActive();
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_RADIUS);
  });

  it("three points in a line: 'Points in a line', the click adds nothing; Backspace and Esc as Length", () => {
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal } });
    setTool("diameter");
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 10, y: 0 }, AT);
    expect(measurePainter.paintActive(recorder().ctx, view, { x: 20, y: 0 })).toBe("Points in a line");
    expect(measurePainter.place({ x: 20, y: 0 }, AT)).toBe("continue");
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    expect(measurePainter.removeLastPoint()).toBe(true);
    expect(measurePainter.tracking).toBe(true);
    expect(measurePainter.escape()).toBe(true);
    expect(measurePainter.tracking).toBe(false);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
    // Another tool cancels a radius (only a count is kept).
    setTool("radius");
    measurePainter.place({ x: 0, y: 0 }, AT);
    setTool("angle");
    expect(measurePainter.tracking).toBe(false);
    expect(markupsOf(editorStore.getState(), SHA)).toEqual([]);
  });
});

describe("Selection (Story 4.11)", () => {
  function addLength() {
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    return markupsOf(editorStore.getState(), SHA)[0];
  }
  const outlines = (ops: Op[]) => ops.filter((o) => o.op === "strokeRect");

  it("a selected measurement gets the outline (halo, then accent) around it", () => {
    const m = addLength();
    expect(outlines(recorder().ops)).toEqual([]);
    setSelection([m.id]);
    const r = recorder();
    measurePainter.paintStatic(r.ctx, { ...view, width: 1000, height: 1000 });
    // 4 px around the line (0, 0)–(72, 0), stroked twice.
    // The outline (then the 5.2 vertex handles).
    expect(outlines(r.ops).slice(0, 2).map((o) => o.args)).toEqual([
      [-4, -4, 80, 8],
      [-4, -4, 80, 8],
    ]);
  });

  it("Esc with Select, another tool, another tab or the measurement going away clears it", () => {
    const m = addLength();
    setTool("select");
    setSelection([m.id]);
    expect(measurePainter.escape()).toBe(true);
    expect(editorStore.getState().selection.ids).toEqual([]);
    expect(measurePainter.escape()).toBe(false);
    setSelection([m.id]);
    setTool("pan");
    expect(editorStore.getState().selection.ids).toEqual([]);
    setTool("select");
    setSelection([m.id]);
    viewerStore.setState({ tabId: "t2" });
    expect(editorStore.getState().selection.ids).toEqual([]);
    viewerStore.setState({ tabId: "t1" });
    setSelection([m.id]);
    undoActive();
    expect(editorStore.getState().selection.ids).toEqual([]);
  });
});

describe("Line, Arrow, Polyline and Polygon tools (Story 5.4)", () => {
  const added = () => markupsOf(editorStore.getState(), SHA);
  const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;

  it("Line and Arrow: two clicks add the markup (red, 1 pt), one undo step; the tool stays armed", () => {
    setTool("line");
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.place({ x: 72, y: 0 }, AT)).toBe("done");
    expect(added()[0]).toMatchObject({ type: "line", points: [{ x: 0, y: 0 }, { x: 72, y: 0 }], style: { color: "#ff0000", width: 1 } });
    expect("captionOffset" in added()[0]).toBe(false);
    expect(undoLabel()).toBe(ADD_LINE);
    expect(viewerStore.getState().tool).toBe("line");
    setTool("arrow");
    measurePainter.place({ x: 0, y: 10 }, AT);
    measurePainter.place({ x: 72, y: 10 }, AT);
    expect(added()[1]).toMatchObject({ type: "arrow", points: [{ x: 0, y: 10 }, { x: 72, y: 10 }] });
    expect(undoLabel()).toBe(ADD_ARROW);
    // No caption: layer 2 lists the shapes by type; no live value while drawing (D6).
    expect(measurePainter.paintStatic(recorder().ctx, view)).toEqual(["Line", "Arrow"]);
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.paintActive(recorder().ctx, view, { x: 50, y: 0 })).toBeNull();
  });

  it("the arrow's line stops at its head, a filled triangle at the end point (D1)", () => {
    setTool("arrow");
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 72, y: 0 }, AT);
    const r = recorder();
    measurePainter.paintStatic(r.ctx, view);
    // Head length max(6 pt, 6 × 1 pt) at 1 device px a point: the line ends 6 px short of the tip.
    expect(r.ops.filter((o) => o.op === "lineTo")[0].args).toEqual([66, -0]);
    const fill = r.ops.find((o) => o.op === "fill");
    expect(fill?.fillStyle).toBe("#ff0000");
    expect(r.ops.filter((o) => o.op === "moveTo")[1].args).toEqual([72, -0]);
  });

  it("Polyline: Enter finishes (2+ vertices); Polygon closes on its first vertex (3+) and may cross itself (D3)", () => {
    setTool("polyline");
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.finish()).toBe("ignored");
    measurePainter.place({ x: 10, y: 0 }, AT);
    measurePainter.place({ x: 10, y: 10 }, AT);
    expect(measurePainter.finish()).toBe("done");
    expect(added()[0]).toMatchObject({ type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    expect(undoLabel()).toBe(ADD_POLYLINE);
    setTool("polygon");
    const bow = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    for (const p of bow) measurePainter.place(p, { ...AT, tolerance: 1 });
    expect(measurePainter.place({ x: 0.5, y: 0 }, { ...AT, tolerance: 1 })).toBe("done");
    expect(added()[1]).toMatchObject({ type: "polygon", points: bow });
    expect(undoLabel()).toBe(ADD_POLYGON);
    // Backspace removes the last vertex; Esc cancels.
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 5, y: 0 }, AT);
    expect(measurePainter.removeLastPoint()).toBe(true);
    expect(editorStore.getState().tools.drawing?.points).toEqual([{ x: 0, y: 0 }]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe("Polygon point");
    expect(measurePainter.escape()).toBe(true);
    expect(measurePainter.tracking).toBe(false);
    expect(added()).toHaveLength(2);
  });
});
