import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { toolContentOf } from "@/core/tools/tool";
import { resetStamps, setArmedStamp, setDraggedStamp, type StampTool } from "@/features/tool-chest/stamp-store";
import { setTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor } from "./editor-store";
import { NO_STAMP, PLACE_TOOL, installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo } from "./undo-store";

const SHA = "b".repeat(64);
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0 };
const cal = (ratio: number): Calibration => ({ xFactor: factorForRatio(ratio), yFactor: factorForRatio(ratio), unit: "mm", precision: "0", source: "ratio", ratio }) as Calibration;

function recorder() {
  const ops: string[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) => (prop in props ? props[prop] : prop === "measureText" ? (text: string) => ({ width: text.length * 5 }) : () => void ops.push(prop)),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
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

const box: Markup = {
  id: "00000000-0000-7000-8000-000000000001",
  pageId: "src:0",
  createdAt: "2026-11-07T00:00:00.000Z",
  style: DEFAULT_MARKUP_STYLE,
  type: "rectangle",
  points: [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
  ],
} as Markup;

function stamp(calibration: Calibration | null): StampTool {
  return { id: "tool-1", name: "Pendant", content: toolContentOf([box], { calibration, userUnit: 1 })!.content, imageSrc: null, device: { group: "Sprinklers", label: "Pendant", description: "" } };
}

const added = () => markupsOf(editorStore.getState(), SHA);
const toasts = () => toastStore.getState().visible.map((t) => t.title);

let uninstall: () => void;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  measurePainter.paintStatic(recorder().ctx, view);
});
afterEach(() => {
  uninstall();
  setTool("select");
  resetStamps();
  resetEditor();
  clearUndo();
  toastStore.setState({ visible: [], queue: [] });
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Stamp: placing Tool Chest tools (Story 7.3)", () => {
  it("each click places the armed tool with its top-left corner there (one undo step each); it stays armed", () => {
    setArmedStamp(stamp(null));
    setTool("stamp");
    expect(measurePainter.place({ x: 300, y: 200 }, AT)).toBe("done");
    expect(measurePainter.place({ x: 500, y: 200 }, AT)).toBe("done");
    expect(viewerStore.getState().tool).toBe("stamp");
    const [a, b] = added();
    // The 40 x 20 box hangs right and down from the click on screen (user space is y up here).
    expect(a.points).toEqual([{ x: 300, y: 180 }, { x: 340, y: 180 }, { x: 340, y: 200 }, { x: 300, y: 200 }]);
    expect(b.points[0]).toEqual({ x: 500, y: 180 });
    expect(a.device).toEqual({ group: "Sprinklers", label: "Pendant" });
    expect(a.pageId).toBe(pageIdOf(SHA, 0));
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(PLACE_TOOL);
  });

  it("a tool drawn at a scale needs the page's scale; at 1:50 a 1:100 tool is twice the paper size", () => {
    setArmedStamp(stamp(cal(100)));
    setTool("stamp");
    expect(measurePainter.place({ x: 300, y: 200 }, AT)).toBe("ignored");
    expect(added()).toHaveLength(0);
    expect(toasts()).toEqual(["“Pendant” needs this page's scale"]);
    viewerStore.setState({ calibrations: { [pageIdOf(SHA, 0)]: cal(50) } });
    expect(measurePainter.place({ x: 300, y: 200 }, AT)).toBe("done");
    const p = added()[0].points;
    expect(p[2]!.x - p[0].x).toBeCloseTo(80);
    expect(p[2]!.y - p[0].y).toBeCloseTo(40);
  });

  it("S with nothing chosen says to choose a tool; the ghost follows the pointer", () => {
    setTool("stamp");
    expect(measurePainter.place({ x: 300, y: 200 }, AT)).toBe("ignored");
    expect(toasts()).toEqual([NO_STAMP]);
    setArmedStamp(stamp(null));
    const r = recorder();
    measurePainter.paintActive(r.ctx, view, { x: 300, y: 200 });
    expect(r.ops).toContain("stroke");
    const none = recorder();
    measurePainter.paintActive(none.ctx, view, null);
    expect(none.ops).not.toContain("stroke");
  });

  it("a dropped tile is placed once, whatever the tool, held by its top-left corner", () => {
    expect(measurePainter.drop!({ x: 100, y: 100 }, { documentId: SHA, pageIndex: 0, view })).toBe(false);
    setDraggedStamp(stamp(null));
    expect(measurePainter.drop!({ x: 100, y: 100 }, { documentId: SHA, pageIndex: 0, view })).toBe(true);
    expect(added()).toHaveLength(1);
    expect(added()[0].points[0]).toEqual({ x: 100, y: 80 });
    expect(viewerStore.getState().tool).toBe("select");
  });

  it("the ghost follows every move with the Stamp tool, and a dragged tile's ghost shows whatever the tool", () => {
    expect(measurePainter.followsPointer).toBe(false);
    setTool("stamp");
    expect(measurePainter.followsPointer).toBe(true);
    setTool("select");
    setDraggedStamp(stamp(null));
    expect(measurePainter.followsPointer).toBe(true);
    const r = recorder();
    measurePainter.paintActive(r.ctx, view, { x: 300, y: 200 });
    expect(r.ops).toContain("stroke");
    setDraggedStamp(null);
    const none = recorder();
    measurePainter.paintActive(none.ctx, view, { x: 300, y: 200 });
    expect(none.ops).not.toContain("stroke");
  });
});
