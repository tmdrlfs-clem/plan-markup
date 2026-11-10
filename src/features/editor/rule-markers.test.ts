// Story 9.11: rule-break markers on the canvas, their hit test, and showing a break.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factorForRatio, pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { pageScaleOf, toMm } from "@/core/sprinkler/heads";
import type { Flag, OracleReport } from "@/core/sprinkler/oracle";
import { setChecks, zoneCheckStore } from "@/features/sprinkler/check-store";
import { registerViewerEngine } from "@/features/viewer/viewer-commands";
import { viewerStore, type LayerView, type SelectContext } from "@/features/viewer";

import { editorStore, resetEditor } from "./editor-store";
import { installMeasureTools, measurePainter } from "./measure-tool";
import { MARKER_ERROR_COLOR, MARKER_WARNING_COLOR, markersOf, paintRuleMarkers, revealFlag, resetRuleMarkers, ruleMarkerAt } from "./rule-markers";

const SHA = "b".repeat(64);
const PAGE = pageIdOf(SHA, 0);
const k100 = factorForRatio(100);
const CAL: Calibration = { xFactor: k100, yFactor: k100, unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const ZONE = "00000000-0000-7000-8000-0000000000c1";
const scale = pageScaleOf(CAL);

// Upright, 1 device px per point.
const view: LayerView = {
  documentId: SHA,
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 1000,
  height: 1000,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

function recorder() {
  const ops: { op: string; args: unknown[]; style?: unknown }[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props
        ? props[prop]
        : prop === "measureText"
          ? (text: string) => ({ width: text.length * 6 })
          : (...args: unknown[]) => ops.push({ op: prop, args, style: props.fillStyle }),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, ops };
}

const flag = (f: Partial<Flag> & Pick<Flag, "code">): Flag => ({ severity: "error", headIds: [], message: "", ...f });
function report(flags: Flag[]): OracleReport {
  const errors = flags.filter((f) => f.severity === "error").length;
  return {
    ruleSet: null,
    figures: { Amax: 12e6, Smax: 4000, Smin: 2000, Wmin: 100, Wmax: 2000, Rc: 2500 },
    headCount: 2,
    areaM2: 24,
    areaPerHeadM2: 12,
    maxLocalAreaM2: 12,
    minSpacingM: 3,
    maxNNSpacingM: 3,
    worstWallDistM: 1.5,
    minWallDistM: 1.5,
    coverage: 1,
    samples: { lattice: 1, boundary: 1 },
    flags,
    errors,
    warnings: flags.length - errors,
    pass: errors === 0,
  };
}

const at = (p: { x: number; y: number }) => toMm(p, scale);
const reveal = vi.fn();
let unregister: () => void = () => undefined;
let uninstall: () => void = () => undefined;

beforeEach(() => {
  viewerStore.setState({ tabId: "t1", documentId: SHA, openSeq: 1, pageIndex: 0, pages: [{ width: 842, height: 595, rotate: 0 }], calibrations: { [PAGE]: CAL } });
  unregister = registerViewerEngine({ zoomStep: vi.fn(), fitPage: vi.fn(), fitWidth: vi.fn(), rotate: vi.fn(), focusCanvas: vi.fn(), goToPage: vi.fn(), currentPage: 0, pageCount: 1, revealUserRect: reveal });
  setChecks(
    {
      pageId: PAGE,
      reports: {
        [ZONE]: report([
          flag({ code: "MAX_SPACING", value: 4800, limit: 4000, where: at({ x: 200, y: 100 }) }),
          flag({ code: "AREA_LOCAL", severity: "warning", value: 13, limit: 12, where: at({ x: 400, y: 300 }) }),
          flag({ code: "RULES_UNVERIFIED", severity: "warning" }), // no place: listed, not pinned
        ]),
      },
    },
    true,
  );
});
afterEach(() => {
  uninstall();
  unregister();
  reveal.mockReset();
  resetRuleMarkers();
  setChecks({}, true);
  resetEditor();
  viewerStore.setState({ tabId: null, documentId: null, calibrations: {} });
});

describe("rule-break markers (Story 9.11)", () => {
  it("pins each break that has a place, warnings under errors, labelled briefly", () => {
    const ms = markersOf(CAL, 1);
    expect(ms.map((m) => [m.ref.index, m.severity, m.label])).toEqual([
      [1, "warning", "Cell 13 m² > 12 m²"],
      [0, "error", "Spacing 4.8 m > 4 m"],
    ]);
    expect(ms[1].at.x).toBeCloseTo(200, 6);

    const { ctx, ops } = recorder();
    paintRuleMarkers(ctx, view, CAL);
    const texts = ops.filter((o) => o.op === "fillText").map((o) => [o.args[0], o.style]);
    expect(texts).toEqual([
      ["Cell 13 m² > 12 m²", MARKER_WARNING_COLOR],
      ["Spacing 4.8 m > 4 m", MARKER_ERROR_COLOR],
    ]);
    // nothing on another page's view, or without a scale
    const other = recorder();
    paintRuleMarkers(other.ctx, { ...view, pageIndex: 1 }, CAL);
    paintRuleMarkers(other.ctx, view, null);
    expect(other.ops.filter((o) => o.op === "fillText")).toEqual([]);
  });

  it("hits a marker by its symbol or its label; the focused one gets a ring", () => {
    paintRuleMarkers(recorder().ctx, view, CAL);
    expect(ruleMarkerAt({ x: 203, y: 102 }, { documentId: SHA, pageIndex: 0 })).toEqual({ zoneId: ZONE, index: 0 });
    expect(ruleMarkerAt({ x: 240, y: 100 }, { documentId: SHA, pageIndex: 0 })).toEqual({ zoneId: ZONE, index: 0 }); // the label
    expect(ruleMarkerAt({ x: 600, y: 600 }, { documentId: SHA, pageIndex: 0 })).toBeNull();
    expect(ruleMarkerAt({ x: 200, y: 100 }, { documentId: SHA, pageIndex: 1 })).toBeNull();

    revealFlag({ zoneId: ZONE, index: 0 });
    const { ctx, ops } = recorder();
    paintRuleMarkers(ctx, view, CAL);
    expect(ops.filter((o) => o.op === "arc").length).toBe(2); // the error's symbol and its ring (the warning is a triangle)
  });

  it("showing a break zooms to it, selects its zone and focuses it; one without a place only selects", () => {
    revealFlag({ zoneId: ZONE, index: 0 });
    expect(zoneCheckStore.getState().focus).toEqual({ zoneId: ZONE, index: 0 });
    expect(editorStore.getState().selection.ids).toEqual([ZONE]);
    const [page, rect] = reveal.mock.calls[0];
    expect(page).toBe(0);
    expect(rect.x + rect.width / 2).toBeCloseTo(200, 6);
    expect(rect.y + rect.height / 2).toBeCloseTo(100, 6);
    reveal.mockReset();
    revealFlag({ zoneId: ZONE, index: 2 });
    expect(reveal).not.toHaveBeenCalled();
    expect(zoneCheckStore.getState().focus).toEqual({ zoneId: ZONE, index: 2 });
  });

  it("a Select click on a marker shows its break instead of selecting markups", () => {
    uninstall = installMeasureTools();
    paintRuleMarkers(recorder().ctx, view, CAL);
    const ctxAt = (device: { x: number; y: number }): SelectContext => ({ documentId: SHA, pageIndex: 0, view, device, px: 1, tolerance: 5, shift: false, alt: false, ctrl: false });
    expect(measurePainter.cursorAt?.({ x: 400, y: 300 }, ctxAt({ x: 400, y: 300 }))).toBe("pointer");
    measurePainter.select!("start", { x: 400, y: 300 }, ctxAt({ x: 400, y: 300 }));
    measurePainter.select!("end", { x: 400, y: 300 }, ctxAt({ x: 400, y: 300 }));
    expect(zoneCheckStore.getState().focus).toEqual({ zoneId: ZONE, index: 1 });
    expect(reveal).toHaveBeenCalledTimes(1);
  });
});
