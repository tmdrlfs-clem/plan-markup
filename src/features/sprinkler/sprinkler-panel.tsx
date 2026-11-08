"use client";
// Story 9.2 (FR70, UX-DR24): the 4541 panel. An uncalibrated page asks for a
// calibration first; a calibrated one shows the checklist, Fill zone and
// Polygon zone, and the page's zones (name, use, hazard chip, area). A row
// and the canvas share the selection; a selected zone's holes are tagged here.
// Story 9.3 (FR71): each row's use dropdown sets the hazard class through the
// use -> hazard mapping (the company's, else the platform's); the selected
// zone shows its rule figures and ruleset version to check against the standard.
import { Check, LandPlot, PaintBucket, Pentagon, Ruler, Square } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cx } from "@/components/ui/cx";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { markupBounds } from "@/core/markup/geometry";
import { HOLE_TAGS, type HoleTag, type ZoneMarkup } from "@/core/schema/markup";
import type { UseHazardMap } from "@/core/sprinkler/rules/rules";
import { MAPPING_SOURCE_LABELS, figureRows, figuresOf, useOptions, type MappingSource } from "@/core/sprinkler/use-map";
import { HOLE_TAG_LABELS, ZONE_COLOR, formatZoneArea, holeTagOf, isZone, withHoleTag, zoneAreaM2, zoneChecklist, zoneHazard } from "@/core/sprinkler/zone";
import { openCalibrate } from "@/features/calibration";
import { editorStore, executeOp, markupsOf, armZoneDraw, setSelection, zoneDrawStore } from "@/features/editor";
import { FirstUseTip } from "@/features/tips";
import { hasDocument, setTool, viewerCommands, viewerStore } from "@/features/viewer";

import { getUseHazardMap } from "./actions";
import { loadUseMap, useMapStore } from "./use-map-store";

export const CALIBRATE_FIRST = "Calibrate this page first";
export const CALIBRATE_FIRST_HINT = "Zones and head spacing are in real units, so the 4541 tools need this page's scale.";
export const ZONES_TIP = "Fill a room to make a zone, or draw its outline. Each zone takes a use; the use sets its hazard class.";
export const NO_ZONES = "No zones on this page yet.";
export const CHANGE_HOLE_TAG = "Change hole tag";
export const CHANGE_USE = "Change use";
export const UNMAPPED_USE = "This use is not in the mapping. Choose a use to set the hazard class.";
export const DRAFT_MAPPING = "draft, not yet verified";

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

  // Story 9.3: the mapping is read once per session (the built-in one until then).
  useEffect(() => {
    void loadUseMap(getUseHazardMap);
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

  const checklist = zoneChecklist(zones, map);
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
      </div>
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
  onSelect,
  onUse,
}: {
  zone: ZoneMarkup;
  selected: boolean;
  areaText: string;
  map: UseHazardMap;
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
