import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { pageIdOf } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { setTool, viewerStore, type LayerView, type SelectContext } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor, setDocMarkups, setSelection } from "./editor-store";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { APPLY_FORMAT, changeProperties, copyFormat, formatPainter, selectedMarkups } from "./properties";
import { LOCKED_NOTE, resetSelectTool } from "./select-tool";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const SHA = "e".repeat(64);
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
const at = (): SelectContext => ({ documentId: SHA, pageIndex: 0, view, device: { x: -9999, y: -9999 }, px: 1, tolerance: 5, shift: false, alt: false, ctrl: false });
const click = (x: number, y: number) => {
  measurePainter.select!("start", { x, y }, at());
  measurePainter.select!("end", { x, y }, at());
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
const stored = (id: string) => markupsOf(editorStore.getState(), SHA).find((m) => m.id === id)!;
const undoLabel = () => activeUndoLabels(editorStore.getState(), "t1").undo;

let uninstall: () => void;
let a: Markup;
let b: Markup;
beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, calibrations: {} });
  uninstall = installMeasureTools();
  setTool("select");
  a = line(0);
  b = line(50, { style: { ...DEFAULT_MARKUP_STYLE, color: "#0000ff", width: 3 } });
  setDocMarkups(SHA, [a, b]);
});
afterEach(() => {
  uninstall();
  resetSelectTool({ clipboard: true });
  resetEditor();
  clearUndo();
  formatPainter.setState({ format: null, from: null });
  toastStore.setState({ visible: [], queue: [] });
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Properties edits (Story 5.10)", () => {
  it("a change applies at once to the selection, one undo step", () => {
    setSelection([a.id, b.id]);
    expect(selectedMarkups(SHA).map((m) => m.id)).toEqual([a.id, b.id]);
    expect(changeProperties(SHA, selectedMarkups(SHA), { width: 2 })).toBe(true);
    expect(stored(a.id).style.width).toBe(2);
    expect(stored(b.id).style.width).toBe(2);
    expect(undoLabel()).toBe("Change line width");
    undoActive();
    expect(stored(a.id).style.width).toBe(1);
    expect(stored(b.id).style.width).toBe(3);
    // Nothing to change: no step.
    expect(changeProperties(SHA, [stored(a.id)], { width: 1 })).toBe(false);
  });

  it("locked markups keep their properties; all locked: a note", () => {
    const locked = { ...b, locked: true };
    setDocMarkups(SHA, [a, locked]);
    changeProperties(SHA, [a, locked], { color: "#00a000" });
    expect(stored(a.id).style.color).toBe("#00a000");
    expect(stored(b.id).style.color).toBe("#0000ff");
    expect(changeProperties(SHA, [locked], { color: "#00a000" })).toBe(false);
    expect(toastStore.getState().visible.map((t) => t.title)).toContain(LOCKED_NOTE);
  });

  it("the format painter applies one markup's style to the markup clicked, one undo step, then is put away", () => {
    copyFormat(b);
    expect(formatPainter.getState().from).toBe(b.id);
    click(50, 1);
    expect(stored(a.id).style).toEqual(b.style);
    expect(undoLabel()).toBe(APPLY_FORMAT);
    expect(formatPainter.getState().format).toBeNull();
    // The click applied the format; it did not select.
    expect(editorStore.getState().selection.ids).toEqual([]);
    undoActive();
    expect(stored(a.id).style).toEqual(DEFAULT_MARKUP_STYLE);
  });

  it("Esc, empty space or another tool put the painter away unused", () => {
    copyFormat(b);
    expect(measurePainter.escape!()).toBe(true);
    expect(formatPainter.getState().format).toBeNull();
    copyFormat(b);
    click(50, 25);
    expect(formatPainter.getState().format).toBeNull();
    expect(stored(a.id).style).toEqual(DEFAULT_MARKUP_STYLE);
    copyFormat(b);
    setTool("line");
    expect(formatPainter.getState().format).toBeNull();
  });
});
