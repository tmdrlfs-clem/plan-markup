"use client";
// Story 9.2 (FR70, UX-DR24): the 4541 panel. An uncalibrated page asks for a
// calibration first; a calibrated one shows the checklist, Fill zone and
// Polygon zone, and the page's zones (name, use, hazard chip, area). A row
// and the canvas share the selection; a selected zone's holes are tagged here.
import { Check, LandPlot, PaintBucket, Pentagon, Ruler, Square } from "lucide-react";
import { useMemo } from "react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cx } from "@/components/ui/cx";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { markupBounds } from "@/core/markup/geometry";
import { HOLE_TAGS, type HoleTag, type ZoneMarkup } from "@/core/schema/markup";
import { HOLE_TAG_LABELS, ZONE_COLOR, formatZoneArea, holeTagOf, isZone, withHoleTag, zoneAreaM2, zoneChecklist, zoneHazard } from "@/core/sprinkler/zone";
import { openCalibrate } from "@/features/calibration";
import { editorStore, executeOp, markupsOf, armZoneDraw, setSelection, zoneDrawStore } from "@/features/editor";
import { FirstUseTip } from "@/features/tips";
import { hasDocument, setTool, viewerCommands, viewerStore } from "@/features/viewer";

export const CALIBRATE_FIRST = "Calibrate this page first";
export const CALIBRATE_FIRST_HINT = "Zones and head spacing are in real units, so the 4541 tools need this page's scale.";
export const ZONES_TIP = "Fill a room to make a zone, or draw its outline. Each zone takes a use; the use sets its hazard class.";
export const NO_ZONES = "No zones on this page yet.";
export const CHANGE_HOLE_TAG = "Change hole tag";

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

  const checklist = zoneChecklist(zones);
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
              onSelect={() => revealZone(z, pageIndex)}
            />
          ))}
        </ul>
      )}
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

function ZoneRow({ zone, selected, areaText, onSelect }: { zone: ZoneMarkup; selected: boolean; areaText: string; onSelect: () => void }) {
  const hazard = zoneHazard(zone);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        data-testid="zone-row"
        onClick={onSelect}
        className={cx(
          "flex w-full items-center gap-2 px-3 py-1 text-left text-ws-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          selected ? "bg-accent-soft text-text" : "hover:bg-surface-3",
        )}
      >
        <LandPlot size={14} aria-hidden="true" className="shrink-0" style={{ color: ZONE_COLOR }} />
        <span className="min-w-0 flex-1 truncate">{zone.zone.name}</span>
        <span className="truncate text-ws-sm text-muted">{zone.zone.use}</span>
        <span className="rounded-sm border border-border px-1 text-ws-sm font-semibold" data-testid="hazard-chip">
          {hazard ?? "?"}
        </span>
        <span className="w-16 shrink-0 text-right tabular-nums text-ws-sm">{areaText}</span>
      </button>
    </li>
  );
}
