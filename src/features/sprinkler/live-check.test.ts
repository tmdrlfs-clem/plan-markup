// Story 9.10: the live check against the real oracle (EngineHost in process, no Worker).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { translateMarkup } from "@/core/markup/geometry";
import type { EngineReply, EngineRequest } from "@/core/sprinkler/engine/protocol";
import { headCentre, isHead, type HeadMarkup } from "@/core/sprinkler/heads";
import { USE_HAZARD_V1 } from "@/core/sprinkler/rules/rules";
import { newZone } from "@/core/sprinkler/zone";
import type { Markup, ZoneMarkup } from "@/core/schema/markup";
import { editorStore, resetEditor, setDocMarkups, setMoveDrag } from "@/features/editor/editor-store";
import { executeOp } from "@/features/editor/undo-store";
import { viewerStore } from "@/features/viewer/viewer-store";
import { resetViewer } from "@/features/viewer/viewer-tabs";
import { EngineHost } from "@/workers/engine.worker";

import { checksOf, startLiveCheck, stopLiveCheck, zoneCheckStore } from "./live-check";
import { placeHeads, resetPlaceRun, setEngineChannelFactory, setRunSinks, type EngineChannel } from "./place-run";

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
function zone(outer = ring(100, 100, 200, 150)): ZoneMarkup {
  n++;
  const z = newZone({ id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`, pageId: "doc:0", createdAt: "2026-11-12T00:00:00.000Z", outer, holes: [] }, [], CAL);
  return { ...z, zone: { ...z.zone, name: `Z${n}` } };
}

let ids = 0;
const newId = () => `00000000-0000-7000-9000-${String(++ids).padStart(12, "0")}`;
let checks: number;
/** Replies held back while true (a check in flight), released by `release`. */
let holding = false;
let held: (() => void)[] = [];

function realEngine(): EngineChannel {
  const listeners = new Set<(r: EngineReply) => void>();
  const host = new EngineHost(
    (r) => listeners.forEach((fn) => fn(r)),
    () => new Promise((r) => setTimeout(r, 0)),
  );
  return {
    post: (msg: EngineRequest) => {
      if (msg.type === "check") checks++;
      const go = () => void host.handle(msg);
      if (holding && msg.type === "check") held.push(go);
      else go();
    },
    listen: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function release(): void {
  holding = false;
  const go = held;
  held = [];
  go.forEach((f) => f());
}

function setup(markups: Markup[]) {
  viewerStore.setState({ status: "ready", pageCount: 1, pageIndex: 0, pages: [{ width: 842, height: 595, rotate: 0 }], documentId: "doc", calibrations: { "doc:0": CAL } });
  setDocMarkups("doc", markups);
}

const heads = () => (editorStore.getState().doc.markups.doc ?? []).filter(isHead);
const report = (zoneId: string) => zoneCheckStore.getState().reports[zoneId];
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  checks = 0;
  holding = false;
  held = [];
  setEngineChannelFactory(realEngine);
  setRunSinks({ save: () => undefined, record: () => undefined });
});

afterEach(() => {
  stopLiveCheck();
  resetPlaceRun();
  setEngineChannelFactory(null);
  resetEditor();
  resetViewer();
});

describe("live check (Story 9.10)", () => {
  it("checks each zone's heads once a run is over, and again while a head is dragged", async () => {
    const a = zone();
    setup([a]);
    startLiveCheck();
    await placeHeads({ map: USE_HAZARD_V1, newId });
    await vi.waitFor(() => expect(report(a.id)?.pass).toBe(true));
    expect(report(a.id)!.headCount).toBe(heads().length);
    const before = checks;

    // Drag one head onto the wall: the oracle flags it before the drop.
    const h = heads()[0];
    const c = headCentre(h);
    setMoveDrag({ ids: [h.id], documentId: "doc", delta: { x: 100 - c.x, y: 0 } });
    await vi.waitFor(() => expect(report(a.id)?.errors).toBeGreaterThan(0));
    expect(checks).toBe(before + 1);

    // Let go back where it was: the check passes again (no move, nothing changes).
    setMoveDrag(null);
    await vi.waitFor(() => expect(report(a.id)?.pass).toBe(true));
  });

  it("sends only the newest state once the check in flight returns", async () => {
    const a = zone();
    setup([a]);
    startLiveCheck();
    await placeHeads({ map: USE_HAZARD_V1, newId });
    await vi.waitFor(() => expect(report(a.id)).toBeDefined());
    const h = heads()[0];
    const start = checks;
    holding = true;
    for (let i = 1; i <= 5; i++) {
      setMoveDrag({ ids: [h.id], documentId: "doc", delta: { x: i * 3, y: 0 } });
      await settle();
    }
    expect(checks).toBe(start + 1); // one in flight, the rest waiting as one
    release();
    await vi.waitFor(() => expect(checks).toBe(start + 2));
    await settle();
    await settle();
    expect(checks).toBe(start + 2);
  });

  it("re-checks after a delete and forgets a zone whose heads are gone", async () => {
    const a = zone();
    setup([a]);
    startLiveCheck();
    await placeHeads({ map: USE_HAZARD_V1, newId });
    await vi.waitFor(() => expect(report(a.id)).toBeDefined());
    const all = heads();
    const count = report(a.id)!.headCount;
    executeOp({ kind: "markups.remove", documentId: "doc", markups: [all[0]] }, "Delete markup");
    await vi.waitFor(() => expect(report(a.id)?.headCount).toBe(count - 1));
    executeOp({ kind: "markups.remove", documentId: "doc", markups: all.slice(1) }, "Delete markups");
    await vi.waitFor(() => expect(report(a.id)).toBeUndefined());
  });

  it("checks a zone with its neighbours within reach only", () => {
    const a = zone();
    const b = zone(ring(300, 100, 150, 150)); // shares a wall with a
    const far = zone(ring(100, 2000, 150, 150));
    const head = (z: ZoneMarkup, id: string, x: number, y: number): HeadMarkup => ({
      id,
      pageId: "doc:0",
      createdAt: "2026-11-12T00:00:00.000Z",
      type: "ellipse",
      style: { color: "#c62828", width: 1, fontSize: 10 },
      head: { zoneId: z.id, kind: "row" },
      points: [
        { x: x - 1, y: y - 1 },
        { x: x + 1, y: y - 1 },
        { x: x + 1, y: y + 1 },
        { x: x - 1, y: y + 1 },
      ],
    });
    const hs = [head(a, newId(), 200, 175), head(b, newId(), 375, 175), head(far, newId(), 175, 2075)];
    const out = checksOf([a, b, far, ...hs], CAL, 1, USE_HAZARD_V1);
    expect(out.get(a.id)!.neighbours.map((x) => x.zone.zoneId)).toEqual([b.id]);
    expect(out.get(far.id)!.neighbours).toEqual([]);
    expect(out.get(a.id)!.heads).toHaveLength(1);
    // Moving b's head changes a's key (it is a's neighbour) but not far's.
    const moved = checksOf([a, b, far, hs[0], translateMarkup(hs[1], { x: 5, y: 0 }), hs[2]], CAL, 1, USE_HAZARD_V1);
    expect(moved.get(a.id)!.key).not.toBe(out.get(a.id)!.key);
    expect(moved.get(far.id)!.key).toBe(out.get(far.id)!.key);
  });
});
