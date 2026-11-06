// Story 6.7 (FR45, UX-DR28): the Markups List's rows. One row per markup of the
// document, in page order and drawing order within a page. Measurement values
// read as their captions do (the page's calibration unit and precision).

import type { Calibration } from "@/core/calibration/calibration";
import { DEFAULT_PRECISION, formatValue, measurementValue, panelPrecision, type PanelUnits } from "@/core/measure/totals";
import type { Layer } from "@/core/schema/layer";
import { isMeasureMarkup, type Markup, type MarkupType } from "@/core/schema/markup";

import { SUBJECT_NAMES, subjectOf } from "./properties";

export type MarkupListRow = {
  id: string;
  type: MarkupType;
  subject: string;
  pageIndex: number;
  /** The page's sheet label, else "Page n". */
  page: string;
  /** ISO creation time. */
  date: string;
  color: string;
  /** The layer's name; "" without one. */
  layer: string;
  /** Story 7.3: the device type a placed tool counts as ("Group · Label"); "" when it does not count. */
  device: string;
  /** The measurement value as its caption reads; "" for other markups. */
  value: string;
  /** Story 6.8: the value as a number for sorting (mm, mm², count or degrees); null without one. */
  measure: number | null;
  markup: Markup;
};

/** What the rows need of the document's pages. */
export type ListPage = { label: string; calibration: Calibration | null; userUnit: number };

/** The page index of `pageId` in document `documentId`, or null (another document, or out of range). */
export function pageIndexOf(pageId: string, documentId: string, pageCount: number): number | null {
  if (!pageId.startsWith(`${documentId}:`)) return null;
  const index = Number(pageId.slice(documentId.length + 1));
  return Number.isInteger(index) && index >= 0 && index < pageCount ? index : null;
}

/** The rows of `markups` (eraser strokes are not listed: they belong to the drawing's clean-up, not its review). */
export function markupListRows(
  markups: readonly Markup[],
  documentId: string,
  pages: readonly ListPage[],
  layers: readonly Layer[],
): MarkupListRow[] {
  const layerNames = new Map(layers.map((l) => [l.id, l.name]));
  const rows: MarkupListRow[] = [];
  markups.forEach((markup) => {
    if (markup.type === "eraser") return;
    const pageIndex = pageIndexOf(markup.pageId, documentId, pages.length);
    if (pageIndex === null) return;
    const page = pages[pageIndex];
    let value = "";
    let measure: number | null = null;
    if (isMeasureMarkup(markup)) {
      const unit = page.calibration?.unit ?? "m";
      const units: PanelUnits = { unit, precision: page.calibration ? panelPrecision(unit, page.calibration) : DEFAULT_PRECISION[unit] };
      const v = measurementValue(markup, { calibration: page.calibration, userUnit: page.userUnit });
      value = formatValue(markup.type, v, units);
      measure = v.kind === "length" ? v.mm : v.kind === "area" ? v.mm2 : v.kind === "count" ? v.n : v.kind === "angle" ? v.degrees : null;
    }
    rows.push({
      id: markup.id,
      type: markup.type,
      subject: subjectOf(markup),
      pageIndex,
      page: page.label,
      date: markup.createdAt,
      color: markup.style.color,
      layer: markup.layerId ? (layerNames.get(markup.layerId) ?? "") : "",
      device: markup.device ? `${markup.device.group} · ${markup.device.label}` : "",
      value,
      measure,
      markup,
    });
  });
  // Stable: drawing order within a page.
  return rows.sort((a, b) => a.pageIndex - b.pageIndex);
}

/** The rows a fixed-height window shows: `[start, end)` with `overscan` rows each side. */
export function visibleRange(scrollTop: number, height: number, rowHeight: number, count: number, overscan = 8): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, height)) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

// ---- Story 6.8 (FR46, UX-DR28): sort, column filters and the quick filter ----

export type SortKey = "type" | "subject" | "page" | "date" | "color" | "layer" | "device" | "value";
export type ListSort = { key: SortKey; dir: "asc" | "desc" } | null;
export type FilterKey = "type" | "page" | "color" | "layer" | "device";
export type ColumnFilters = Partial<Record<FilterKey, readonly string[]>>;
export type ListView = { sort: ListSort; filters: ColumnFilters; quick: string };

export const EMPTY_VIEW: ListView = { sort: null, filters: {}, quick: "" };
export const FILTER_KEYS: readonly FilterKey[] = ["type", "page", "color", "layer", "device"];
export const FILTER_LABELS: Record<FilterKey, string> = { type: "Type", page: "Page", color: "Colour", layer: "Layer", device: "Device" };
/** The layer filter's value for markups on no layer. */
export const NO_LAYER = "No layer";
/** Story 7.3: the device filter's value for markups that are not counted. */
export const NO_DEVICE = "Not a device";

/** A row's value for column filter `key` (as the filter lists it). */
export function filterValue(row: MarkupListRow, key: FilterKey): string {
  switch (key) {
    case "type":
      return SUBJECT_NAMES[row.type];
    case "page":
      return row.page;
    case "color":
      return row.color.toLowerCase();
    case "layer":
      return row.layer || NO_LAYER;
    case "device":
      return row.device || NO_DEVICE;
  }
}

/** The distinct values of `key` in `rows`: pages in page order, the rest alphabetical. */
export function filterOptions(rows: readonly MarkupListRow[], key: FilterKey): string[] {
  const seen = new Set<string>();
  for (const row of rows) seen.add(filterValue(row, key));
  const values = [...seen];
  return key === "page" ? values : values.sort((a, b) => a.localeCompare(b));
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: MarkupListRow, b: MarkupListRow, key: SortKey): number {
  switch (key) {
    case "type":
      return collator.compare(SUBJECT_NAMES[a.type], SUBJECT_NAMES[b.type]);
    case "subject":
      return collator.compare(a.subject, b.subject);
    case "page":
      return a.pageIndex - b.pageIndex;
    case "date":
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    case "color":
      return a.color.toLowerCase().localeCompare(b.color.toLowerCase());
    case "layer":
      return collator.compare(a.layer, b.layer);
    case "device":
      return collator.compare(a.device, b.device);
    case "value":
      return (a.measure ?? 0) - (b.measure ?? 0);
  }
}

/** The quick filter: every word must appear in one of the row's texts (case-insensitive). */
function matchesQuick(row: MarkupListRow, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const text = [row.subject, SUBJECT_NAMES[row.type], row.page, row.layer, row.device, row.value, row.color].join("\n").toLocaleLowerCase();
  return words.every((w) => text.includes(w));
}

/**
 * The rows `view` shows: column filters (any of a column's values; every
 * filtered column), the quick filter, then the sort (stable; when sorting by
 * value, rows without one sort last either way). Without a sort, list order.
 */
export function applyListView(rows: readonly MarkupListRow[], view: ListView): MarkupListRow[] {
  const words = view.quick.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const active = FILTER_KEYS.filter((k) => (view.filters[k]?.length ?? 0) > 0).map((k) => [k, new Set(view.filters[k])] as const);
  const shown = rows.filter((row) => active.every(([k, values]) => values.has(filterValue(row, k))) && matchesQuick(row, words));
  const sort = view.sort;
  if (!sort) return shown;
  const sign = sort.dir === "asc" ? 1 : -1;
  return shown
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      if (sort.key === "value" && (a.row.measure === null) !== (b.row.measure === null)) return a.row.measure === null ? 1 : -1;
      return sign * compare(a.row, b.row, sort.key) || a.i - b.i;
    })
    .map(({ row }) => row);
}

/** The next sort after clicking column `key`'s header: ascending, descending, then none. */
export function nextSort(current: ListSort, key: SortKey): ListSort {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** "Showing 24 of 312" while something filters, else "312 markups". */
export function countText(shown: number, total: number, filtered: boolean): string {
  if (filtered) return `Showing ${shown} of ${total}`;
  return `${total} ${total === 1 ? "markup" : "markups"}`;
}

/** Whether `view` filters anything. */
export function isFiltered(view: ListView): boolean {
  return view.quick.trim() !== "" || FILTER_KEYS.some((k) => (view.filters[k]?.length ?? 0) > 0);
}
