// The 4541 panel's Add head line: the Line tool's lines become head lines, and Place heads follows them.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { GUIDE_STYLE, GUIDE_SUBJECT, engineZoneOf, guidesOfZone, isGuide } from "@/core/sprinkler/heads";
import { placeSite } from "@/core/sprinkler/engine/site";
import { NZS4541_V1 } from "@/core/sprinkler/rules/rules";
import { newZone } from "@/core/sprinkler/zone";
import type { ZoneMarkup } from "@/core/schema/markup";
import { setTool, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf, resetEditor, setDocMarkups } from "./editor-store";
import { ADD_HEAD_LINE, armGuideDraw, endGuideDraw, guideDrawStore } from "./guide-draw";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { activeUndoLabels, clearUndo, undoActive } from "./undo-store";

const SHA = "e".repeat(64);
const PAGE = `${SHA}:0`;
const k100 = factorForRatio(100);
const CAL: Calibration = { xFactor: k100, yFactor: k100, unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const AT = { documentId: SHA, pageIndex: 0, tolerance: 0.5 };
const mmToPt = (mm: number) => mm / k100;

let zone: ZoneMarkup;
let uninstall: () => void;
const all = () => markupsOf(editorStore.getState(), SHA);

beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, pages: [{ width: 842, height: 595, rotate: 0 }], calibrations: { [PAGE]: CAL } });
  // A 9.678 × 6.711 m room at 1:100, its corner at (100, 100) pt.
  const w = mmToPt(9678);
  const h = mmToPt(6711);
  zone = newZone(
    {
      id: "00000000-0000-7000-8000-0000000000e1",
      pageId: PAGE,
      createdAt: "2026-11-12T00:00:00.000Z",
      outer: [
        { x: 100, y: 100 },
        { x: 100 + w, y: 100 },
        { x: 100 + w, y: 100 + h },
        { x: 100, y: 100 + h },
      ],
      holes: [],
    },
    [],
    CAL,
  );
  setDocMarkups(SHA, [zone]);
  uninstall = installMeasureTools();
});
afterEach(() => {
  uninstall();
  endGuideDraw();
  setTool("select");
  resetEditor();
  clearUndo();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("Add head line", () => {
  it("a line drawn while armed is a head line (one undo step); a line drawn after is a plain line", () => {
    armGuideDraw();
    expect(viewerStore.getState().tool).toBe("line");
    measurePainter.place({ x: 120, y: 130 }, AT);
    measurePainter.place({ x: 300, y: 130 }, AT);
    const [g] = all().filter(isGuide);
    expect(g.style).toEqual(GUIDE_STYLE);
    expect(g.subject).toBe(GUIDE_SUBJECT);
    expect(activeUndoLabels(editorStore.getState(), "t1").undo).toBe(ADD_HEAD_LINE);

    setTool("select");
    expect(guideDrawStore.getState().on).toBe(false);
    setTool("line");
    measurePainter.place({ x: 120, y: 200 }, AT);
    measurePainter.place({ x: 300, y: 200 }, AT);
    expect(all().filter(isGuide)).toHaveLength(1);
    expect(all().filter((m) => m.type === "line")).toHaveLength(2);

    expect(undoActive()).toBe(true);
    expect(undoActive()).toBe(true);
    expect(all().filter((m) => m.type === "line")).toHaveLength(0);
  });

  it("the engine puts the zone's rows on the drawn lines", () => {
    armGuideDraw();
    for (const y of [1028, 5457]) {
      measurePainter.place({ x: 100 + mmToPt(500), y: 100 + mmToPt(y) }, AT);
      measurePainter.place({ x: 100 + mmToPt(9100), y: 100 + mmToPt(y) }, AT);
    }
    const guides = guidesOfZone(all(), zone);
    expect(guides).toHaveLength(2);
    const [o] = placeSite([engineZoneOf(zone, "ELH", CAL, 1, [], guides)], NZS4541_V1);
    expect(o.report?.pass).toBe(true);
    const rows = [...new Set(o.result.heads.map((h) => Math.round(h.y - 100 * k100)))].sort((a, b) => a - b);
    expect(rows).toEqual([1028, 5457]);
  });
});
