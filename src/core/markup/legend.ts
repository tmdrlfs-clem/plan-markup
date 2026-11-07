// Story 7.8 (FR38, UX-DR27): the auto legend's content and layout (pure).
//
// Refactored from the prototype's legend (A12): its rows are the device types
// placed on the legend's page (or in its whole document), each with its symbol,
// its label and its count, sorted by group then label, under a title row (with
// "QTY") and over a total row. Nothing of it is stored but its title and scope:
// counts follow the markups as they are added, deleted or retyped.
//
// The layout is in "legend units" (one is a point at the size the legend is
// placed); the painter scales it to fit the markup's box.

import type { Point } from "./geometry";
import { boxFrom, screenAxes } from "./text";
import { deviceCounts } from "../tools/place";
import { DEFAULT_MARKUP_STYLE, type LegendMarkup, type LegendMeta, type Markup, type MarkupStyle } from "../schema/markup";

export const DEFAULT_LEGEND_TITLE = "LEGEND";
/** A new legend's style: black on a white fill (it is read over the drawing). */
export const DEFAULT_LEGEND_STYLE: MarkupStyle = { ...DEFAULT_MARKUP_STYLE, color: "#000000", fill: "#ffffff" };
/** The text size in legend units (the rest of the layout is in proportion to it). */
export const LEGEND_TEXT = 10;
export const LEGEND_QTY = "QTY";
export const LEGEND_TOTAL = "Total";
export const LEGEND_EMPTY = "No devices placed";

/** One legend row: a device type, its count and the placement drawn as its symbol. */
export type LegendRow = { group: string; label: string; text: string; count: number; symbol: Markup[] };

/** The markups a legend of `scope` on page `pageId` counts. */
export function legendScopeMarkups(markups: readonly Markup[], scope: LegendMeta["scope"], pageId: string): Markup[] {
  return scope === "document" ? [...markups] : markups.filter((m) => m.pageId === pageId);
}

/**
 * The legend's rows over `markups` (already scoped): one per device type, in group then label
 * order. A row's symbol is the type's first placement (by creation time) with its group's other
 * markups; its text is the label, or "group · label" when two groups share the label.
 */
export function legendRows(markups: readonly Markup[]): LegendRow[] {
  const counts = deviceCounts(markups);
  const first = new Map<string, Markup>();
  for (const m of markups) {
    if (!m.device) continue;
    const key = `${m.device.group}\u0000${m.device.label}`;
    const known = first.get(key);
    if (!known || m.createdAt < known.createdAt) first.set(key, m);
  }
  const labels = new Map<string, number>();
  for (const c of counts) labels.set(c.label, (labels.get(c.label) ?? 0) + 1);
  return counts.map((c) => {
    const head = first.get(`${c.group}\u0000${c.label}`)!;
    const symbol = head.groupId ? markups.filter((m) => m.groupId === head.groupId && m.pageId === head.pageId) : [head];
    return { group: c.group, label: c.label, text: (labels.get(c.label) ?? 0) > 1 ? `${c.group} · ${c.label}` : c.label, count: c.count, symbol };
  });
}

/** The devices a legend counts in all. */
export function legendTotal(rows: readonly LegendRow[]): number {
  return rows.reduce((n, r) => n + r.count, 0);
}

/** Layer 2's list entry: "LEGEND — 12 devices". */
export function legendLabel(meta: LegendMeta, total: number): string {
  return `${meta.title} — ${total} ${total === 1 ? "device" : "devices"}`;
}

/** A text's width in legend units at `LEGEND_TEXT` (bold for the title and counts). */
export type MeasureText = (text: string, bold: boolean) => number;

/** A width estimate where no canvas measures text (a new legend's size). */
export const estimateText: MeasureText = (text, bold) => text.length * LEGEND_TEXT * (bold ? 0.62 : 0.55);

/** Where everything goes, in legend units from the box's top left. */
export type LegendLayout = {
  width: number;
  height: number;
  pad: number;
  header: number;
  row: number;
  symbol: number;
  qty: number;
  /** The row texts' left edge and the counts' right edge. */
  textX: number;
  countX: number;
  /** Each row's top (then the total row's). */
  rowsY: number[];
  totalY: number | null;
};

/** The legend's natural layout for `rows` and `title`. */
export function legendLayout(rows: readonly LegendRow[], title: string, measure: MeasureText): LegendLayout {
  const u = LEGEND_TEXT;
  const pad = 0.5 * u;
  const header = 2 * u;
  const row = 2.4 * u;
  const symbol = 3 * u;
  const total = legendTotal(rows);
  const counts = [LEGEND_QTY, String(total), ...rows.map((r) => String(r.count))];
  const qty = Math.max(3 * u, ...counts.map((t) => measure(t, true) + 2 * pad));
  const texts = rows.length > 0 ? rows.map((r) => measure(r.text, false)) : [measure(LEGEND_EMPTY, false)];
  const text = Math.max(8 * u, ...texts, measure(LEGEND_TOTAL, true), measure(title, true) - symbol) + 2 * pad;
  const width = symbol + text + qty;
  const rowsY = Array.from({ length: Math.max(1, rows.length) }, (_, i) => header + i * row);
  const end = header + rowsY.length * row;
  const totalY = rows.length > 0 ? end : null;
  return { width, height: totalY === null ? end : end + header, pad, header, row, symbol, qty, textX: symbol + pad, countX: width - pad, rowsY, totalY };
}

/** A legend centred at `at` on page `pageId`, upright on screen (`toScreen`), at its natural size over `userUnit`. */
export function legendMarkupAt(
  meta: LegendMeta,
  rows: readonly LegendRow[],
  at: Point,
  pageId: string,
  toScreen: (p: Point) => Point,
  userUnit: number,
  id: string,
  createdAt: string,
): LegendMarkup {
  const unit = userUnit > 0 ? userUnit : 1;
  const layout = legendLayout(rows, meta.title, estimateText);
  const width = layout.width / unit;
  const height = layout.height / unit;
  const { right, down } = screenAxes(at, toScreen);
  const origin = { x: at.x - (right.x * width + down.x * height) / 2, y: at.y - (right.y * width + down.y * height) / 2 };
  return { id, pageId, createdAt, style: DEFAULT_LEGEND_STYLE, type: "legend", points: boxFrom(origin, right, down, width, height), legend: meta };
}

/** Where `points` (device px) fit, centred, in a `size` square at `centre` (legend units): the map and its scale. */
export function fitSymbol(points: readonly Point[], centre: Point, size: number): { map: (p: Point) => Point; scale: number } | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return null;
  const extent = Math.max(x1 - x0, y1 - y0);
  const scale = extent > 0 ? size / extent : 1;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { map: (p) => ({ x: centre.x + (p.x - cx) * scale, y: centre.y + (p.y - cy) * scale }), scale };
}
