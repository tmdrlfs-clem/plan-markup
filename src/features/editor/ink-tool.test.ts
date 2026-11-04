import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MarkupIndex } from "@/core/markup/markup-index";
import { DEFAULT_HIGHLIGHT_STYLE, DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";
import { onMarkupsChanged, type MarkupChange } from "@/features/viewer/markup-layer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { vertexIndices } from "./handles";
import { ADD_HIGHLIGHT, ADD_PEN, installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const SHA = "a".repeat(64);

type Op = { op: string; args: unknown[] };
function recorder() {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props ? props[prop] : prop === "measureText" ? (text: string) => ({ width: text.length * 5 }) : (...args: unknown[]) => void ops.push({ op: prop, args }),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops, props, strokes: () => ops.filter((o) => o.op === "stroke").length };
}

// Upright page, 1 device px a point; screen y down.
const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: 500 - p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 0,
  height: 0,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};
const AT = { documentId: SHA, pageIndex: 0, view };

const added = () => markupsOf(editorStore.getState(), SHA);
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;
const drawn = () => editorStore.getState().tools.drawing;

/** A stroke pressed at the first point, moved through the others and released at the last. */
function draw(points: { x: number; y: number }[], straight = false) {
  measurePainter.ink!("start", points[0], AT, straight);
  for (const p of points.slice(1)) measurePainter.ink!("move", p, AT, straight);
  measurePainter.ink!("end", points[points.length - 1], AT, straight);
}

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Pen and Highlight (Story 5.7)", () => {
  it("a Pen stroke is added on release, simplified, as one undo step; the tool stays armed", () => {
    setTool("pen");
    // A straight run of points is kept as its two ends; the corner stays.
    draw([
      { x: 0, y: 0 },
      { x: 10, y: 0.1 },
      { x: 20, y: 0 },
      { x: 30, y: 0.1 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
    ]);
    expect(added()).toHaveLength(1);
    expect(added()[0]).toMatchObject({
      type: "pen",
      style: DEFAULT_MARKUP_STYLE,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 20 },
      ],
    });
    expect(undoLabel()).toBe(ADD_PEN);
    expect(viewerStore.getState().tool).toBe("pen");
    expect(drawn()).toBeNull();
    undoActive();
    expect(added()).toHaveLength(0);
  });

  it("a click, or a press that never moved a step, adds nothing (D2); points closer than a CSS px are not captured", () => {
    setTool("pen");
    draw([
      { x: 5, y: 5 },
      { x: 5.2, y: 5.3 },
    ]);
    expect(added()).toHaveLength(0);
    measurePainter.ink!("start", { x: 0, y: 0 }, AT, false);
    measurePainter.ink!("move", { x: 0.5, y: 0 }, AT, false);
    expect(drawn()?.points).toHaveLength(1);
    measurePainter.ink!("move", { x: 2, y: 0 }, AT, false);
    expect(drawn()?.points).toHaveLength(2);
    measurePainter.ink!("cancel", { x: 2, y: 0 }, AT, false);
    expect(drawn()).toBeNull();
    expect(added()).toHaveLength(0);
  });

  it("straight: the part from where Shift began is replaced by one segment to the held point", () => {
    setTool("pen");
    measurePainter.ink!("start", { x: 0, y: 0 }, AT, false);
    measurePainter.ink!("move", { x: 5, y: 5 }, AT, false);
    measurePainter.ink!("move", { x: 20, y: 5 }, AT, true);
    measurePainter.ink!("move", { x: 30, y: 5 }, AT, true);
    expect(drawn()?.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 30, y: 5 },
    ]);
    measurePainter.ink!("move", { x: 30, y: 15 }, AT, false);
    measurePainter.ink!("end", { x: 30, y: 15 }, AT, false);
    expect(added()[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 30, y: 5 },
      { x: 30, y: 15 },
    ]);
  });

  it("a stroke's moves repaint layer 3 only", () => {
    setTool("pen");
    const changes: MarkupChange[] = [];
    const off = onMarkupsChanged((c) => changes.push(c));
    measurePainter.ink!("start", { x: 0, y: 0 }, AT, false);
    measurePainter.ink!("move", { x: 10, y: 0 }, AT, false);
    expect(changes.every((c) => c.activeOnly)).toBe(true);
    measurePainter.ink!("end", { x: 10, y: 0 }, AT, false);
    expect(changes.at(-1)?.activeOnly).toBeUndefined();
    off();
  });

  it("Highlight: yellow, wide, 40 %; painted under the markups (layer 2 lists it and draws no stroke for it)", () => {
    setTool("highlight");
    draw([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
    setTool("pen");
    draw([
      { x: 0, y: 50 },
      { x: 50, y: 60 },
    ]);
    const [highlight] = added();
    expect(highlight).toMatchObject({ type: "highlight", style: DEFAULT_HIGHLIGHT_STYLE });
    expect(DEFAULT_HIGHLIGHT_STYLE).toMatchObject({ color: "#ffff00", opacity: 0.4 });
    const layer2 = recorder();
    expect(measurePainter.paintStatic(layer2.ctx, view)).toEqual(["Highlight", "Pen"]);
    expect(layer2.strokes()).toBe(1);
    const under = recorder();
    measurePainter.paintUnder!(under.ctx, view);
    expect(under.strokes()).toBe(1);
    expect(under.ops.find((o) => o.op === "moveTo")?.args).toEqual([0, 400]);
    // While drawing, the stroke shows on layer 3.
    setTool("highlight");
    measurePainter.ink!("start", { x: 0, y: 0 }, AT, false);
    measurePainter.ink!("move", { x: 10, y: 10 }, AT, false);
    const active = recorder();
    measurePainter.paintActive(active.ctx, view, null);
    expect(active.strokes()).toBe(1);
    measurePainter.ink!("cancel", { x: 10, y: 10 }, AT, false);
    expect(undoLabel()).toBe(ADD_PEN);
  });

  it("is hit within half its width; has no vertex handles; another tool's click places nothing for it", () => {
    setTool("highlight");
    draw([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
    expect(undoLabel()).toBe(ADD_HIGHLIGHT);
    const m = added()[0] as Markup;
    const index = new MarkupIndex([m]);
    expect(index.hit({ x: 50, y: 105.5 }, 0.1)?.id).toBe(m.id);
    expect(index.hit({ x: 50, y: 107 }, 0.1)).toBeNull();
    expect(vertexIndices(m)).toEqual([]);
    expect(measurePainter.place({ x: 1, y: 1 }, { documentId: SHA, pageIndex: 0, tolerance: 0 })).toBe("ignored");
  });
});
