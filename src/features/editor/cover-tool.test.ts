import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hitMarkup } from "@/core/markup/geometry";
import { fieldsOf } from "@/core/markup/properties";
import { COVER_COLOR, DEFAULT_COVER_STYLE, markupSchema } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { vertexIndices } from "./handles";
import { ADD_ERASER, ADD_WHITEOUT, installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const SHA = "c".repeat(64);

type Op = { op: string; args: unknown[] };
function recorder() {
  const ops: Op[] = [];
  const props: Record<string, unknown> = {};
  const fills: unknown[] = [];
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props && prop !== "fill"
        ? props[prop]
        : prop === "measureText"
          ? (text: string) => ({ width: text.length * 5 })
          : (...args: unknown[]) => {
              if (prop === "fill") fills.push(props.fillStyle);
              ops.push({ op: prop, args });
            },
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops, fills, strokes: () => ops.filter((o) => o.op === "stroke").length };
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
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0.5 };
const INK_AT = { documentId: SHA, pageIndex: 0, view };
const BOX = [
  { x: 0, y: 0 },
  { x: 72, y: 0 },
  { x: 72, y: 36 },
  { x: 0, y: 36 },
];

const added = () => markupsOf(editorStore.getState(), SHA);
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;

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

describe("White-out and the Eraser (Story 5.11)", () => {
  it("White-out: two corners add a white cover over the box, one undo step; painted filled white, no stroke", () => {
    setTool("whiteout");
    measurePainter.place({ x: 0, y: 0 }, AT);
    expect(measurePainter.place({ x: 72, y: 36 }, AT)).toBe("done");
    expect(added()[0]).toMatchObject({ type: "whiteout", points: BOX, style: DEFAULT_COVER_STYLE });
    expect(markupSchema.safeParse(added()[0]).success).toBe(true);
    expect(undoLabel()).toBe(ADD_WHITEOUT);
    expect(viewerStore.getState().tool).toBe("whiteout");
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["White-out"]);
    expect(r.fills).toEqual([COVER_COLOR]);
    expect(r.strokes()).toBe(0);
    undoActive();
    expect(added()).toHaveLength(0);
  });

  it("White-out polygon: each corner, closed on the first, adds one cover", () => {
    setTool("whiteoutpolygon");
    const corners = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 25, y: 40 },
    ];
    for (const p of corners) expect(measurePainter.place(p, AT)).toBe("continue");
    expect(measurePainter.place({ x: 0.2, y: 0 }, AT)).toBe("done");
    expect(added()[0]).toMatchObject({ type: "whiteout", points: corners });
    expect(undoLabel()).toBe(ADD_WHITEOUT);
    // Vertex handles, as a polygon's.
    expect(vertexIndices(added()[0])).toEqual([0, 1, 2]);
  });

  it("the Eraser: a white 10 pt stroke, one undo step", () => {
    setTool("eraser");
    measurePainter.ink!("start", { x: 0, y: 0 }, INK_AT, false);
    measurePainter.ink!("move", { x: 20, y: 0 }, INK_AT, false);
    measurePainter.ink!("end", { x: 40, y: 10 }, INK_AT, false);
    expect(added()[0]).toMatchObject({ type: "eraser", style: { color: COVER_COLOR, width: 10 } });
    expect(undoLabel()).toBe(ADD_ERASER);
    const r = recorder();
    expect(measurePainter.paintStatic(r.ctx, view)).toEqual(["Eraser"]);
    expect(r.strokes()).toBe(1);
    expect(vertexIndices(added()[0])).toEqual([]);
  });

  it("a cover is hit inside like a filled shape; an eraser stroke within its width", () => {
    const cover = markupSchema.parse({ id: "00000000-0000-7000-8000-000000000001", pageId: `${SHA}:0`, createdAt: "2026-11-05T00:00:00.000Z", style: DEFAULT_COVER_STYLE, type: "whiteout", points: BOX });
    expect(hitMarkup(cover, { x: 30, y: 20 }, 1)).toBe(true);
    expect(hitMarkup(cover, { x: 100, y: 20 }, 1)).toBe(false);
    const erase = markupSchema.parse({ ...cover, type: "eraser", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] });
    expect(hitMarkup(erase, { x: 20, y: 4.5 }, 0.5)).toBe(true);
    expect(hitMarkup(erase, { x: 20, y: 7 }, 0.5)).toBe(false);
    // Properties: a cover has only its subject; an eraser its brush width too.
    expect([...fieldsOf(cover)]).toEqual(["subject"]);
    expect([...fieldsOf(erase)].sort()).toEqual(["subject", "width"]);
  });
});
