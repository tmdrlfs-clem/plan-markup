// Story 9.10 (FR76): the live check. Whenever the heads of a zone on the shown
// page change (a drag in progress, an add, a delete, an undo), that zone goes
// to the oracle again in engine.worker, and so do the zones next to it (a head
// near the edge counts for spacing across it). Results land in zoneCheckStore,
// which the panel (and the zone report and markers, Story 9.11) read.
//
// Per zone at most one check is in flight. When the heads change again while
// it runs (a drag sends a change per pointer move), only the newest state is
// sent once the reply is in, so a long drag never builds a queue.

import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import type { Point } from "@/core/markup/geometry";
import type { Markup, ZoneMarkup } from "@/core/schema/markup";
import { coverageRadiusMm } from "@/core/sprinkler/coverage";
import type { EngineReply, EngineRequest } from "@/core/sprinkler/engine/protocol";
import type { EngineZone } from "@/core/sprinkler/engine/site";
import { engineZoneOf, headCentre, isHead, pageScaleOf, toMm, type HeadMarkup } from "@/core/sprinkler/heads";
import type { RuleSet } from "@/core/sprinkler/rules/rules";
import { isZone, zoneHazard } from "@/core/sprinkler/zone";
import { editorStore, gestureMarkups, pageMarkups } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { setChecks, zoneCheckStore } from "./check-store";
import { engine, nextRequestId } from "./engine-channel";
import { placeRunStore } from "./place-run";
import { rulesStore } from "./rules-store";
import { useMapStore } from "./use-map-store";

export { zoneCheckStore, type ZoneCheckState } from "./check-store";

type Head = { id: string; x: number; y: number };
type Wanted = { key: string; zone: EngineZone; heads: Head[]; neighbours: { zone: EngineZone; heads: Head[] }[] };

/** A rule set given to startLiveCheck (tests); null: the one in use (rulesStore, Story 10.13). */
let fixedRules: RuleSet | null = null;
const rulesNow = (): RuleSet => fixedRules ?? rulesStore.getState().rules;
/** The engine is opened by the first check, not by start (a page with no heads never needs it). */
let unlisten: (() => void) | null = null;
let stop: (() => void) | null = null;
let scheduled = false;
/** The inputs last evaluated (identity), so unrelated store changes cost nothing. */
let seen: unknown[] = [];
/** Per zone: the key of the report shown, the newest state wanted, the request in flight. */
let shownKey = new Map<string, string>();
let wanted = new Map<string, Wanted>();
let inFlight = new Map<string, { reqId: number; key: string }>();
let byReq = new Map<number, { zoneId: string; pageId: string; key: string }>();

/** Starts the live check (idempotent). `ruleSet`: tests; the app follows the rule set in use. */
export function startLiveCheck(ruleSet?: RuleSet): void {
  fixedRules = ruleSet ?? null;
  if (stop) return;
  const unsubs = [
    editorStore.subscribe(schedule),
    viewerStore.subscribe(schedule),
    useMapStore.subscribe(schedule),
    rulesStore.subscribe(schedule),
    placeRunStore.subscribe(schedule),
  ];
  stop = () => {
    unsubs.forEach((u) => u());
    unlisten?.();
    unlisten = null;
  };
  schedule();
}

/** Stops it and forgets every report (tests, a workspace reset). */
export function stopLiveCheck(): void {
  stop?.();
  stop = null;
  scheduled = false;
  seen = [];
  shownKey = new Map();
  wanted = new Map();
  inFlight = new Map();
  byReq = new Map();
  setChecks({}, true);
}

function schedule(): void {
  if (scheduled || !stop) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (stop) evaluate();
  });
}

/** Re-reads the shown page and sends a check for each zone whose heads (or neighbours) changed. */
export function evaluate(): void {
  // A run checks its zones itself; the heads streaming in are checked once it is over.
  if (placeRunStore.getState().status === "running") return;
  const viewer = viewerStore.getState();
  const editor = editorStore.getState();
  const { documentId, pageIndex } = viewer;
  const pageId = documentId ? pageIdOf(documentId, pageIndex) : null;
  const calibration: Calibration | null = pageId ? (viewer.calibrations[pageId] ?? null) : null;
  const map = useMapStore.getState().map;
  const rules = rulesNow();
  const inputs = [pageId, calibration, map, rules, documentId ? editor.doc.markups[documentId] : null, editor.tools.moveDrag, editor.tools.preview, viewer.pages[pageIndex]?.userUnit];
  if (inputs.length === seen.length && inputs.every((v, i) => v === seen[i])) return;
  seen = inputs;

  if (zoneCheckStore.getState().pageId !== pageId) {
    shownKey = new Map();
    wanted = new Map();
    setChecks({ pageId }, true);
  }
  if (!documentId || !pageId || !calibration) return;

  const userUnit = viewer.pages[pageIndex]?.userUnit ?? 1;
  const next = checksOf(gestureMarkups(editor, documentId, pageMarkups(editor, documentId, pageId)), calibration, userUnit, map);
  // Zones that no longer hold heads lose their report.
  const reports = zoneCheckStore.getState().reports;
  const gone = Object.keys(reports).filter((id) => !next.has(id));
  if (gone.length) {
    const kept = { ...reports };
    for (const id of gone) {
      delete kept[id];
      shownKey.delete(id);
    }
    const focus = zoneCheckStore.getState().focus;
    setChecks({ reports: kept, ...(focus && gone.includes(focus.zoneId) ? { focus: null } : {}) });
  }
  wanted = next;
  for (const [zoneId, w] of next) if (shownKey.get(zoneId) !== w.key && !inFlight.has(zoneId)) send(zoneId, pageId, w);
}

function send(zoneId: string, pageId: string, w: Wanted): void {
  unlisten ??= engine().listen(onReply);
  const reqId = nextRequestId();
  inFlight.set(zoneId, { reqId, key: w.key });
  byReq.set(reqId, { zoneId, pageId, key: w.key });
  const msg: Extract<EngineRequest, { type: "check" }> = {
    type: "check",
    reqId,
    docRev: 0,
    ruleSet: rulesNow(),
    zone: w.zone as Extract<EngineRequest, { type: "check" }>["zone"],
    heads: w.heads,
    ...(w.neighbours.length ? { neighbours: w.neighbours as NonNullable<Extract<EngineRequest, { type: "check" }>["neighbours"]> } : {}),
  };
  engine().post(msg);
}

function onReply(reply: EngineReply): void {
  if (reply.reqId === null) return;
  const req = byReq.get(reply.reqId);
  if (!req) return;
  if (reply.type !== "checkResult" && reply.type !== "error") return;
  byReq.delete(reply.reqId);
  if (inFlight.get(req.zoneId)?.reqId === reply.reqId) inFlight.delete(req.zoneId);
  const state = zoneCheckStore.getState();
  if (state.pageId !== req.pageId) return;
  const w = wanted.get(req.zoneId);
  if (reply.type === "checkResult" && w) {
    shownKey.set(req.zoneId, req.key);
    // A new report renumbers the zone's breaks: a focused one there loses the focus.
    const focus = state.focus?.zoneId === req.zoneId ? { focus: null } : {};
    setChecks({ reports: { ...state.reports, [req.zoneId]: reply.report }, ...focus });
  }
  // The heads moved on while this one ran: check the newest state.
  if (w && w.key !== req.key) send(req.zoneId, req.pageId, w);
}

const zoneVersions = new WeakMap<ZoneMarkup, number>();
let zoneVersion = 0;
function versionOf(z: ZoneMarkup): number {
  let v = zoneVersions.get(z);
  if (v === undefined) {
    v = ++zoneVersion;
    zoneVersions.set(z, v);
  }
  return v;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * What to check on a page (its markups as they look now): each zone with heads and a hazard, its
 * heads and its neighbours (zones with heads whose box comes within the coverage radius of its
 * box) in mm, keyed so an unchanged zone is not sent again.
 */
export function checksOf(markups: readonly Markup[], calibration: Pick<Calibration, "xFactor" | "yFactor">, userUnit: number, map = useMapStore.getState().map): Map<string, Wanted> {
  const scale = pageScaleOf(calibration, userUnit);
  const rules = rulesNow();
  const byZone = new Map<string, HeadMarkup[]>();
  for (const m of markups) {
    if (!isHead(m)) continue;
    const list = byZone.get(m.head.zoneId);
    if (list) list.push(m);
    else byZone.set(m.head.zoneId, [m]);
  }
  const zones: { z: ZoneMarkup; ez: EngineZone; heads: Head[]; headKey: string; box: Box; reach: number }[] = [];
  for (const z of markups) {
    if (!isZone(z)) continue;
    const list = byZone.get(z.id);
    const hazard = list ? zoneHazard(z, map) : null;
    if (!list || !hazard) continue;
    const ez = engineZoneOf(z, hazard, calibration, userUnit);
    const heads = list.map((h) => ({ id: h.id, ...toMm(headCentre(h), scale) }));
    const headKey = `${versionOf(z)}|${hazard}|${heads.map((h) => `${h.id}@${Math.round(h.x)},${Math.round(h.y)}`).join(";")}`;
    zones.push({ z, ez, heads, headKey, box: boxOf(ez.barriers[0].ring), reach: coverageRadiusMm(rules.hazards[hazard]) });
  }
  const out = new Map<string, Wanted>();
  for (const a of zones) {
    const near = zones.filter((b) => b !== a && overlaps(a.box, b.box, Math.max(a.reach, b.reach)));
    out.set(a.z.id, {
      key: `${rules.id}@${rules.version}#${a.headKey}#${near.map((b) => b.headKey).join("#")}`,
      zone: a.ez,
      heads: a.heads,
      neighbours: near.map((b) => ({ zone: b.ez, heads: b.heads })),
    });
  }
  return out;
}

function boxOf(ring: readonly Point[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function overlaps(a: Box, b: Box, margin: number): boolean {
  return a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 && a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1;
}
