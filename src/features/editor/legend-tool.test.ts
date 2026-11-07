import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pageIdOf } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type LegendMarkup, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { ADD_LEGEND } from "./legend-tool";
import { installMeasureTools, measurePainter, paintMarkupsPreview } from "./measure-tool";
import { activeUndoLabels, clearUndo, executeOp } from "./undo-store";

const SHA = "e".repeat(64);
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0 };

/** A context that records each text drawn. */
function recorder() {
  const texts: string[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props ? props[prop] : prop === "measureText" ? (text: string) => ({ width: text.length * 5 }) : (...args: unknown[]) => void (prop === "fillText" && texts.push(String(args[0]))),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: 600 - p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 800,
  height: 600,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

let n = 0;
function device(label: string, pageIndex = 0): Markup {
  return {
    id: `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`,
    pageId: pageIdOf(SHA, pageIndex),
    createdAt: `2026-11-07T00:00:0${n % 10}.000Z`,
    style: DEFAULT_MARKUP_STYLE,
    type: "ellipse",
    points: [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ],
    device: { group: "Sprinklers", label },
  } as Markup;
}
const add = (...markups: Markup[]) => executeOp({ kind: "markups.add", documentId: SHA, markups }, "Add");
const legends = () => markupsOf(editorStore.getState(), SHA).filter((m): m is LegendMarkup => m.type === "legend");
const painted = () => {
  const { ctx, texts } = recorder();
  paintMarkupsPreview(ctx, legends(), view, null);
  return texts;
};

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  measurePainter.paintStatic(recorder().ctx, view);
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Legend tool (Story 7.8)", () => {
  it("a click places a legend of this page's devices, one undo step; then Select has it", () => {
    add(device("Pendant"), device("Pendant"), device("Sidewall", 1));
    setTool("legend");
    expect(measurePainter.place({ x: 300, y: 300 }, AT)).toBe("done");
    const [legend] = legends();
    expect(legend).toMatchObject({ type: "legend", pageId: pageIdOf(SHA, 0), legend: { title: "LEGEND", scope: "page" } });
    expect(viewerStore.getState().tool).toBe("select");
    expect(editorStore.getState().selection.ids).toEqual([legend.id]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_LEGEND);
    expect(painted()).toEqual(["LEGEND", "QTY", "Pendant", "2", "Total", "2"]);
  });

  it("its counts follow the markups (added, deleted, another scope)", () => {
    setTool("legend");
    measurePainter.place({ x: 300, y: 300 }, AT);
    expect(painted()).toEqual(["LEGEND", "QTY", "No devices placed"]);
    const bell = device("Bell");
    add(device("Pendant"), bell, device("Pendant", 1));
    expect(painted()).toEqual(["LEGEND", "QTY", "Bell", "1", "Pendant", "1", "Total", "2"]);
    executeOp({ kind: "markups.remove", documentId: SHA, markups: [bell] }, "Delete");
    expect(painted()).toEqual(["LEGEND", "QTY", "Pendant", "1", "Total", "1"]);
    const [legend] = legends();
    executeOp({ kind: "markups.update", documentId: SHA, before: [legend], after: [{ ...legend, legend: { title: "DEVICES", scope: "document" } }] }, "Edit");
    expect(painted()).toEqual(["DEVICES", "QTY", "Pendant", "2", "Total", "2"]);
  });
});
