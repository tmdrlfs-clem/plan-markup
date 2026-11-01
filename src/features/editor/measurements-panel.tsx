"use client";

// The Measurements panel (Story 4.11, FR30, UX-DR20): the active document's
// measurements on every page, grouped by type with a total per group in the
// units chosen in the panel's header. Clicking a row (or Enter / Space on it)
// shows its page, fits the measurement in view and selects it. The values come
// from core/measure/totals, as the captions' do (NFR8).

import { useMemo, useRef, type KeyboardEvent } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { cx } from "@/components/ui/cx";
import { Select } from "@/components/ui/select";
import { DISPLAY_UNITS, pageIdOf, type DisplayUnit } from "@/core/calibration/calibration";
import { formatMeasured } from "@/core/calibration/units";
import { sheetLabelOf } from "@/core/pdf/sheet-label";
import type { MeasureMarkup } from "@/core/schema/markup";
import {
  MEASURE_NAMES,
  formatTotal,
  formatValue,
  markupBounds,
  measurementGroups,
  panelPrecision,
  type MeasurementGroup,
  type MeasurementRow,
  type PageContext,
  type PanelUnits,
} from "@/core/measure/totals";
import { hasDocument, setTool, viewerCommands, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf, setSelection } from "./editor-store";

/** AC 6: the empty state names the measure tools. */
export const MEASUREMENTS_HINT = "Measure with Length, Polylength, Area, Count, Angle, Radius, Diameter or Dynamic fill from the tool rail.";

const UNIT_LABELS: Record<DisplayUnit, string> = { mm: "mm", m: "m", in: "in", "ft-in": "ft-in" };

/** D4: the unit chosen in the panel for this session (null: the active page's calibration unit). */
export const measurementUnits = createStore<{ unit: DisplayUnit | null }>(() => ({ unit: null }));

const MEASURE_TYPES: ReadonlySet<string> = new Set(["length", "polylength", "area", "count", "angle", "radius", "diameter"]);

/** The page of a row: its sheet label when known, else "Page n". */
function pageText(index: number, pageLabels: readonly string[] | null, sheetLabels: Readonly<Record<number, string | null>>): string {
  return sheetLabelOf(index + 1, pageLabels?.[index], sheetLabels[index])?.short ?? `Page ${index + 1}`;
}

/** Shows a row's measurement and selects it (AC 5); a tool in use gives way to Select (review R1). */
function reveal(row: MeasurementRow): void {
  if (viewerStore.getState().tool !== "select") setTool("select");
  // The page first: another page clears the selection (Story 5.1 D4).
  viewerCommands.revealMarkup(row.pageIndex, markupBounds(row.markup));
  setSelection([row.markup.id]);
}

export function MeasurementsPanel({ emptyText, noDrawingText }: { emptyText: string; noDrawingText: string }) {
  const shown = useStore(viewerStore, hasDocument);
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const pages = useStore(viewerStore, (s) => s.pages);
  const pageIndex = useStore(viewerStore, (s) => s.pageIndex);
  const calibrations = useStore(viewerStore, (s) => s.calibrations);
  const pageLabels = useStore(viewerStore, (s) => s.pageLabels);
  const sheetLabels = useStore(viewerStore, (s) => s.sheetLabels);
  const markups = useStore(editorStore, (s) => markupsOf(s, documentId));
  const selected = useStore(editorStore, (s) => s.selection.ids);
  const chosen = useStore(measurementUnits, (s) => s.unit);

  const groups = useMemo(() => {
    if (!documentId) return [];
    const pageOf = (pageId: string): (PageContext & { pageIndex: number }) | null => {
      const index = Number(pageId.slice(pageId.lastIndexOf(":") + 1));
      if (!pageId.startsWith(`${documentId}:`) || !Number.isInteger(index) || index < 0 || index >= pages.length) return null;
      const u = pages[index].userUnit;
      return { pageIndex: index, calibration: calibrations[pageId] ?? null, userUnit: u && u > 0 ? u : 1 };
    };
    const measures = markups.filter((m): m is MeasureMarkup => MEASURE_TYPES.has(m.type));
    return measurementGroups(measures, pageOf);
  }, [documentId, markups, pages, calibrations]);

  const units = useMemo((): PanelUnits => {
    const active = documentId ? (calibrations[pageIdOf(documentId, pageIndex)] ?? null) : null;
    const first = documentId ? (Object.entries(calibrations).find(([id]) => id.startsWith(`${documentId}:`))?.[1] ?? null) : null;
    const unit = chosen ?? active?.unit ?? first?.unit ?? "m";
    return { unit, precision: panelPrecision(unit, active ?? first) };
  }, [chosen, documentId, pageIndex, calibrations]);

  if (!shown || !documentId) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md">
        <p>{noDrawingText}</p>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md" data-testid="measurements-empty">
        <p>{emptyText}</p>
        <p className="text-ws-sm text-muted">{MEASUREMENTS_HINT}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <Select
          label="Units"
          value={units.unit}
          onValueChange={(v) => measurementUnits.setState({ unit: v as DisplayUnit })}
          options={DISPLAY_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
        />
      </div>
      <MeasurementList
        groups={groups}
        units={units}
        selected={selected}
        page={(i) => pageText(i, pageLabels, sheetLabels)}
      />
    </div>
  );
}

function MeasurementList({
  groups,
  units,
  selected,
  page,
}: {
  groups: MeasurementGroup[];
  units: PanelUnits;
  selected: readonly string[];
  page: (index: number) => string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const ids = groups.flatMap((g) => g.rows.map((r) => r.markup.id));
  // One tab stop: the selected row, else the first.
  const focusId = ids.find((id) => selected.includes(id)) ?? ids[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.findIndex((r) => r === document.activeElement);
    const next =
      event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next].focus();
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Measurements"
      className="min-h-0 flex-1 overflow-y-auto py-1"
      onKeyDown={onKeyDown}
      data-testid="measurements-list"
    >
      {groups.map((group) => {
        const total = formatTotal(group, units);
        const name = MEASURE_NAMES[group.type];
        const headerId = `measurements-${group.type}`;
        return (
          <div key={group.type} role="group" aria-labelledby={headerId} data-testid={`measurements-group-${group.type}`}>
            <div id={headerId} className="flex items-baseline gap-2 bg-surface-2 px-3 py-1 text-ws-sm font-medium">
              <span className="text-text">{`${name} (${group.rows.length})`}</span>
              {group.unscaled > 0 ? <span className="text-muted">{`${group.unscaled} not scaled`}</span> : null}
              {total !== null ? (
                <span className="ml-auto tabular-nums text-text" data-testid="measurements-total">
                  {total}
                </span>
              ) : null}
            </div>
            {group.rows.map((row) => {
              const isSelected = selected.includes(row.markup.id);
              const value = formatValue(group.type, row.value, units);
              const perimeter = row.value.kind === "area" ? `P ${formatMeasured(row.value.perimeterMm, units.unit, units.precision)}` : undefined;
              return (
                <div
                  key={row.markup.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={row.markup.id === focusId ? 0 : -1}
                  title={perimeter}
                  data-testid="measurements-row"
                  className={cx(
                    "flex h-7 cursor-default items-center gap-2 px-3 text-ws-md outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                    isSelected ? "bg-accent-soft text-text" : "hover:bg-surface-3",
                  )}
                  onClick={() => reveal(row)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    reveal(row);
                  }}
                >
                  <span className="truncate text-muted">{page(row.pageIndex)}</span>
                  <span className={cx("ml-auto tabular-nums", row.value.kind === "none" ? "text-warning-text" : "text-text")}>{value}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
