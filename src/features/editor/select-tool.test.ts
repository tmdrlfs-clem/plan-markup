import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { pageIdOf } from "@/core/calibration/calibration";
import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView, type SelectContext } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { installMeasureTools, measurePainter } from "./measure-tool";
import {
  ALIGN_MARKUPS,
  COPY_MARKUP,
  CROSSING_AREA,
  DELETE_MARKUPS,
  GROUP_MARKUPS,
  LOCK_MARKUP,
  LOCKED_NOTE,
  MOVE_MARKUP,
  MOVE_MARKUPS,
  MOVE_VERTEX,
  ORDER_LABEL,
  PASTE_MARKUP,
  RESIZE_MARKUP,
  RESTORE_MARKUPS,
  ROTATE_MARKUP,
  UNGROUP_MARKUPS,
  UNLOCK_MARKUP,
  resetSelectTool,
} from "./select-tool";
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
  return { documentId: SHA, pageIndex: 0, view, device: { x: -9999, y: -9999 }, px: 1, tolerance: 5, shift: false, alt: false, ctrl: false, ...mods };
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
  resetSelectTool({ clipboard: true });
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
    expect(measurePainter.cursorAt!({ x: 50, y: 4 }, at())).toBe("move");
    expect(measurePainter.cursorAt!({ x: 50, y: 4 }, at({ ctrl: true }))).toBe("copy");
    expect(measurePainter.cursorAt!({ x: 50, y: 25 }, at())).toBeNull();
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

  it("review R1: the toast's Undo after another edit restores the deleted markups, not the other edit", () => {
    const key = measurePainter.selectionKey!;
    const page = { documentId: SHA, pageIndex: 0 };
    setSelection([a.id]);
    key({ kind: "delete" }, page);
    const [shown] = toastStore.getState().visible;
    drag({ x: 50, y: 50 }, { x: 50, y: 60 });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(MOVE_MARKUP);
    shown.action!.onAction();
    const list = markupsOf(editorStore.getState(), SHA);
    expect(list.map((m) => m.id)).toEqual([a.id, b.id, expect.any(String)]);
    expect(list[1].points[0]).toEqual({ x: 0, y: 60 });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(RESTORE_MARKUPS);
    // Again: nothing is missing any more.
    shown.action!.onAction();
    expect(markupsOf(editorStore.getState(), SHA)).toHaveLength(3);
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

describe("Resize, rotate, vertices, copy and paste (Story 5.2)", () => {
  const RECT = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 250 },
    { x: 100, y: 250 },
  ];
  let area: Markup;
  beforeEach(() => {
    area = { ...length(0, 0, 1, 1), type: "area", points: RECT } as Markup;
    setDocMarkups(SHA, [area]);
    setSelection([area.id]);
  });
  /** A drag from user point `from` with the pointer's device point at its toDevice (x, -y). */
  const dragAt = (from: { x: number; y: number }, to: { x: number; y: number }, mods: Partial<SelectContext> = {}) => {
    const ctx = (p: { x: number; y: number }) => at({ device: { x: p.x, y: -p.y }, ...mods });
    measurePainter.select!("start", from, ctx(from));
    measurePainter.select!("move", to, ctx(to));
    measurePainter.select!("end", to, ctx(to));
  };
  const stored = () => markupsOf(editorStore.getState(), SHA);

  it("a corner handle (outside the box) resizes from the opposite corner; one undo step", () => {
    // The top-right handle sits 8 px out from the corner (300, 250).
    expect(measurePainter.cursorAt!({ x: 308, y: 258 }, at({ device: { x: 308, y: -258 } }))).toBe("nesw-resize");
    dragAt({ x: 308, y: 258 }, { x: 508, y: 408 });
    expect(stored()[0].points).toEqual([{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 }]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(RESIZE_MARKUP);
    undoActive();
    expect(stored()[0].points).toEqual(RECT);
  });

  it("the rotate handle turns about the box's centre in 15° steps", () => {
    expect(measurePainter.cursorAt!({ x: 200, y: 274 }, at({ device: { x: 200, y: -274 } }))).toBe("crosshair");
    dragAt({ x: 200, y: 274 }, { x: 103, y: 178 });
    const [p] = stored()[0].points;
    expect(p.x).toBeCloseTo(275, 9);
    expect(p.y).toBeCloseTo(75, 9);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ROTATE_MARKUP);
  });

  it("a vertex handle moves one vertex; a crossing area goes back with a note", () => {
    dragAt({ x: 300, y: 100 }, { x: 320, y: 90 });
    expect(stored()[0].points[1]).toEqual({ x: 320, y: 90 });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(MOVE_VERTEX);
    dragAt({ x: 100, y: 100 }, { x: 350, y: 200 });
    expect(stored()[0].points[0]).toEqual({ x: 100, y: 100 });
    expect(toastStore.getState().visible[0].title).toBe(CROSSING_AREA);
  });

  it("the preview follows the drag and a cancel puts it back", () => {
    const ctx = at({ device: { x: 308, y: -258 } });
    measurePainter.select!("start", { x: 308, y: 258 }, ctx);
    measurePainter.select!("move", { x: 408, y: 258 }, ctx);
    expect(editorStore.getState().tools.preview?.changed[area.id].points[1]).toEqual({ x: 400, y: 100 });
    measurePainter.select!("cancel", { x: 408, y: 258 }, ctx);
    expect(editorStore.getState().tools.preview).toBeNull();
    expect(stored()[0].points).toEqual(RECT);
  });

  it("Ctrl + drag copies (Shift: along 45° steps) and selects the copy", () => {
    dragAt({ x: 150, y: 175 }, { x: 200, y: 180 }, { ctrl: true, shift: true });
    expect(stored()).toHaveLength(2);
    expect(stored()[1].points[0]).toEqual({ x: 150, y: 100 });
    expect(stored()[1].id).not.toBe(area.id);
    expect(ids()).toEqual([stored()[1].id]);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(COPY_MARKUP);
  });

  it("Ctrl+C / Ctrl+V pastes centred at the pointer; Ctrl+Shift+V in place; on the shown page", () => {
    const key = measurePainter.selectionKey!;
    const page = { documentId: SHA, pageIndex: 0 };
    expect(key({ kind: "paste", inPlace: false, at: { x: 0, y: 0 } }, page)).toBe(false);
    expect(key({ kind: "copy" }, page)).toBe(true);
    expect(key({ kind: "paste", inPlace: false, at: { x: 500, y: 500 } }, page)).toBe(true);
    expect(stored()[1].points[0]).toEqual({ x: 400, y: 425 });
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(PASTE_MARKUP);
    key({ kind: "paste", inPlace: true, at: { x: 0, y: 0 } }, { documentId: SHA, pageIndex: 1 });
    expect(stored()[2]).toMatchObject({ pageId: pageIdOf(SHA, 1), points: RECT });
    expect(ids()).toEqual([stored()[2].id]);
  });
});

describe("Group, align, reorder and lock (Story 5.3)", () => {
  const key = (k: Parameters<NonNullable<typeof measurePainter.selectionKey>>[0]) => measurePainter.selectionKey!(k, { documentId: SHA, pageIndex: 0, view });
  const stored = (id: string) => markupsOf(editorStore.getState(), SHA).find((m) => m.id === id)!;
  const order = () => markupsOf(editorStore.getState(), SHA).map((m) => m.id);
  const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;

  it("Ctrl+G groups the selection; a click on one member selects the group; ungroup; each one step", () => {
    setSelection([a.id, b.id]);
    expect(key({ kind: "group" })).toBe(true);
    expect(undoLabel()).toBe(GROUP_MARKUPS);
    expect(stored(a.id).groupId).toBeDefined();
    expect(stored(a.id).groupId).toBe(stored(b.id).groupId);
    // One group already: nothing more.
    expect(key({ kind: "group" })).toBe(false);
    click(50, 200);
    click(50, 0);
    expect(ids()).toEqual([a.id, b.id]);
    // The group moves as one.
    drag({ x: 50, y: 0 }, { x: 50, y: 20 });
    expect(stored(b.id).points[0]).toEqual({ x: 0, y: 70 });
    undoActive();
    expect(key({ kind: "ungroup" })).toBe(true);
    expect(undoLabel()).toBe(UNGROUP_MARKUPS);
    expect("groupId" in stored(a.id)).toBe(false);
    click(50, 0);
    expect(ids()).toEqual([a.id]);
    undoActive();
    expect(stored(a.id).groupId).toBe(stored(b.id).groupId);
  });

  it("reorders within the page: front / backward change what is hit first; no change, no step", () => {
    const c = length(0, 0, 100, 0);
    setDocMarkups(SHA, [...markupsOf(editorStore.getState(), SHA), c]);
    click(50, 0);
    expect(ids()).toEqual([c.id]);
    setSelection([a.id]);
    expect(key({ kind: "order", step: "front" })).toBe(true);
    expect(undoLabel()).toBe(ORDER_LABEL.front);
    click(50, 0);
    expect(ids()).toEqual([a.id]);
    // On top already: nothing.
    expect(key({ kind: "order", step: "forward" })).toBe(false);
    expect(key({ kind: "order", step: "backward" })).toBe(true);
    click(50, 0);
    expect(ids()).toEqual([c.id]);
    undoActive();
    undoActive();
    expect(order()[0]).toBe(a.id);
    // The other page's markup keeps its slot.
    expect(order()[2]).not.toBe(c.id);
  });

  it("aligns units with the selection's box as the screen shows it (y down); locked units stay", () => {
    const d = length(200, 100, 300, 100);
    setDocMarkups(SHA, [...markupsOf(editorStore.getState(), SHA), d]);
    setSelection([a.id, d.id]);
    expect(key({ kind: "align", to: "left" })).toBe(true);
    expect(undoLabel()).toBe(ALIGN_MARKUPS);
    expect(stored(d.id).points[0]).toEqual({ x: 0, y: 100 });
    // Top on screen is the highest y in user space here.
    expect(key({ kind: "align", to: "top" })).toBe(true);
    expect(stored(a.id).points[0]).toEqual({ x: 0, y: 100 });
    undoActive();
    key({ kind: "lock", locked: true });
    setSelection([a.id, d.id]);
    // Both locked: nothing moves.
    expect(key({ kind: "align", to: "top" })).toBe(false);
    // One unit only: nothing.
    setSelection([a.id]);
    expect(key({ kind: "align", to: "right" })).toBe(false);
  });

  it("locked markups are selected but not moved, nudged or deleted, with a note; mixed: only the others change", () => {
    setSelection([a.id]);
    expect(key({ kind: "lock", locked: true })).toBe(true);
    expect(undoLabel()).toBe(LOCK_MARKUP);
    expect(measurePainter.cursorAt!({ x: 50, y: 0 }, at())).toBe("not-allowed");
    expect(measurePainter.cursorAt!({ x: 50, y: 0 }, at({ ctrl: true }))).toBe("copy");
    drag({ x: 50, y: 0 }, { x: 50, y: -40 });
    expect(stored(a.id).points[0]).toEqual({ x: 0, y: 0 });
    expect(ids()).toEqual([a.id]);
    expect(toastStore.getState().visible.map((t) => t.title)).toEqual([LOCKED_NOTE]);
    expect(key({ kind: "nudge", dx: 1, dy: 0 })).toBe(true);
    expect(editorStore.getState().tools.moveDrag).toBeNull();
    expect(key({ kind: "delete" })).toBe(true);
    expect(stored(a.id)).toBeDefined();
    setSelection([a.id, b.id]);
    key({ kind: "delete" });
    expect(markupsOf(editorStore.getState(), SHA).some((m) => m.id === b.id)).toBe(false);
    expect(toastStore.getState().visible.at(-1)?.title ?? toastStore.getState().queue.at(-1)?.title).toBe("Deleted 1 markup, kept 1 locked");
    // Copies are unlocked.
    setSelection([a.id]);
    key({ kind: "copy" });
    key({ kind: "paste", inPlace: true, at: { x: 0, y: 0 } });
    expect(stored(ids()[0]).locked).toBeUndefined();
    setSelection([a.id]);
    expect(key({ kind: "lock", locked: false })).toBe(true);
    expect(undoLabel()).toBe(UNLOCK_MARKUP);
    expect("locked" in stored(a.id)).toBe(false);
    // Nothing to unlock: no step.
    expect(key({ kind: "lock", locked: false })).toBe(false);
  });

  it("review R1-R2: a drag from a locked markup moves nothing; its caption stays (Shift + click still selects)", () => {
    setSelection([a.id]);
    key({ kind: "lock", locked: true });
    setSelection([a.id, b.id]);
    drag({ x: 50, y: 0 }, { x: 50, y: -40 });
    expect(stored(b.id).points[0]).toEqual({ x: 0, y: 50 });
    expect(toastStore.getState().visible.map((t) => t.title)).toEqual([LOCKED_NOTE]);
    measurePainter.dragCaption(a.id, SHA, { x: 10, y: 0 });
    expect(editorStore.getState().tools.captionDrag?.delta).toEqual({ x: 0, y: 0 });
    expect(measurePainter.endCaptionDrag(true)).toBe(false);
    expect(stored(a.id).captionOffset).toBeUndefined();
    expect(ids()).toEqual([b.id]);
  });

  it("a right-click selects the markup under it (its group) and opens the menu; empty space clears", () => {
    setSelection([a.id]);
    expect(measurePainter.contextMenu!({ x: 50, y: 50 }, at(), { x: 300, y: 200 }, false)).toBe(true);
    expect(ids()).toEqual([b.id]);
    expect(editorStore.getState().tools.menu).toMatchObject({ documentId: SHA, pageIndex: 0, point: { x: 50, y: 50 }, client: { x: 300, y: 200 } });
    // On the selection: kept.
    setSelection([a.id, b.id]);
    measurePainter.contextMenu!({ x: 50, y: 50 }, at(), { x: 0, y: 0 }, false);
    expect(ids()).toEqual([a.id, b.id]);
    // The menu key keeps the selection; empty space clears it.
    measurePainter.contextMenu!({ x: 500, y: 500 }, at(), { x: 0, y: 0 }, true);
    expect(ids()).toEqual([a.id, b.id]);
    measurePainter.contextMenu!({ x: 500, y: 500 }, at(), { x: 0, y: 0 }, false);
    expect(ids()).toEqual([]);
    // Another tool closes it.
    setTool("pan");
    expect(editorStore.getState().tools.menu).toBeNull();
  });
});
