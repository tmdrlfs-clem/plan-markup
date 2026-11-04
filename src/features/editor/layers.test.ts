import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { pageIdOf } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { activeLayerOf, editorStore, isLocked, layersOf, markupsOf, pageMarkups, resetEditor, setActiveLayer, setDocMarkups, setSelection } from "./editor-store";
import { ADD_LAYER, DELETE_LAYER, addLayer, assignLayer, deleteLayer, layerScope, renameLayer, setLayerHidden, setLayerLocked, stepLayer } from "./layers";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { recordBelongsTo, type SessionRecord } from "./session";
import { activeUndoLabels, clearUndo, redoActive, undoActive } from "./undo-store";

const SHA = "d".repeat(64);
const PAGE = pageIdOf(SHA, 0);
const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: -p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 1000,
  height: 1000,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

let n = 0;
function line(y: number, extra: Partial<Markup> = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: PAGE,
    createdAt: "2026-11-05T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type: "line",
    points: [
      { x: 0, y },
      { x: 100, y },
    ],
    ...extra,
  } as Markup;
}
/** A canvas context that takes any call. */
function anyContext(): CanvasRenderingContext2D {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get: (_t, prop: string) => (prop in props ? props[prop] : prop === "measureText" ? (t: string) => ({ width: t.length * 5 }) : () => undefined),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
}
const all = () => markupsOf(editorStore.getState(), SHA);
const layers = () => layersOf(editorStore.getState(), SHA);
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0.5 };

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
  toastStore.setState({ visible: [], queue: [] });
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Layers (Story 5.12)", () => {
  it("a new layer goes on top and is active: new markups go to it; copies keep their layers", () => {
    const one = addLayer(SHA)!;
    expect(layers().map((l) => l.name)).toEqual(["Layer 1"]);
    expect(undoLabel()).toBe(ADD_LAYER);
    expect(activeLayerOf(editorStore.getState(), SHA)?.id).toBe(one.id);
    const two = addLayer(SHA)!;
    expect(layers().map((l) => l.name)).toEqual(["Layer 2", "Layer 1"]);
    setTool("line");
    measurePainter.place({ x: 0, y: 0 }, AT);
    measurePainter.place({ x: 50, y: 0 }, AT);
    expect(all()[0].layerId).toBe(two.id);
    // No layer active: no layer.
    setActiveLayer(SHA, null);
    measurePainter.place({ x: 0, y: 10 }, AT);
    measurePainter.place({ x: 50, y: 10 }, AT);
    expect(all()[1].layerId).toBeUndefined();
  });

  it("rename, move, hide and lock are each one undo step; a hidden or locked layer is not active", () => {
    const one = addLayer(SHA)!;
    addLayer(SHA);
    expect(renameLayer(SHA, one.id, "  Pipework  ")).toBe(true);
    expect(layers()[1].name).toBe("Pipework");
    expect(renameLayer(SHA, one.id, "   ")).toBe(false);
    stepLayer(SHA, one.id, -1);
    expect(layers().map((l) => l.name)).toEqual(["Pipework", "Layer 2"]);
    setActiveLayer(SHA, one.id);
    setLayerHidden(SHA, one.id, true);
    expect(undoLabel()).toBe("Hide layer");
    expect(activeLayerOf(editorStore.getState(), SHA)).toBeNull();
    setActiveLayer(SHA, one.id);
    expect(activeLayerOf(editorStore.getState(), SHA)).toBeNull();
    undoActive();
    expect(layers()[0].hidden).toBeUndefined();
    setLayerLocked(SHA, one.id, true);
    expect(undoLabel()).toBe("Lock layer");
  });

  it("a hidden layer's markups are not shown, picked or kept selected; a locked layer's are locked", () => {
    const one = addLayer(SHA)!;
    const on = line(0, { layerId: one.id });
    const off = line(50);
    setDocMarkups(SHA, [on, off]);
    setSelection([on.id, off.id]);
    setLayerHidden(SHA, one.id, true);
    expect(pageMarkups(editorStore.getState(), SHA, PAGE).map((m) => m.id)).toEqual([off.id]);
    expect(editorStore.getState().selection.ids).toEqual([off.id]);
    expect(measurePainter.paintStatic(anyContext(), view)).toEqual(["Line"]);
    // Not picked by a click.
    setTool("select");
    const ctx = { documentId: SHA, pageIndex: 0, view, device: { x: -9999, y: -9999 }, px: 1, tolerance: 5, shift: false, alt: false, ctrl: false };
    measurePainter.select!("start", { x: 50, y: 1 }, ctx);
    measurePainter.select!("end", { x: 50, y: 1 }, ctx);
    expect(editorStore.getState().selection.ids).toEqual([]);
    setLayerHidden(SHA, one.id, false);
    setLayerLocked(SHA, one.id, true);
    expect(isLocked(all()[0])).toBe(true);
    expect(isLocked(all()[1])).toBe(false);
    // Moving a locked layer's markup to another layer: kept, with the locked note.
    expect(assignLayer(SHA, [all()[0]], null)).toBe(false);
  });

  it("markups move to a layer, one undo step", () => {
    const one = addLayer(SHA)!;
    setDocMarkups(SHA, [line(0), line(50)]);
    expect(assignLayer(SHA, all(), one.id)).toBe(true);
    expect(all().map((m) => m.layerId)).toEqual([one.id, one.id]);
    expect(layerScope(SHA, one.id)).toEqual({ markups: 2, pages: 1 });
    undoActive();
    expect(all().map((m) => m.layerId)).toEqual([undefined, undefined]);
  });

  it("deleting a layer moves or deletes its markups in the same undo step", () => {
    const one = addLayer(SHA)!;
    const two = addLayer(SHA)!;
    const a = line(0, { layerId: one.id });
    const b = line(50);
    setDocMarkups(SHA, [a, b]);
    deleteLayer(SHA, one.id, { to: two.id });
    expect(layers().map((l) => l.id)).toEqual([two.id]);
    expect(all()[0].layerId).toBe(two.id);
    expect(undoLabel()).toBe(DELETE_LAYER);
    undoActive();
    expect(layers().map((l) => l.id)).toEqual([two.id, one.id]);
    expect(all()[0].layerId).toBe(one.id);
    deleteLayer(SHA, one.id, "delete");
    expect(all().map((m) => m.id)).toEqual([b.id]);
    undoActive();
    // Back where it was in the drawing order.
    expect(all().map((m) => m.id)).toEqual([a.id, b.id]);
    redoActive();
    expect(all().map((m) => m.id)).toEqual([b.id]);
  });

  it("a session record's layer and compound ops belong to its document", () => {
    const record: SessionRecord = {
      v: 1,
      markups: [],
      calibrations: {},
      layers: [{ id: "00000000-0000-7000-8000-00000000000a", name: "Layer 1" }],
      past: [
        {
          label: DELETE_LAYER,
          op: { kind: "compound", documentId: SHA, ops: [{ kind: "markups.remove", documentId: SHA, markups: [line(0)], at: [0] }, { kind: "layers.set", documentId: SHA, before: [], after: [] }] },
        },
      ],
      future: [],
    };
    expect(recordBelongsTo(record, SHA)).toBe(true);
    const foreign = { ...record, past: [{ label: DELETE_LAYER, op: { kind: "compound" as const, documentId: SHA, ops: [{ kind: "markups.remove" as const, documentId: SHA, markups: [line(0, { pageId: "other:0" })], at: [0] }] } }] };
    expect(recordBelongsTo(foreign, SHA)).toBe(false);
  });
});
