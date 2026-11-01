import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { pageIdOf } from "@/core/calibration/calibration";
import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView, type SelectContext } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { DELETE_MARKUPS, MOVE_MARKUP, MOVE_MARKUPS } from "./select-tool";
import { activeUndoLabels, clearUndo, redoActive, undoActive } from "./undo-store";

const SHA = "f".repeat(64);
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

/** A context 1 user unit per CSS px; the device point far from any caption. */
function at(mods: Partial<SelectContext> = {}): SelectContext {
  return { documentId: SHA, pageIndex: 0, view, device: { x: -9999, y: -9999 }, px: 1, tolerance: 5, shift: false, alt: false, ...mods };
}

let n = 0;
function length(x0: number, y0: number, x1: number, y1: number, pageId = PAGE): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId,
    createdAt: "2026-11-02T00:00:00.000Z",
    style: DEFAULT_MEASURE_STYLE,
    type: "length",
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y1 },
    ],
  };
}

const ids = () => editorStore.getState().selection.ids;
const click = (x: number, y: number, mods: Partial<SelectContext> = {}) => {
  measurePainter.select!("start", { x, y }, at(mods));
  measurePainter.select!("end", { x, y }, at(mods));
};
const drag = (from: { x: number; y: number }, to: { x: number; y: number }, mods: Partial<SelectContext> = {}, via: { x: number; y: number }[] = []) => {
  measurePainter.select!("start", from, at(mods));
  for (const p of [...via, to]) measurePainter.select!("move", p, at(mods));
  measurePainter.select!("end", to, at(mods));
};

let uninstall: () => void;
let a: Markup;
let b: Markup;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  setTool("select");
  a = length(0, 0, 100, 0);
  b = length(0, 50, 100, 50);
  setDocMarkups(SHA, [a, b, length(0, 0, 10, 10, pageIdOf(SHA, 1))]);
});
afterEach(() => {
  uninstall();
  resetEditor();
  clearUndo();
  toastStore.setState({ visible: [], queue: [] });
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Select tool (Story 5.1)", () => {
  it("a click selects the topmost markup within the tolerance; empty space clears; Shift + click toggles", () => {
    click(50, 3);
    expect(ids()).toEqual([a.id]);
    click(50, 48);
    expect(ids()).toEqual([b.id]);
    click(50, 2, { shift: true });
    expect(ids()).toEqual([b.id, a.id]);
    click(50, 49, { shift: true });
    expect(ids()).toEqual([a.id]);
    click(50, 25, { shift: true });
    expect(ids()).toEqual([a.id]);
    click(50, 25);
    expect(ids()).toEqual([]);
    expect(measurePainter.hitAt!({ x: 50, y: 4 }, at())).toBe(true);
    expect(measurePainter.hitAt!({ x: 50, y: 25 }, at())).toBe(false);
  });

  it("a marquee selects markups wholly inside (Shift adds); Alt + drag lassoes", () => {
    drag({ x: -10, y: -10 }, { x: 110, y: 10 });
    expect(ids()).toEqual([a.id]);
    drag({ x: 110, y: 60 }, { x: -10, y: 40 }, { shift: true });
    expect(ids()).toEqual([a.id, b.id]);
    // Not wholly inside: nothing.
    drag({ x: 10, y: -10 }, { x: 110, y: 60 });
    expect(ids()).toEqual([]);
    drag({ x: -10, y: 40 }, { x: -10, y: 60 }, { alt: true }, [{ x: 110, y: 40 }, { x: 110, y: 60 }]);
    expect(ids()).toEqual([b.id]);
  });

  it("dragging a markup moves it (one undo step); a selected one moves the selection; under 3 px is a click", () => {
    drag({ x: 50, y: 0 }, { x: 60, y: 20 });
    expect(ids()).toEqual([a.id]);
    expect(markupsOf(editorStore.getState(), SHA)[0].points).toEqual([{ x: 10, y: 20 }, { x: 110, y: 20 }]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(MOVE_MARKUP);
    undoActive();
    expect(markupsOf(editorStore.getState(), SHA)[0].points[0]).toEqual({ x: 0, y: 0 });
    redoActive();
    setSelection([a.id, b.id]);
    drag({ x: 50, y: 50 }, { x: 50, y: 40 });
    expect(markupsOf(editorStore.getState(), SHA).slice(0, 2).map((m) => m.points[0])).toEqual([{ x: 10, y: 10 }, { x: 0, y: 40 }]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(MOVE_MARKUPS);
    drag({ x: 50, y: 40 }, { x: 51, y: 41 });
    expect(markupsOf(editorStore.getState(), SHA)[1].points[0]).toEqual({ x: 0, y: 40 });
    expect(ids()).toEqual([b.id]);
  });

  it("the move is previewed while dragging and put back by a cancel", () => {
    measurePainter.select!("start", { x: 50, y: 0 }, at());
    measurePainter.select!("move", { x: 50, y: 30 }, at());
    expect(editorStore.getState().tools.moveDrag).toMatchObject({ ids: [a.id], delta: { x: 0, y: 30 } });
    measurePainter.select!("cancel", { x: 50, y: 30 }, at());
    expect(editorStore.getState().tools.moveDrag).toBeNull();
    expect(markupsOf(editorStore.getState(), SHA)[0].points[0]).toEqual({ x: 0, y: 0 });
  });

  it("arrows nudge the selection; a hold is one undo step on release", () => {
    const key = measurePainter.selectionKey!;
    const page = { documentId: SHA, pageIndex: 0 };
    expect(key({ kind: "nudge", dx: 1, dy: 0 }, page)).toBe(false);
    setSelection([a.id]);
    expect(key({ kind: "nudge", dx: 1, dy: 0 }, page)).toBe(true);
    key({ kind: "nudge", dx: 1, dy: 0 }, page);
    key({ kind: "nudge", dx: 0, dy: 10 }, page);
    expect(key({ kind: "nudge-end" }, page)).toBe(true);
    expect(markupsOf(editorStore.getState(), SHA)[0].points[0]).toEqual({ x: 2, y: 10 });
    undoActive();
    expect(markupsOf(editorStore.getState(), SHA)[0].points[0]).toEqual({ x: 0, y: 0 });
  });

  it("Delete removes the selection as one step with a toast offering Undo; Ctrl+A selects the page", () => {
    const key = measurePainter.selectionKey!;
    const page = { documentId: SHA, pageIndex: 0 };
    expect(key({ kind: "delete" }, page)).toBe(false);
    expect(key({ kind: "all" }, page)).toBe(true);
    expect(ids()).toEqual([a.id, b.id]);
    expect(key({ kind: "delete" }, page)).toBe(true);
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(1);
    expect(ids()).toEqual([]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(DELETE_MARKUPS);
    const [shown] = toastStore.getState().visible;
    expect(shown.title).toBe("Deleted 2 markups");
    shown.action!.onAction();
    expect(markupsOf(editorStore.getState(), SHA).map((m) => m.id)).toEqual([a.id, b.id, expect.any(String)]);
  });

  it("another page or tool clears the selection", () => {
    setSelection([a.id]);
    viewerStore.setState({ pageIndex: 1 });
    expect(ids()).toEqual([]);
    viewerStore.setState({ pageIndex: 0 });
    setSelection([a.id]);
    setTool("length");
    expect(ids()).toEqual([]);
  });
});
