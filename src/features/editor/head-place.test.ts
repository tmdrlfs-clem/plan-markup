// Story 9.10: Add head (the Stamp tool in head mode), a dragged head made manual, and the markups mid-gesture.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { toastStore } from "@/components/ui/toast-store";
import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { headCentre, isHead, type HeadMarkup } from "@/core/sprinkler/heads";
import { newZone } from "@/core/sprinkler/zone";
import type { ZoneMarkup } from "@/core/schema/markup";
import { setArmedStamp, stampStore } from "@/features/tool-chest/stamp-store";
import { setTool, viewerStore } from "@/features/viewer";

import { editorStore, gestureMarkups, markupsOf, pageMarkups, resetEditor, setDocMarkups, setMoveDrag, setPreview } from "./editor-store";
import { ADD_HEAD, OUTSIDE_ZONES, armHeadPlace, endHeadPlace } from "./head-place";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { selectionKey } from "./select-tool";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const SHA = "d".repeat(64);
const PAGE = `${SHA}:0`;
const k100 = factorForRatio(100);
const CAL: Calibration = { xFactor: k100, yFactor: k100, unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0.5 };

let a: ZoneMarkup;
let uninstall: () => void;
const heads = () => markupsOf(editorStore.getState(), SHA).filter(isHead);

beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, pages: [{ width: 842, height: 595, rotate: 0 }], calibrations: { [PAGE]: CAL } });
  a = newZone({ id: "00000000-0000-7000-8000-0000000000a1", pageId: PAGE, createdAt: "2026-11-12T00:00:00.000Z", outer: ring(100, 100, 200, 150), holes: [] }, [], CAL);
  setDocMarkups(SHA, [a]);
  uninstall = installMeasureTools();
  toastStore.setState({ visible: [], queue: [] });
});
afterEach(() => {
  uninstall();
  endHeadPlace();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Add head (Story 9.10)", () => {
  it("each click inside a zone adds a manual head of that zone, one undo step each", () => {
    armHeadPlace();
    expect(viewerStore.getState().tool).toBe("stamp");
    expect(measurePainter.place({ x: 150, y: 150 }, AT)).toBe("done");
    expect(measurePainter.place({ x: 250, y: 200 }, AT)).toBe("done");
    expect(heads()).toHaveLength(2);
    const [h] = heads();
    expect(h.head).toEqual({ zoneId: a.id, kind: "manual" });
    expect(headCentre(h).x).toBeCloseTo(150, 6);
    expect(headCentre(h).y).toBeCloseTo(150, 6);
    expect(h.device?.label).toBe("Sprinkler head");
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_HEAD);
    expect(undoActive()).toBe(true);
    expect(heads()).toHaveLength(1);
  });

  it("a click outside every zone adds nothing and says so", () => {
    armHeadPlace();
    expect(measurePainter.place({ x: 20, y: 20 }, AT)).toBe("ignored");
    expect(heads()).toEqual([]);
    expect(toastStore.getState().visible.map((t) => t.title)).toEqual([OUTSIDE_ZONES]);
  });

  it("ends when another tool is chosen or a Tool Chest tool is armed", () => {
    armHeadPlace();
    setTool("select");
    expect(stampStore.getState().heads).toBe(false);
    armHeadPlace();
    setArmedStamp(null);
    expect(stampStore.getState().heads).toBe(false);
  });

  it("a head dragged with Select becomes manual (the move tool path)", () => {
    armHeadPlace();
    measurePainter.place({ x: 150, y: 150 }, AT);
    setTool("select");
    const h = heads()[0];
    // an engine head, as a run leaves it
    setDocMarkups(SHA, [a, { ...h, head: { zoneId: a.id, kind: "row" } }]);
    setMoveDrag({ ids: [h.id], documentId: SHA, delta: { x: 10, y: 0 } });
    // mid-drag the markups as painted and checked carry the move; the stored head has not moved yet
    const live = gestureMarkups(editorStore.getState(), SHA, pageMarkups(editorStore.getState(), SHA, PAGE)).find((m) => m.id === h.id) as HeadMarkup;
    expect(headCentre(live).x).toBeCloseTo(160, 6);
    expect(headCentre(heads()[0]).x).toBeCloseTo(150, 6);
    // the move ends (as a drag's release or an arrow key's) as one step: the head is now manual
    expect(selectionKey({ kind: "nudge-end" }, { documentId: SHA, pageIndex: 0 })).toBe(true);
    expect(headCentre(heads()[0]).x).toBeCloseTo(160, 6);
    expect(heads()[0].head).toEqual({ zoneId: a.id, kind: "manual" });
    expect(undoActive()).toBe(true);
    expect(heads()[0].head.kind).toBe("row");
  });

  it("gestureMarkups adds copies being dragged and leaves the page alone with no gesture", () => {
    const stored = pageMarkups(editorStore.getState(), SHA, PAGE);
    expect(gestureMarkups(editorStore.getState(), SHA, stored)).toBe(stored);
    const copy = { ...a, id: "00000000-0000-7000-8000-0000000000a2" };
    setPreview({ documentId: SHA, changed: {}, added: [copy] });
    expect(gestureMarkups(editorStore.getState(), SHA, stored).map((m) => m.id)).toEqual([a.id, copy.id]);
    setPreview(null);
  });
});
