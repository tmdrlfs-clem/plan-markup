"use client";
// Story 9.2 (FR70, UX-DR24): the 4541 panel. An uncalibrated page asks for a
// calibration first; a calibrated one shows the checklist, Fill zone and
// Polygon zone, and the page's zones (name, use, hazard chip, area). A row
// and the canvas share the selection; a selected zone's holes are tagged here.
// Story 9.3 (FR71): each row's use dropdown sets the hazard class through the
// use -> hazard mapping (the company's, else the platform's); the selected
// zone shows its rule figures and ruleset version to check against the standard.
// Story 9.8 (FR73): Place heads fills the selected zones (or all of the page's)
// zone by zone, with progress, Cancel and an error card per infeasible zone.
// Story 9.9 (FR75): the coverage overlay toggle and its shape (circle or square).
// Story 9.10 (FR76): Add head; a re-run on zones that hold heads confirms its
// scope first; each zone row shows the live check of its heads.
import { Check, Circle, CircleDot, CirclePlus, Eye, EyeOff, LandPlot, PaintBucket, Pentagon, Ruler, Square, SquareDashed, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cx } from "@/components/ui/cx";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { markupBounds } from "@/core/markup/geometry";
import { HOLE_TAGS, type HoleTag, type ZoneMarkup } from "@/core/schema/markup";
import type { OracleReport } from "@/core/sprinkler/oracle";
import type { UseHazardMap } from "@/core/sprinkler/rules/rules";
import { MAPPING_SOURCE_LABELS, figureRows, figuresOf, useOptions, type MappingSource } from "@/core/sprinkler/use-map";
import { HOLE_TAG_LABELS, ZONE_COLOR, formatZoneArea, holeTagOf, isZone, withHoleTag, zoneAreaM2, zoneChecklist, zoneHazard } from "@/core/sprinkler/zone";
import { openCalibrate } from "@/features/calibration";
import { armHeadPlace, coverageStore, editorStore, executeOp, headPlaceStore, markupsOf, armZoneDraw, setCoverageOn, setCoverageShape, setSelection, zoneDrawStore } from "@/features/editor";
import { FirstUseTip } from "@/features/tips";
import { hasDocument, setTool, viewerCommands, viewerStore } from "@/features/viewer";

import { isHead } from "@/core/sprinkler/heads";

import { getUseHazardMap } from "./actions";
import { startLiveCheck, zoneCheckStore } from "./live-check";
import { cancelPlaceHeads, placeHeads, placeRunStore, placeScope, setRunSinks, type PlaceScope, type ZoneErrorCard } from "./place-run";
import { serverRunSinks } from "./run-sinks";
import { loadUseMap, useMapStore } from "./use-map-store";

export const CALIBRATE_FIRST = "Calibrate this page first";
export const CALIBRATE_FIRST_HINT = "Zones and head spacing are in real units, so the 4541 tools need this page's scale.";
export const ZONES_TIP = "Fill a room to make a zone, or draw its outline. Each zone takes a use; the use sets its hazard class.";
export const NO_ZONES = "No zones on this page yet.";
export const CHANGE_HOLE_TAG = "Change hole tag";
export const CHANGE_USE = "Change use";
export const UNMAPPED_USE = "This use is not in the mapping. Choose a use to set the hazard class.";
export const DRAFT_MAPPING = "draft, not yet verified";
export const COVERAGE_HINT = "Show each head's coverage; areas no head covers are hatched";
export const PLACE_HEADS_HINT = "Place heads in the selected zones, or in every zone on this page when none is selected";
export const ADD_HEAD_HINT = "Add head: click inside a zone to add a head there (Esc to stop). Drag a head to move it; Delete removes it.";

/** Story 9.10 (UX-DR24): the re-run confirmation's title, e.g. "Re-place 2 zones, keep 3 edited heads". */
export function replaceTitle(s: PlaceScope): string {
  return `Re-place ${plural(s.replaced, "zone")}${s.kept > 0 ? `, keep ${plural(s.kept, "edited head")}` : ""}`;
}

export function replaceDescription(s: PlaceScope): string {
  const fresh = s.zones - s.replaced;
  return [
    `Heads the engine placed in ${s.replaced === 1 ? "this zone are" : "these zones are"} removed and placed again.`,
    s.kept > 0 ? `Heads you moved or added stay where they are, and the engine places around them.` : "",
    fresh > 0 ? `${plural(fresh, "zone")} without heads ${fresh === 1 ? "is" : "are"} placed too.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

let sinksWired = false;
/** A run from the panel is saved and reported through the server actions. */
function wireSinks(): void {
  if (sinksWired) return;
  sinksWired = true;
  setRunSinks(serverRunSinks);
}

function userUnitOf(pages: readonly { userUnit?: number }[], pageIndex: number): number {
  const u = pages[pageIndex]?.userUnit;
  return u && u > 0 ? u : 1;
}

/** Shows the zone and selects it (a tool in use gives way to Select). */
function revealZone(z: ZoneMarkup, pageIndex: number): void {
  if (viewerStore.getState().tool !== "select") setTool("select");
  viewerCommands.revealMarkup(pageIndex, markupBounds(z));
  setSelection([z.id]);
}

function setUse(documentId: string, z: ZoneMarkup, use: string): void {
  if (use === z.zone.use) return;
  executeOp({ kind: "markups.update", documentId, before: [z], after: [{ ...z, zone: { ...z.zone, use } }] }, CHANGE_USE);
}

function setHoleTag(documentId: string, z: ZoneMarkup, index: number, tag: HoleTag, calibration: Calibration | null, userUnit: number): void {
  const after = withHoleTag(z, index, tag, calibration, userUnit);
  if (after === z) return;
  executeOp({ kind: "markups.update", documentId, before: [z], after: [after] }, CHANGE_HOLE_TAG);
}

export function SprinklerPanel({ emptyText }: { emptyText: string }) {
  const shown = useStore(viewerStore, hasDocument);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const pages = useStore(viewerStore, (s) => s.pages);
  const calibrations = useStore(viewerStore, (s) => s.calibrations);
  const markups = useStore(editorStore, (s) => markupsOf(s, documentId));
  const selected = useStore(editorStore, (s) => s.selection.ids);
  const armed = useStore(zoneDrawStore, (s) => s.tool);
  const tool = useStore(viewerStore, (s) => s.tool);
  const map = useStore(useMapStore, (s) => s.map);
  const mapSource = useStore(useMapStore, (s) => s.source);
  const run = useStore(placeRunStore, (s) => s);
  const checks = useStore(zoneCheckStore, (s) => s.reports);
  const coverageOn = useStore(coverageStore, (s) => s.on);
  const coverageShape = useStore(coverageStore, (s) => s.shape);
  const addingHeads = useStore(headPlaceStore, (s) => s.heads) && tool === "stamp";
  const [confirm, setConfirm] = useState<PlaceScope | null>(null);

  // Story 9.3: the mapping is read once per session (the built-in one until then).
  useEffect(() => {
    void loadUseMap(getUseHazardMap);
    // Story 9.10: zones are checked again whenever their heads change.
    startLiveCheck();
  }, []);

  const pageId = documentId ? pageIdOf(documentId, pageIndex) : null;
  const calibration = pageId ? (calibrations[pageId] ?? null) : null;
  const userUnit = userUnitOf(pages, pageIndex);
  const zones = useMemo(() => markups.filter((m): m is ZoneMarkup => isZone(m) && m.pageId === pageId), [markups, pageId]);

  if (!shown || !documentId) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md">
        <p>{emptyText}</p>
      </div>
    );
  }
  if (!calibration) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-ws-md" data-testid="sprinkler-calibrate-first">
        <p className="font-semibold">{CALIBRATE_FIRST}</p>
        <p className="text-ws-sm text-muted">{CALIBRATE_FIRST_HINT}</p>
        <Button variant="primary" size="sm" onClick={openCalibrate}>
          <Ruler size={14} aria-hidden="true" />
          Calibrate
        </Button>
      </div>
    );
  }

  const zoneIds = new Set(zones.map((z) => z.id));
  const checklist = zoneChecklist(zones, map, markups.some((m) => isHead(m) && zoneIds.has(m.head.zoneId)));
  const selectedZones = zones.filter((z) => selected.includes(z.id)).length;
  const running = run.status === "running";
  const fillOn = armed === "fill" && tool === "fill";
  const polygonOn = armed === "area" && tool === "area";
  const current = zones.find((z) => selected.includes(z.id)) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sprinkler-panel">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <FirstUseTip id="sprinkler-zones">{ZONES_TIP}</FirstUseTip>
        <ul className="flex gap-3 text-ws-sm" aria-label="4541 checklist" data-testid="sprinkler-checklist">
          <ChecklistItem label="Zones" done={checklist.zones} />
          <ChecklistItem label="Uses" done={checklist.uses} />
          <ChecklistItem label="Place heads" done={checklist.heads} />
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={fillOn ? "primary" : "secondary"}
            aria-pressed={fillOn}
            onClick={() => armZoneDraw("fill")}
            title="Fill zone (J): click inside a room, Enter adds it"
          >
            <PaintBucket size={14} aria-hidden="true" />
            Fill zone
          </Button>
          <Button
            size="sm"
            variant={polygonOn ? "primary" : "secondary"}
            aria-pressed={polygonOn}
            onClick={() => armZoneDraw("area")}
            title="Polygon zone: click its corners, close on the first point"
          >
            <Pentagon size={14} aria-hidden="true" />
            Polygon zone
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={zones.length === 0 || running}
            onClick={() => {
              // Story 9.10: a re-run on zones that hold heads says what it replaces and keeps first.
              const scope = placeScope();
              if (scope && scope.replaced > 0) return setConfirm(scope);
              wireSinks();
              void placeHeads({ map });
            }}
            title={PLACE_HEADS_HINT}
            data-testid="place-heads"
          >
            <CircleDot size={14} aria-hidden="true" />
            {selectedZones > 0 ? `Place heads (${selectedZones} selected)` : "Place heads"}
          </Button>
          <Button
            size="sm"
            variant={addingHeads ? "primary" : "secondary"}
            aria-pressed={addingHeads}
            disabled={zones.length === 0}
            onClick={armHeadPlace}
            title={ADD_HEAD_HINT}
            data-testid="add-head"
          >
            <CirclePlus size={14} aria-hidden="true" />
            Add head
          </Button>
          {running ? (
            <Button size="sm" variant="secondary" onClick={cancelPlaceHeads}>
              <X size={14} aria-hidden="true" />
              Cancel
            </Button>
          ) : null}
        </div>
        <RunStatus />
        {confirm ? (
          <AlertDialog
            open
            onOpenChange={(open) => {
              if (!open) setConfirm(null);
            }}
            title={replaceTitle(confirm)}
            description={replaceDescription(confirm)}
            actionLabel={replaceTitle(confirm).split(",")[0]}
            onAction={() => {
              setConfirm(null);
              wireSinks();
              void placeHeads({ map });
            }}
          />
        ) : null}
        {checklist.heads ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Coverage overlay" data-testid="coverage-controls">
            <Button size="sm" variant={coverageOn ? "primary" : "secondary"} aria-pressed={coverageOn} onClick={() => setCoverageOn(!coverageOn)} title={COVERAGE_HINT}>
              {coverageOn ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              Coverage
            </Button>
            <Button
              size="sm"
              variant={coverageShape === "circle" ? "secondary" : "ghost"}
              aria-pressed={coverageShape === "circle"}
              disabled={!coverageOn}
              onClick={() => setCoverageShape("circle")}
            >
              <Circle size={14} aria-hidden="true" />
              Circle
            </Button>
            <Button
              size="sm"
              variant={coverageShape === "square" ? "secondary" : "ghost"}
              aria-pressed={coverageShape === "square"}
              disabled={!coverageOn}
              onClick={() => setCoverageShape("square")}
            >
              <SquareDashed size={14} aria-hidden="true" />
              Square
            </Button>
          </div>
        ) : null}
      </div>
      {run.errors.length > 0 ? (
        <ul className="flex flex-col gap-2 border-b border-border p-3" aria-label="Zones not placed" data-testid="place-errors">
          {run.errors.map((e) => (
            <ErrorCard key={`${e.zoneId}:${e.code}`} card={e} onShow={() => showError(e, zones, pageIndex)} />
          ))}
        </ul>
      ) : null}
      {zones.length === 0 ? (
        <p className="p-3 text-ws-sm text-muted" data-testid="zones-empty">
          {NO_ZONES}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Zones" data-testid="zone-list">
          {zones.map((z) => (
            <ZoneRow
              key={z.id}
              zone={z}
              selected={selected.includes(z.id)}
              areaText={formatZoneArea(zoneAreaM2(z, calibration, userUnit))}
              map={map}
              check={checks[z.id] ?? null}
              onSelect={() => revealZone(z, pageIndex)}
              onUse={(use) => setUse(documentId, z, use)}
            />
          ))}
        </ul>
      )}
      {current ? <ZoneFiguresPanel zone={current} map={map} source={mapSource} /> : null}
      {current && (current.holes?.length ?? 0) > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border p-3" data-testid="zone-holes">
          <p className="text-ws-sm font-semibold">Holes in {current.zone.name}</p>
          {(current.holes ?? []).map((_, i) => (
            <Select
              key={i}
              label={`Hole ${i + 1}`}
              value={holeTagOf(current, i, calibration, userUnit)}
              onValueChange={(v) => setHoleTag(documentId, current, i, v as HoleTag, calibration, userUnit)}
              options={HOLE_TAGS.map((t) => ({
                value: t,
                label: HOLE_TAG_LABELS[t],
              }))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Shows where a zone failed (the offending area when the engine gave one, else the zone) and selects the zone. */
function showError(e: ZoneErrorCard, zones: readonly ZoneMarkup[], pageIndex: number): void {
  const z = zones.find((x) => x.id === e.zoneId);
  if (!z) return;
  if (e.where.length === 0) {
    revealZone(z, pageIndex);
    return;
  }
  const xs = e.where.map((p) => p.x);
  const ys = e.where.map((p) => p.y);
  if (viewerStore.getState().tool !== "select") setTool("select");
  viewerCommands.revealMarkup(pageIndex, { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
  setSelection([z.id]);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Progress while placing, then the outcome, in a polite live region. */
function RunStatus() {
  const run = useStore(placeRunStore, (s) => s);
  let text = "";
  if (run.status === "running") text = run.total > 0 ? `Placing zone ${Math.min(run.done + 1, run.total)} of ${run.total}…` : "Placing…";
  else if (run.status === "done") text = `${plural(run.heads, "head")} placed in ${plural(run.total, "zone")}.`;
  else if (run.status === "cancelled") text = `Stopped: ${plural(run.heads, "head")} placed in ${run.done} of ${plural(run.total, "zone")}.`;
  else if (run.status === "failed") text = "Placement stopped: the engine failed.";
  return (
    <div className="flex flex-col gap-1">
      {run.status === "running" ? (
        <div
          role="progressbar"
          aria-label="Placing heads"
          aria-valuemin={0}
          aria-valuemax={run.total}
          aria-valuenow={run.done}
          className="h-1 w-full overflow-hidden rounded-sm bg-surface-3"
        >
          <div className="h-full bg-accent" style={{ width: `${run.total ? (100 * run.done) / run.total : 0}%` }} />
        </div>
      ) : null}
      <p className="text-ws-sm text-muted" aria-live="polite" data-testid="place-status">
        {text}
      </p>
    </div>
  );
}

function ErrorCard({ card, onShow }: { card: ZoneErrorCard; onShow: () => void }) {
  return (
    <li className="flex flex-col gap-1 rounded-sm border border-danger p-2 text-ws-sm" data-testid="place-error">
      <p className="flex items-center gap-1 font-semibold text-danger">
        <TriangleAlert size={14} aria-hidden="true" />
        {card.zoneName}: not placed
      </p>
      <p>{card.reason}</p>
      <p className="text-muted">{card.suggestion}</p>
      <div>
        <Button size="sm" variant="secondary" onClick={onShow}>
          Show in drawing
        </Button>
      </div>
    </li>
  );
}

function ChecklistItem({ label, done }: { label: string; done: boolean }) {
  return (
    <li className={cx("flex items-center gap-1", done ? "text-text" : "text-muted")} data-done={done}>
      {done ? <Check size={14} aria-hidden="true" className="text-success" /> : <Square size={14} aria-hidden="true" />}
      <span>{label}</span>
      <span className="sr-only">{done ? "done" : "to do"}</span>
    </li>
  );
}

function ZoneRow({
  zone,
  selected,
  areaText,
  map,
  check,
  onSelect,
  onUse,
}: {
  zone: ZoneMarkup;
  selected: boolean;
  areaText: string;
  map: UseHazardMap;
  check: OracleReport | null;
  onSelect: () => void;
  onUse: (use: string) => void;
}) {
  const hazard = zoneHazard(zone, map);
  return (
    <li data-testid="zone-row" data-selected={selected} className={cx("flex flex-col gap-1 px-3 py-1.5", selected ? "bg-accent-soft text-text" : "hover:bg-surface-3")}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex w-full items-center gap-2 rounded-sm text-left text-ws-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <LandPlot size={14} aria-hidden="true" className="shrink-0" style={{ color: ZONE_COLOR }} />
        <span className="min-w-0 flex-1 truncate">{zone.zone.name}</span>
        {check ? <CheckBadge report={check} /> : null}
        <span className="shrink-0 text-right tabular-nums text-ws-sm">{areaText}</span>
      </button>
      <div className="flex items-center gap-2 pl-6">
        <div className="min-w-0 flex-1">
          <Select
            label={`Use of ${zone.zone.name}`}
            labelHidden
            value={zone.zone.use}
            onValueChange={onUse}
            options={useOptions(map, zone.zone.use).map((o) => ({ value: o.use, label: o.hazard ? `${o.use} (${o.hazard})` : `${o.use} (not mapped)` }))}
          />
        </div>
        <span
          className={cx("shrink-0 rounded-sm border px-1 text-ws-sm font-semibold", hazard ? "border-border" : "border-warning text-warning")}
          data-testid="hazard-chip"
          title={hazard ? `Hazard class ${hazard}` : "Use not in the mapping"}
        >
          {hazard ?? "?"}
        </span>
      </div>
    </li>
  );
}

/** Story 9.10: the live check of a zone's heads: ✓, or its errors (✕) and warnings (⚠), with the first few messages as the tooltip. */
export function checkSummary(r: OracleReport): { tone: "pass" | "error" | "warning"; text: string; label: string; detail: string } {
  const detail = r.flags.slice(0, 4).map((f) => f.message).join(" · ");
  if (r.errors > 0) return { tone: "error", text: String(r.errors), label: `${plural(r.errors, "rule break")}${r.warnings ? `, ${plural(r.warnings, "warning")}` : ""}`, detail };
  if (r.warnings > 0) return { tone: "warning", text: String(r.warnings), label: plural(r.warnings, "warning"), detail };
  return { tone: "pass", text: "", label: "Checks pass", detail: "" };
}

function CheckBadge({ report }: { report: OracleReport }) {
  const c = checkSummary(report);
  const Icon = c.tone === "error" ? X : c.tone === "warning" ? TriangleAlert : Check;
  return (
    <span
      className={cx("flex shrink-0 items-center gap-0.5 text-ws-sm font-semibold tabular-nums", c.tone === "error" ? "text-danger" : c.tone === "warning" ? "text-warning" : "text-success")}
      title={c.detail ? `${c.label}: ${c.detail}` : c.label}
      data-testid="zone-check"
      data-tone={c.tone}
    >
      <Icon size={12} aria-hidden="true" />
      {c.text}
      <span className="sr-only">{c.label}</span>
    </span>
  );
}

function ZoneFiguresPanel({ zone, map, source }: { zone: ZoneMarkup; map: UseHazardMap; source: MappingSource }) {
  const figures = figuresOf(zoneHazard(zone, map));
  return (
    <section className="flex flex-col gap-1 border-t border-border p-3 text-ws-sm" aria-label={`Rule figures for ${zone.zone.name}`} data-testid="zone-figures">
      {figures ? (
        <>
          <p className="font-semibold">
            {figures.hazard} · {figures.ruleset}
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
            {figureRows(figures.rule).map((r) => (
              <div key={r.key} className="contents" data-testid={`figure-${r.key}`}>
                <dt className="text-muted">
                  {r.label} <span className="font-mono">({r.key})</span>
                </dt>
                <dd className="text-right tabular-nums">{r.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-warning">{UNMAPPED_USE}</p>
      )}
      <p className="text-muted" data-testid="mapping-source">
        {MAPPING_SOURCE_LABELS[source]} v{map.version}
        {map.verified ? "" : ` (${DRAFT_MAPPING})`}
      </p>
    </section>
  );
}
