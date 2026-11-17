// Story 9.8 (FR73, UX-DR24, UX-DR35): Place heads. The page's zones (the
// selected ones, or all when none is selected) go to engine.worker; each zone's
// heads arrive as it is placed and appear on the canvas straight away, while the
// canvas stays usable. The run's heads are device markups (the legend and the
// Markups List count them), and the whole run is one undo step. An infeasible
// zone gets an error card (where, why, what to do); the others still complete.
// Each run is saved per zone with the ruleset version it used (A7), and a
// sprinkler.placed activity event is recorded (counts only).

import { createStore } from "zustand/vanilla";

import type { ActivityEvent } from "@/core/activity/activity-event";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import type { SimpleDocOp } from "@/core/commands/ops";
import { uuidv7 } from "@/core/ids/uuid";
import type { Point } from "@/core/markup/geometry";
import type { Markup, ZoneMarkup } from "@/core/schema/markup";
import type { EngineRequest } from "@/core/sprinkler/engine/protocol";
import type { EngineZone } from "@/core/sprinkler/engine/site";
import { engineZoneOf, guidesOfZone, headMarkup, headsOfZone, pageScaleOf, toPage, type HeadMarkup } from "@/core/sprinkler/heads";
import type { OracleReport } from "@/core/sprinkler/oracle";
import type { PlaceErrorCode, PlaceResult } from "@/core/sprinkler/placer";
import type { RuleSet, UseHazardMap } from "@/core/sprinkler/rules/rules";
import { isZone, zoneHazard } from "@/core/sprinkler/zone";
import type { ZoneLayout } from "@/core/sprinkler/zone-layout";
import { activeLayerOf, applyOp, editorStore, holdCoverage, markupsOf, recordAppliedOp, revealCoverage } from "@/features/editor";
import { viewerStore } from "@/features/viewer";

import { engine, nextRequestId } from "./engine-channel";
import { rulesStore } from "./rules-store";

export { setEngineChannelFactory, type EngineChannel } from "./engine-channel";

export const PLACE_HEADS = "Place heads";

/** What went wrong in one zone, said the way the panel's error card says it. */
export type ZoneErrorCard = {
  zoneId: string;
  zoneName: string;
  code: PlaceErrorCode | "UNMAPPED_USE" | "ENGINE";
  reason: string;
  suggestion: string;
  /** Where (page points), to zoom to; empty: the whole zone. */
  where: Point[];
};

export type PlaceRunState = {
  status: "idle" | "running" | "done" | "cancelled" | "failed";
  done: number;
  total: number;
  heads: number;
  /** Heads the run used over the fewest possible, to keep rows in line (the placer's aligned rows). */
  alignedExtra: number;
  errors: ZoneErrorCard[];
  /** The oracle's report per zone id, for the zone report (Story 9.11). */
  reports: Record<string, OracleReport | null>;
};

const IDLE: PlaceRunState = { status: "idle", done: 0, total: 0, heads: 0, alignedExtra: 0, errors: [], reports: {} };
export const placeRunStore = createStore<PlaceRunState>(() => IDLE);

export const SUGGESTIONS: Record<ZoneErrorCard["code"], string> = {
  NO_ADMISSIBLE_REGION: "Redraw the zone or merge it with the room next to it: it is narrower than twice the minimum wall distance.",
  UNCOVERABLE_PIECE: "Check the hole tags (a shaft blocks spray, a column does not need wall distance) or split the zone at the marked area.",
  INVALID_ZONE: "Redraw the zone outline so it does not cross itself and its holes lie inside it.",
  UNMAPPED_USE: "Choose a use for this zone; the use sets its hazard class.",
  ENGINE: "Try again. If it keeps failing, reload the page.",
};

/** Side effects outside the editor (saving the run, the activity event); injectable for tests. */
export type RunSinks = {
  save(documentId: string, layouts: ZoneLayout[]): void;
  record(documentId: string, event: Omit<ActivityEvent, "drawingId">): void;
};

let sinks: RunSinks = { save: () => undefined, record: () => undefined };

/** The app wires saving and activity reporting here (server actions); tests pass spies. */
export function setRunSinks(next: RunSinks): void {
  sinks = next;
}

let current: { reqId: number; stop: () => void } | null = null;

/** Stops a running Place heads at the next zone; the heads placed so far stay (one undo step). */
export function cancelPlaceHeads(): void {
  if (current) engine().post({ type: "cancel", reqId: current.reqId });
}

export function resetPlaceRun(): void {
  current?.stop();
  current = null;
  placeRunStore.setState(IDLE, true);
}

export type PlaceHeadsContext = { map: UseHazardMap; rules?: RuleSet; now?: () => Date; newId?: () => string };

/**
 * Places heads in the shown page's zones: the selected zones, or all when none is selected.
 * Resolves when the run is over. Does nothing while a run is going or the page is not calibrated.
 */
export function placeHeads(ctx: PlaceHeadsContext): Promise<void> {
  if (current) return Promise.resolve();
  const viewer = viewerStore.getState();
  const { documentId, pageIndex } = viewer;
  if (!documentId) return Promise.resolve();
  const pageId = pageIdOf(documentId, pageIndex);
  const calibration: Calibration | null = viewer.calibrations[pageId] ?? null;
  if (!calibration) return Promise.resolve();
  const userUnit = viewer.pages[pageIndex]?.userUnit ?? 1;
  const scale = pageScaleOf(calibration, userUnit);
  // Story 10.13: the rule set in use (the newest verified version), unless the caller names one.
  const rules = ctx.rules ?? rulesStore.getState().rules;
  const now = ctx.now ?? (() => new Date());
  const newId = ctx.newId ?? (() => uuidv7());

  const editor = editorStore.getState();
  const markups = markupsOf(editor, documentId);
  const { scope, selected } = scopeOf(markups, pageId, editor.selection.ids);
  if (scope.length === 0) return Promise.resolve();

  const errors: ZoneErrorCard[] = [];
  const zones: EngineZone[] = [];
  const byId = new Map<string, ZoneMarkup>();
  const keep = new Set<string>(); // heads kept fixed (moved by hand): they are inputs, not output
  for (const z of scope) {
    const hazard = zoneHazard(z, ctx.map);
    if (!hazard) {
      errors.push(card(z, "UNMAPPED_USE", `The use "${z.zone.use}" is not in the mapping, so the zone has no hazard class.`, []));
      continue;
    }
    const fixed = headsOfZone(markups, z.id).filter((h) => h.head.kind === "manual" || h.head.kind === "locked");
    for (const h of fixed) keep.add(h.id);
    zones.push(engineZoneOf(z, hazard, calibration, userUnit, fixed, guidesOfZone(markups, z)));
    byId.set(z.id, z);
  }

  // The zones' earlier engine heads go first (a re-run replaces them); fixed heads stay.
  const old = scope.flatMap((z) => headsOfZone(markups, z.id)).filter((h) => !keep.has(h.id));
  const layerId = activeLayerOf(editor, documentId)?.id;
  const removeOp = old.length ? removeOpOf(documentId, markups, old) : null;
  if (removeOp) applyOp(removeOp);

  const reqId = nextRequestId();
  const tabId = viewer.tabId ?? undefined;
  const added: Markup[] = [];
  const results = new Map<string, PlaceResult>();
  const reports: Record<string, OracleReport | null> = {};
  placeRunStore.setState({ status: "running", done: 0, total: zones.length, heads: 0, alignedExtra: 0, errors: [...errors], reports: {} }, true);
  // Story 9.9: the coverage overlay waits for the run, then fades in.
  if (zones.length > 0) holdCoverage();

  const finish = (status: PlaceRunState["status"]) => {
    stop();
    current = null;
    const parts: SimpleDocOp[] = [];
    if (removeOp) parts.push(removeOp);
    if (added.length) parts.push({ kind: "markups.add", documentId, markups: added });
    if (parts.length) recordAppliedOp(parts.length === 1 ? parts[0] : { kind: "compound", documentId, ops: parts }, PLACE_HEADS, tabId);
    placeRunStore.setState({ status, reports: { ...reports } });
    revealCoverage();
    if (status !== "failed" && results.size > 0) {
      sinks.save(documentId, layoutsOf(zones, results, reports, rules));
      sinks.record(documentId, { name: "sprinkler.placed", pageCount: 1, markupCount: added.length, kind: selected ? "selected_zones" : "all_zones" });
    }
  };

  if (zones.length === 0) {
    placeRunStore.setState({ status: "done" });
    current = null;
    if (removeOp) recordAppliedOp(removeOp, PLACE_HEADS, tabId);
    return Promise.resolve();
  }

  let resolve: () => void = () => undefined;
  const over = new Promise<void>((r) => (resolve = r));
  const unlisten = engine().listen((reply) => {
    // a request the worker could not read has no reqId: it can only be this run's
    if (reply.reqId !== reqId && !(reply.type === "error" && reply.reqId === null)) return;
    switch (reply.type) {
      case "progress":
        placeRunStore.setState({ done: reply.done, total: reply.total });
        return;
      case "zoneResult": {
        const z = byId.get(reply.zoneId);
        if (!z) return;
        results.set(z.id, reply.result);
        const heads = reply.result.heads.filter((h) => h.kind !== "locked").map((h) => withLayer(headMarkup(h, z, scale, newId(), now().toISOString(), rules), layerId));
        if (heads.length) {
          applyOp({ kind: "markups.add", documentId, markups: heads });
          added.push(...heads);
        }
        const errs = reply.result.ok ? [] : [card(z, reply.result.error.code, reply.result.error.message, reply.result.error.where.map((p) => toPage(p, scale)))];
        const extra = reply.result.notes?.aligned?.extraHeads ?? 0;
        placeRunStore.setState((s) => ({ heads: s.heads + heads.length, alignedExtra: s.alignedExtra + extra, errors: [...s.errors, ...errs] }));
        return;
      }
      case "zoneReport":
        reports[reply.zoneId] = reply.report;
        return;
      case "done":
        finish(reply.cancelled ? "cancelled" : "done");
        resolve();
        return;
      case "error":
        placeRunStore.setState((s) => ({ errors: [...s.errors, ...zones.filter((z) => !results.has(z.zoneId)).map((z) => card(byId.get(z.zoneId)!, "ENGINE", "The placement engine stopped unexpectedly.", []))] }));
        finish("failed");
        resolve();
        return;
    }
  });
  const stop = () => unlisten();
  current = { reqId, stop };
  // the engine reads the zones; the protocol types them as mutable arrays
  engine().post({ type: "place", reqId, docRev: 0, ruleSet: rules, zones: zones as Extract<EngineRequest, { type: "place" }>["zones"] });
  return over;
}

/** The zones a run places: the page's selected zones, or all of them when none is selected. */
function scopeOf(markups: readonly Markup[], pageId: string, selection: readonly string[]): { scope: ZoneMarkup[]; selected: boolean } {
  const pageZones = markups.filter((m): m is ZoneMarkup => isZone(m) && m.pageId === pageId);
  const chosen = pageZones.filter((z) => selection.includes(z.id));
  return chosen.length > 0 ? { scope: chosen, selected: true } : { scope: pageZones, selected: false };
}

/** Story 9.10: what a run would do: zones in scope, those already holding heads (re-placed), and the edited heads it keeps. */
export type PlaceScope = { zones: number; replaced: number; kept: number };

/** The shown page's next run, for the re-run confirmation (UX-DR24); null when there is nothing to place. */
export function placeScope(): PlaceScope | null {
  const viewer = viewerStore.getState();
  const { documentId, pageIndex } = viewer;
  if (!documentId) return null;
  const editor = editorStore.getState();
  const markups = markupsOf(editor, documentId);
  const { scope } = scopeOf(markups, pageIdOf(documentId, pageIndex), editor.selection.ids);
  if (scope.length === 0) return null;
  let replaced = 0;
  let kept = 0;
  for (const z of scope) {
    const heads = headsOfZone(markups, z.id);
    if (heads.length > 0) replaced++;
    kept += heads.filter((h) => h.head.kind === "manual" || h.head.kind === "locked").length;
  }
  return { zones: scope.length, replaced, kept };
}

function card(z: ZoneMarkup, code: ZoneErrorCard["code"], reason: string, where: Point[]): ZoneErrorCard {
  return { zoneId: z.id, zoneName: z.zone.name, code, reason, suggestion: SUGGESTIONS[code], where };
}

function withLayer(h: HeadMarkup, layerId: string | undefined): HeadMarkup {
  return layerId ? { ...h, layerId } : h;
}

/** The removal of `heads` with their positions in `markups` (so undo restores the order). */
function removeOpOf(documentId: string, markups: readonly Markup[], heads: readonly HeadMarkup[]): SimpleDocOp {
  const ids = new Set(heads.map((h) => h.id));
  const at: number[] = [];
  const removed: Markup[] = [];
  markups.forEach((m, i) => {
    if (ids.has(m.id)) {
      at.push(i);
      removed.push(m);
    }
  });
  return { kind: "markups.remove", documentId, markups: removed, at };
}

/** The run as saved per zone (A7): inputs in mm, the result, the report, the ruleset version. */
export function layoutsOf(zones: readonly EngineZone[], results: ReadonlyMap<string, PlaceResult>, reports: Record<string, OracleReport | null>, rules: RuleSet): ZoneLayout[] {
  return zones.flatMap((z) => {
    const r = results.get(z.zoneId);
    if (!r) return [];
    return [
      {
        zoneId: z.zoneId,
        rulesetId: rules.id,
        ruleVersion: rules.version,
        status: r.ok ? "placed" : "infeasible",
        headCount: r.heads.length,
        inputs: JSON.parse(JSON.stringify(z)) as Record<string, unknown>,
        result: JSON.parse(JSON.stringify(r)) as Record<string, unknown>,
        report: reports[z.zoneId] ? (JSON.parse(JSON.stringify(reports[z.zoneId])) as Record<string, unknown>) : null,
      },
    ];
  });
}
