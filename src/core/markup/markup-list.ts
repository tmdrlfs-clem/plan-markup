// Story 6.7 (FR45, UX-DR28): the Markups List's rows. One row per markup of the
// document, in page order and drawing order within a page. Measurement values
// read as their captions do (the page's calibration unit and precision).

import type { Calibration } from "@/core/calibration/calibration";
import { DEFAULT_PRECISION, formatValue, measurementValue, panelPrecision, type PanelUnits } from "@/core/measure/totals";
import type { Layer } from "@/core/schema/layer";
import { isMeasureMarkup, type Markup, type MarkupType } from "@/core/schema/markup";

import { subjectOf } from "./properties";

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
  /** The measurement value as its caption reads; "" for other markups. */
  value: string;
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
    if (isMeasureMarkup(markup)) {
      const unit = page.calibration?.unit ?? "m";
      const units: PanelUnits = { unit, precision: page.calibration ? panelPrecision(unit, page.calibration) : DEFAULT_PRECISION[unit] };
      value = formatValue(markup.type, measurementValue(markup, { calibration: page.calibration, userUnit: page.userUnit }), units);
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
      value,
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
