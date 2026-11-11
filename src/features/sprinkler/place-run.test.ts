// Story 9.8: Place heads against the real engine (EngineHost in process, no Worker).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import type { Markup, ZoneMarkup } from "@/core/schema/markup";
import { headMarkup, isHead, pageScaleOf, type HeadMarkup } from "@/core/sprinkler/heads";
import type { EngineReply } from "@/core/sprinkler/engine/protocol";
import { NZS4541_V1, USE_HAZARD_V1 } from "@/core/sprinkler/rules/rules";
import { newZone } from "@/core/sprinkler/zone";
import { editorStore, resetEditor, setDocMarkups, setSelection } from "@/features/editor/editor-store";
import { coverageStore } from "@/features/editor/coverage-overlay";
import { redoActive, undoActive } from "@/features/editor/undo-store";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";
import { EngineHost } from "@/workers/engine.worker";

import { cancelPlaceHeads, placeHeads, placeRunStore, resetPlaceRun, setEngineChannelFactory, setRunSinks, type EngineChannel } from "./place-run";

vi.mock("@/features/markup-set/actions", () => ({
  ensureMarkupSet: vi.fn(),
  saveSetCalibrations: vi.fn(),
  applyMarkupOps: vi.fn(),
  loadMarkupSet: vi.fn(async () => ({ ok: true, data: null })),
  hasMarkupsOnOtherVersion: vi.fn(async () => ({ ok: true, data: false })),
  listMyMarkupSets: vi.fn(async () => ({ ok: true, data: [] })),
  loadMarkupSetPages: vi.fn(),
}));

const k100 = factorForRatio(100);
const CAL: Calibration = { xFactor: k100, yFactor: k100, unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

let n = 0;
function zone(outer = ring(100, 100, 200, 150), use?: string): ZoneMarkup {
  n++;
  const z = newZone({ id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`, pageId: "doc:0", createdAt: "2026-11-12T00:00:00.000Z", outer, holes: [] }, [], CAL);
  return use ? { ...z, zone: { ...z.zone, name: `Z${n}`, use } } : { ...z, zone: { ...z.zone, name: `Z${n}` } };
}

let ids = 0;
const newId = () => `00000000-0000-7000-9000-${String(++ids).padStart(12, "0")}`;
const save = vi.fn();
const record = vi.fn();
let posted: string[] = [];

/** The real engine, in process; `hold` keeps replies until released (to cancel between zones). */
function realEngine(): EngineChannel {
  const listeners = new Set<(r: EngineReply) => void>();
  const host = new EngineHost(
    (r) => listeners.forEach((fn) => fn(r)),
    () => new Promise((r) => setTimeout(r, 0)),
  );
  return {
    post: (msg) => {
      posted.push(msg.type);
      void host.handle(msg);
    },
    listen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function setup(markups: Markup[]) {
  viewerStore.setState({ status: "ready", pageCount: 1, pageIndex: 0, pages: [{ width: 842, height: 595, rotate: 0 }], documentId: "doc", calibrations: { "doc:0": CAL } });
  setDocMarkups("doc", markups);
}

const docMarkups = () => editorStore.getState().doc.markups.doc ?? [];
const heads = () => docMarkups().filter(isHead);
const run = (map = USE_HAZARD_V1) => placeHeads({ map, newId, now: () => new Date("2026-11-12T00:00:00.000Z") });

beforeEach(() => {
  posted = [];
  setEngineChannelFactory(realEngine);
  setRunSinks({ save, record });
});

afterEach(() => {
  resetPlaceRun();
  setEngineChannelFactory(null);
  save.mockReset();
  record.mockReset();
  resetEditor();
  resetViewer();
});

describe("placeHeads (Story 9.8)", () => {
  it("places every zone's heads as device markups, as one undo step, and saves and reports the run", async () => {
    const a = zone();
    const b = zone(ring(400, 100, 150, 150));
    setup([a, b]);
    await run();
    const s = placeRunStore.getState();
    expect(s.status).toBe("done");
    expect(s.errors).toEqual([]);
    expect(s.total).toBe(2);
    const hs = heads();
    expect(hs.length).toBe(s.heads);
    expect(new Set(hs.map((h) => h.head.zoneId))).toEqual(new Set([a.id, b.id]));
    expect(hs.every((h) => h.device?.group === "Sprinkler" && h.head.kind !== "locked")).toBe(true);
    expect(Object.keys(s.reports).sort()).toEqual([a.id, b.id].sort());
    expect(Object.values(s.reports).every((r) => r?.pass)).toBe(true);

    expect(save).toHaveBeenCalledTimes(1);
    const [docId, layouts] = save.mock.calls[0];
    expect(docId).toBe("doc");
    expect(layouts.map((l: { zoneId: string }) => l.zoneId).sort()).toEqual([a.id, b.id].sort());
    expect(layouts.every((l: { ruleVersion: string; status: string; report: unknown }) => l.ruleVersion === NZS4541_V1.version && l.status === "placed" && l.report)).toBe(true);
    expect(record).toHaveBeenCalledWith("doc", { name: "sprinkler.placed", pageCount: 1, markupCount: hs.length, kind: "all_zones" });

    // Story 9.9: the coverage overlay was held for the run and is shown again.
    expect(coverageStore.getState().fade).toBeNull();

    expect(undoActive()).toBe(true);
    expect(heads()).toEqual([]);
    expect(docMarkups()).toHaveLength(2);
    expect(redoActive()).toBe(true);
    expect(heads().map((h) => h.id)).toEqual(hs.map((h) => h.id));
  });

  it("places the selected zones only", async () => {
    const a = zone();
    const b = zone(ring(400, 100, 150, 150));
    setup([a, b]);
    setSelection([b.id]);
    await run();
    expect(new Set(heads().map((h) => h.head.zoneId))).toEqual(new Set([b.id]));
    expect(record.mock.calls[0][1].kind).toBe("selected_zones");
  });

  it("a re-run replaces the engine's heads, keeps a hand-placed head as a fixed input, and undoes in one step", async () => {
    const a = zone();
    setup([a]);
    await run();
    const first = heads();
    // The user moves one head by hand (marked manual).
    const moved: HeadMarkup = { ...headMarkup({ x: 4000, y: 4600, kind: "manual" }, a, pageScaleOf(CAL), first[0].id, first[0].createdAt) };
    setDocMarkups("doc", [a, moved, ...first.slice(1)]);
    await run();
    const second = heads();
    expect(second.find((h) => h.id === moved.id)).toEqual(moved);
    expect(second.filter((h) => h.id !== moved.id).every((h) => !first.some((f) => f.id === h.id))).toBe(true);
    expect(placeRunStore.getState().reports[a.id]?.pass).toBe(true);
    expect(undoActive()).toBe(true);
    expect(heads().map((h) => h.id).sort()).toEqual([moved, ...first.slice(1)].map((h) => h.id).sort());
  });

  it("gives an infeasible zone and an unmapped use an error card; the other zones complete", async () => {
    const ok = zone();
    // 2 × 100 pt at 1:100 is 71 mm wide: narrower than twice the minimum wall distance (50 mm).
    const thin = zone(ring(400, 100, 2, 100));
    const hangar = zone(ring(100, 300, 100, 100), "Hangar");
    setup([ok, thin, hangar]);
    await run();
    const s = placeRunStore.getState();
    expect(s.status).toBe("done");
    expect(s.errors.map((e) => [e.zoneName, e.code])).toEqual([
      [hangar.zone.name, "UNMAPPED_USE"],
      [thin.zone.name, "NO_ADMISSIBLE_REGION"],
    ]);
    expect(s.errors.every((e) => e.reason && e.suggestion)).toBe(true);
    expect(new Set(heads().map((h) => h.head.zoneId))).toEqual(new Set([ok.id]));
    const layouts = save.mock.calls[0][1] as { zoneId: string; status: string }[];
    expect(layouts.find((l) => l.zoneId === thin.id)?.status).toBe("infeasible");
    expect(layouts.some((l) => l.zoneId === hangar.id)).toBe(false);
  });

  it("Cancel stops at the next zone; the heads placed so far stay as one undo step", async () => {
    const zs = [zone(), zone(ring(400, 100, 150, 150)), zone(ring(100, 300, 150, 150))];
    setup(zs);
    const over = run();
    const unsub = placeRunStore.subscribe((s) => {
      if (s.heads > 0) {
        unsub();
        cancelPlaceHeads();
      }
    });
    await over;
    const s = placeRunStore.getState();
    expect(s.status).toBe("cancelled");
    expect(posted).toEqual(["place", "cancel"]);
    expect(new Set(heads().map((h) => h.head.zoneId)).size).toBeLessThan(3);
    expect(heads().length).toBeGreaterThan(0);
    expect(undoActive()).toBe(true);
    expect(heads()).toEqual([]);
  });

  it("an engine failure ends the run with an error card per unplaced zone and saves nothing", async () => {
    setEngineChannelFactory(() => {
      let fn: ((r: EngineReply) => void) | null = null;
      return {
        post: (msg) => {
          if (msg.type === "place") setTimeout(() => fn?.({ type: "error", reqId: msg.reqId, code: "INTERNAL", message: "boom" }), 0);
        },
        listen: (f) => {
          fn = f;
          return () => (fn = null);
        },
      };
    });
    const a = zone();
    setup([a]);
    await run();
    const s = placeRunStore.getState();
    expect(s.status).toBe("failed");
    expect(s.errors.map((e) => e.code)).toEqual(["ENGINE"]);
    expect(save).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("does nothing on an uncalibrated page or without zones", async () => {
    setup([]);
    await run();
    expect(placeRunStore.getState().status).toBe("idle");
    setup([zone()]);
    viewerStore.setState({ calibrations: {} });
    await run();
    expect(posted).toEqual([]);
  });
  it("says how many heads aligned rows cost over the fewest possible", async () => {
    // A 7.2 × 22.5 m office with a partition stub on one wall: 12 heads in line, where 11 would do.
    const pt = (x: number, y: number) => ({ x: 100 + x / k100, y: 100 + y / k100 });
    const outer = [pt(0, 0), pt(7159, 0), pt(7159, 14633), pt(2739, 14633), pt(2739, 14733), pt(7159, 14733), pt(7159, 22534), pt(0, 22534)];
    setup([zone(outer)]);
    await placeHeads({ map: USE_HAZARD_V1, newId });
    const run = placeRunStore.getState();
    expect(run.status).toBe("done");
    expect(run.heads).toBe(12);
    expect(run.alignedExtra).toBe(1);
  });
});
