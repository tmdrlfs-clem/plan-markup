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
import { Ban, Check, Circle, CircleDot, CirclePlus, Eye, EyeOff, Info, LandPlot, PaintBucket, Pentagon, Ruler, Square, SquareDashed, TriangleAlert, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cx } from "@/components/ui/cx";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { markupBounds } from "@/core/markup/geometry";
import { HOLE_TAGS, type HoleTag, type ZoneMarkup } from "@/core/schema/markup";
import type { OracleReport } from "@/core/sprinkler/oracle";
import { ADVISORY_NOTICE, reportRows, ruleBreaks, zoneStatus, type ZoneStatus } from "@/core/sprinkler/report";
import type { UseHazardMap } from "@/core/sprinkler/rules/rules";
import { MAPPING_SOURCE_LABELS, figureRows, figuresOf, useOptions, type MappingSource } from "@/core/sprinkler/use-map";
import { HOLE_TAG_LABELS, ZONE_COLOR, formatZoneArea, holeTagOf, isZone, withHoleTag, zoneAreaM2, zoneChecklist, zoneHazard } from "@/core/sprinkler/zone";
import { openCalibrate } from "@/features/calibration";
import { revealFlag, armHeadPlace, coverageStore, editorStore, executeOp, headPlaceStore, markupsOf, armZoneDraw, setCoverageOn, setCoverageShape, setSelection, zoneDrawStore } from "@/features/editor";
import { FirstUseTip } from "@/features/tips";
import { hasDocument, setTool, viewerCommands, viewerStore } from "@/features/viewer";

import { isHead } from "@/core/sprinkler/heads";

import { getUseHazardMap } from "./actions";
import type { FlagRef } from "./check-store";
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
/** Story 9.11: status changes are announced once they have held this long (ms). */
export const ANNOUNCE_DELAY_MS = 600;
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

const INFEASIBLE_CODES: ReadonlySet<ZoneErrorCard["code"]> = new Set(["NO_ADMISSIBLE_REGION", "UNCOVERABLE_PIECE", "INVALID_ZONE"]);

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
  const focus = useStore(zoneCheckStore, (s) => s.focus);
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
  // Story 9.11: a zone the engine could not place is infeasible (until a check of its heads says otherwise).
  const infeasible = new Set(run.errors.filter((e) => INFEASIBLE_CODES.has(e.code)).map((e) => e.zoneId));
  const statusOf = (id: string) => zoneStatus(checks[id] ?? null, infeasible.has(id) && !checks[id]);

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
              status={statusOf(z.id)}
              detail={(checks[z.id]?.flags ?? []).slice(0, 4).map((f) => f.message).join(" · ")}
              documentId={documentId}
              pageIndex={pageIndex}
            />
          ))}
        </ul>
      )}
      <StatusAnnouncer statuses={zones.map((z) => ({ id: z.id, name: z.zone.name, status: statusOf(z.id) }))} />
      {current && checks[current.id] ? <ZoneReport zone={current} report={checks[current.id]} hazard={zoneHazard(current, map) ?? "?"} focus={focus} /> : null}
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
      {/* Story 9.12 (FR78): always shown at the foot of the panel. */}
      <p className="mt-auto flex items-start gap-1.5 border-t border-border p-3 text-ws-xs text-muted" data-testid="advisory-notice">
        <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
        {ADVISORY_NOTICE}
      </p>
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

type ZoneRowProps = {
  zone: ZoneMarkup;
  selected: boolean;
  areaText: string;
  map: UseHazardMap;
  status: ZoneStatus | null;
  /** The first rule breaks, for the badge's tooltip. */
  detail: string;
  documentId: string;
  pageIndex: number;
};

/**
 * A zone in the list. Memoised (Story 9.13): during a Place heads run the panel's state
 * changes with every zone placed and every report, and re-rendering every row's use list each
 * time cost more than the engine on a large floor (45 zones: 1.7 s to the status line, 0.7 s
 * with this). A row renders again only when something it shows changed.
 */
const ZoneRow = memo(function ZoneRow({
  zone,
  selected,
  areaText,
  map,
  status,
  detail,
  documentId,
  pageIndex,
}: ZoneRowProps) {
  const onSelect = () => revealZone(zone, pageIndex);
  const onUse = (use: string) => setUse(documentId, zone, use);
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
        {status ? <StatusBadge status={status} detail={detail} /> : null}
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
}, sameRow);

/** The same row to show: the status is compared by what it says (it is built anew on each render). */
function sameRow(a: ZoneRowProps, b: ZoneRowProps): boolean {
  return (
    a.zone === b.zone &&
    a.selected === b.selected &&
    a.areaText === b.areaText &&
    a.map === b.map &&
    a.detail === b.detail &&
    a.documentId === b.documentId &&
    a.pageIndex === b.pageIndex &&
    a.status?.kind === b.status?.kind &&
    a.status?.count === b.status?.count &&
    a.status?.text === b.status?.text
  );
}

/**
 * Story 9.10 / 9.11 (UX-DR24): a zone's status in the list, with an icon and text: ✓, ⚠ n
 * (warnings), ✕ n (rule breaks) or Infeasible; the first breaks are its tooltip.
 */
function StatusBadge({ status, detail }: { status: ZoneStatus; detail: string }) {
  const Icon = status.kind === "error" ? X : status.kind === "warning" ? TriangleAlert : status.kind === "infeasible" ? Ban : Check;
  const tone = status.kind === "error" || status.kind === "infeasible" ? "text-danger" : status.kind === "warning" ? "text-warning" : "text-success";
  return (
    <span
      className={cx("flex shrink-0 items-center gap-0.5 text-ws-sm font-semibold tabular-nums", tone)}
      title={detail ? `${status.text}: ${detail}` : status.text}
      data-testid="zone-check"
      data-tone={status.kind}
    >
      <Icon size={12} aria-hidden="true" />
      {status.kind === "infeasible" ? status.text : status.count > 0 ? status.count : null}
      {status.kind === "infeasible" ? null : <span className="sr-only">{status.text}</span>}
    </span>
  );
}

/** Story 9.11 (FR77): the selected zone's report: its figures against the limits and its rule breaks; nothing here blocks anything. */
function ZoneReport({ zone, report, hazard, focus }: { zone: ZoneMarkup; report: OracleReport; hazard: string; focus: FlagRef | null }) {
  const rows = reportRows(report, hazard);
  const breaks = ruleBreaks(report);
  const focusedRef = useRef<HTMLButtonElement | null>(null);
  const focusedIndex = focus?.zoneId === zone.id ? focus.index : null;
  useEffect(() => {
    // A marker clicked on the canvas brings its row into view.
    focusedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [focusedIndex]);
  return (
    // Story 9.13: the report scrolls when the panel is short, so it takes focus (a keyboard user scrolls it with the arrows).
    <section
      className="flex max-h-[45%] min-h-0 flex-col gap-1 overflow-y-auto border-t border-border p-3 text-ws-sm"
      aria-label={`Report for ${zone.zone.name}`}
      tabIndex={0}
      data-testid="zone-report"
    >
      <p className="font-semibold">Report · {zone.zone.name}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        {rows.map((r) => (
          <div key={r.key} className="contents" data-testid={`report-${r.key}`}>
            <dt className="text-muted">{r.label}</dt>
            <dd className={cx("text-right tabular-nums", r.ok ? "" : "font-semibold text-danger")}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {breaks.length === 0 ? (
        <p className="flex items-center gap-1 text-success" data-testid="report-pass">
          <Check size={14} aria-hidden="true" />
          No rule breaks.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5" aria-label="Rule breaks" data-testid="rule-breaks">
          {breaks.map((b) => {
            const current = focusedIndex === b.index;
            const Icon = b.flag.severity === "error" ? X : TriangleAlert;
            return (
              <li key={b.index}>
                <button
                  type="button"
                  ref={current ? focusedRef : undefined}
                  aria-current={current ? "true" : undefined}
                  onClick={() => revealFlag({ zoneId: zone.id, index: b.index })}
                  className={cx(
                    "flex w-full flex-col items-start rounded-sm px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    current ? "bg-accent-soft" : "hover:bg-surface-3",
                  )}
                  data-testid="rule-break"
                >
                  <span className={cx("flex items-center gap-1 font-semibold", b.flag.severity === "error" ? "text-danger" : "text-warning")}>
                    <Icon size={12} aria-hidden="true" />
                    <span className="sr-only">{b.flag.severity === "error" ? "Rule break:" : "Warning:"}</span>
                    {b.label}
                  </span>
                  <span className="text-muted">{b.flag.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const statusKey = (s: ZoneStatus | null) => (s ? `${s.kind}${s.count}` : "");

/** Story 9.11: zone status changes, said once they settle (a drag would otherwise say every step). */
function StatusAnnouncer({ statuses }: { statuses: readonly { id: string; name: string; status: ZoneStatus | null }[] }) {
  const [text, setText] = useState("");
  const last = useRef<Map<string, string> | null>(null);
  const latest = useRef(statuses);
  useEffect(() => {
    latest.current = statuses;
  });
  const key = statuses.map((z) => `${z.id}=${statusKey(z.status)}`).join("|");
  useEffect(() => {
    // What the panel showed when it opened is not news.
    last.current = new Map(latest.current.map((z) => [z.id, statusKey(z.status)]));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const list = latest.current;
      const now = new Map(list.map((z) => [z.id, statusKey(z.status)]));
      const before = last.current ?? new Map<string, string>();
      last.current = now;
      const changed = list.filter((z) => z.status && before.get(z.id) !== now.get(z.id));
      if (changed.length) setText(changed.map((z) => `${z.name}: ${z.status!.text}.`).join(" "));
    }, ANNOUNCE_DELAY_MS);
    return () => clearTimeout(t);
  }, [key]);
  return (
    <p className="sr-only" aria-live="polite" data-testid="zone-status-live">
      {text}
    </p>
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
