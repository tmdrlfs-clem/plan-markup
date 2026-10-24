// Scale detection on a page's text (Story 4.2, FR23). Framework-free.
//
// Input: the page's text items (src/core/search/page-text.ts, page space,
// the same items search and sheet labels use). They are grouped into lines
// (runs on one baseline, close together, in any direction, so rotated text
// works), each line normalised like the search text, and the ratios found
// (ratio.ts). Each ratio is resolved for this page: a sheet named with it
// converts it (sheet.ts); a bare ratio repeated next to a qualified one is the
// same statement. The result lists the distinct scales of the page with where
// they are printed (page-space quads) for calibration later (Story 4.3).

import { buildPageText, type Quad, type TextItem } from "@/core/search/page-text";
import { matchQuads } from "@/core/search/match";

import { findRatios } from "./ratio";
import { canonicalSheet, niceRatio, pageSheet, ratioOnPage, ratioOnSheet } from "./sheet";

export type DetectedScale = {
  /** The ratio as printed (1:ratio) and the sheet it names, if any. */
  ratio: number;
  sheet: string | null;
  /** The ratio on this page (the printed one converted to the page's sheet). */
  effective: number;
  imperial: boolean;
  /** One printed spelling ("SCALE 1:100 @ A1" → "1:100 @ A1"). */
  text: string;
  /** How many times it is printed, and where (page space). */
  count: number;
  quads: Quad[];
  /**
   * Founder decision 2026-10-24 (4.2 review D1): one view stated for several sheet sizes whose
   * statements give different ratios on this page (L21: "1 : 75 @ A1 1 : 200 @ A3"; 1:75 on A1
   * is 1:150 on A3). Then `readings` holds each statement; ratio / sheet / effective are the
   * first one's (the page's own sheet when it is stated). Never applied without Calibrate (4.3).
   */
  conflict: boolean;
  /** Each distinct printed statement of this scale with its ratio on this page (the page's own sheet first). */
  readings: ScaleReading[];
};

/** One printed statement of a scale: 1:ratio for `sheet` (null: none named), `effective` on this page. */
export type ScaleReading = { ratio: number; sheet: string | null; effective: number; text: string };

export type PageScales = {
  /** Distinct effective scales, most printed first. */
  scales: DetectedScale[];
  /** The page's own sheet (page-size.ts), if it is a standard one. */
  pageSheet: string | null;
};

/** Baselines further apart than this share of the font size are different lines. */
const LINE_ACROSS = 0.5;
/** A gap along the line wider than this many font sizes starts another line (another cell of a table). */
const LINE_ALONG = 3;

/** An item's baseline direction (unit) and where it sits along / across it. */
function frame(item: TextItem): { ux: number; uy: number; along: number; across: number; end: number } {
  const [x0, y0, x1, y1] = item.quad;
  let ux = x1 - x0;
  let uy = y1 - y0;
  const length = Math.hypot(ux, uy);
  if (length > 1e-9) {
    ux /= length;
    uy /= length;
  } else {
    ux = 1;
    uy = 0;
  }
  const along = x0 * ux + y0 * uy;
  return { ux, uy, along, across: -x0 * uy + y0 * ux, end: along + length };
}

/**
 * The page's items grouped into lines by geometry, not by the order they are
 * drawn in (Revit draws a view title's "1 : 75", "1 : 200", "@ A1", "@ A3" as
 * interleaved runs): runs with the same direction whose baselines are within
 * half a font size, ordered along the line, split where the gap is wider than
 * LINE_ALONG font sizes (another cell of a table, another note).
 */
export function textLines(items: readonly TextItem[]): TextItem[][] {
  type Row = { ux: number; uy: number; across: number; size: number; members: { item: TextItem; along: number; end: number }[] };
  const rows: Row[] = [];
  // Rows bucketed by direction and baseline offset (one point steps), so a dense page stays linear.
  const buckets = new Map<string, Row[]>();
  const keyOf = (ux: number, uy: number, across: number) => `${Math.round(ux * 20)},${Math.round(uy * 20)},${Math.round(across)}`;
  for (const item of items) {
    if (item.str.trim() === "") continue;
    const f = frame(item);
    const size = Math.max(item.fontSize, 1e-6);
    const reach = Math.ceil(LINE_ACROSS * size) + 1;
    let row: Row | undefined;
    for (let d = -reach; d <= reach && !row; d++) {
      row = buckets.get(keyOf(f.ux, f.uy, f.across + d))?.find((r) => r.ux * f.ux + r.uy * f.uy > 0.98 && Math.abs(r.across - f.across) <= LINE_ACROSS * Math.max(size, r.size));
    }
    if (!row) {
      row = { ux: f.ux, uy: f.uy, across: f.across, size, members: [] };
      rows.push(row);
      const key = keyOf(f.ux, f.uy, f.across);
      buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    row.members.push({ item, along: f.along, end: f.end });
  }
  const lines: TextItem[][] = [];
  for (const row of rows) {
    row.members.sort((a, b) => a.along - b.along);
    let line: TextItem[] = [];
    let reach = -Infinity;
    for (const m of row.members) {
      if (line.length > 0 && m.along - reach > LINE_ALONG * row.size) {
        lines.push(line);
        line = [];
      }
      // The line's items join with a gap (a space) unless they touch; eol never splits a geometric line.
      line.push({ ...m.item, eol: false });
      reach = Math.max(reach, m.end);
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

/**
 * The printed scales of a page `widthPt` × `heightPt` points (page space,
 * /Rotate applied) from its text items.
 */
export function detectScales(items: readonly TextItem[], widthPt: number, heightPt: number): PageScales {
  /** One printed ratio; `view` groups the statements of one line naming several sheets. */
  type Statement = { ratio: number; sheet: string | null; imperial: boolean; text: string; quads: Quad[]; view: number | null };
  const statements: Statement[] = [];
  let views = 0;
  for (const line of textLines(items)) {
    const index = buildPageText(line);
    const inLine: Statement[] = [];
    for (const m of findRatios(index.text)) {
      const sheet = m.sheet ? canonicalSheet(m.sheet) : null;
      inLine.push({ ratio: m.ratio, sheet, imperial: m.imperial, text: m.text, quads: matchQuads(line, index, m), view: null });
    }
    // "1:75 @ A1  1:200 @ A3" on one line is one view's scale given for two sheet sizes (L21's view
    // title): one scale, whose statements are compared below (review D1).
    if (new Set(inLine.map((f) => f.sheet).filter((x) => x !== null)).size > 1) {
      const view = views++;
      for (const f of inLine) if (f.sheet) f.view = view;
    }
    statements.push(...inLine);
  }
  const page = pageSheet(widthPt, heightPt);
  // "1:50" elsewhere on a sheet that also says "1:50 @ A1" is the same statement with the sheet left off.
  const qualified = new Map<number, string>();
  for (const f of statements) if (f.sheet && !qualified.has(f.ratio)) qualified.set(f.ratio, f.sheet);
  const readingOf = (f: Statement): ScaleReading => {
    const sheet = f.sheet ?? (f.imperial ? null : (qualified.get(f.ratio) ?? null));
    return { ratio: f.ratio, sheet, effective: niceRatio(ratioOnPage(f.ratio, sheet, widthPt, heightPt)), text: f.text };
  };
  const sameReading = (a: ScaleReading, b: ScaleReading) => a.ratio === b.ratio && a.sheet === b.sheet;
  /** The page's own sheet first, then as printed. */
  const ordered = (readings: ScaleReading[]) => [...readings].sort((a, b) => Number(b.sheet === page.name) - Number(a.sheet === page.name));

  // Entries: one per printed scale (or view), keyed by its effective ratio, or by its readings for a conflict.
  const entries = new Map<string, DetectedScale>();
  const add = (key: string, readings: ScaleReading[], imperial: boolean, quads: Quad[], conflict: boolean) => {
    const entry = entries.get(key);
    if (!entry) {
      const first = ordered(readings)[0];
      entries.set(key, { ...first, imperial, count: 1, quads: [...quads], conflict, readings: ordered(readings) });
      return;
    }
    entry.count++;
    entry.quads.push(...quads);
    for (const r of readings) if (!entry.readings.some((x) => sameReading(x, r))) entry.readings.push(r);
    entry.readings = ordered(entry.readings);
    // Keep the spelling that names a sheet (the page's own first).
    const first = entry.readings.find((r) => r.sheet) ?? entry.readings[0];
    Object.assign(entry, { ratio: first.ratio, sheet: first.sheet, text: first.text, effective: entry.conflict ? first.effective : entry.effective });
  };
  const viewStatements = new Map<number, Statement[]>();
  for (const f of statements) {
    if (f.view === null) {
      const r = readingOf(f);
      add(`${r.effective}`, [r], f.imperial, f.quads, false);
    } else {
      viewStatements.set(f.view, [...(viewStatements.get(f.view) ?? []), f]);
    }
  }
  for (const group of viewStatements.values()) {
    const readings: ScaleReading[] = [];
    for (const f of group) {
      const r = readingOf(f);
      if (!readings.some((x) => sameReading(x, r))) readings.push(r);
    }
    const effectives = [...new Set(readings.map((r) => r.effective))].sort((a, b) => a - b);
    const quads = group.flatMap((f) => f.quads);
    // Statements that agree on this page are one plain scale; otherwise a conflict (founder decision 1).
    if (effectives.length === 1) add(`${effectives[0]}`, readings, false, quads, false);
    else add(`conflict:${effectives.join(",")}`, readings, false, quads, true);
  }
  // A plain scale equal to one reading of a conflict is that view printed again ("1:75" beside "1:75 @ A1 1:200 @ A3").
  for (const conflict of [...entries.values()].filter((e) => e.conflict)) {
    for (const [key, plain] of entries) {
      if (plain.conflict || !conflict.readings.some((r) => r.effective === plain.effective)) continue;
      conflict.count += plain.count;
      conflict.quads.push(...plain.quads);
      entries.delete(key);
    }
  }
  // Implausible for the page: the whole sheet would be over 50 km in reality.
  const scales = [...entries.values()]
    .filter((s) => (s.effective * page.longMm) / 1e6 <= 50)
    .sort((a, b) => b.count - a.count || a.effective - b.effective);
  return { scales, pageSheet: page.name };
}

/** How a detected scale reads: "1:100 @ A1", "1:100", or `1/8" = 1'-0"` (as printed). */
export function scaleLabel(s: DetectedScale): string {
  if (s.imperial) return s.text;
  return s.sheet ? `1:${s.ratio} @ ${s.sheet}` : `1:${s.ratio}`;
}

/** A reading as printed: "1:75 @ A1", "1:100". */
export function readingLabel(r: ScaleReading): string {
  return r.sheet ? `1:${r.ratio} @ ${r.sheet}` : `1:${r.ratio}`;
}

/**
 * The readings of a conflicting scale, each with its ratio on this page:
 * ["1:75 @ A1 = 1:75 on this A1 page", "1:200 @ A3 = 1:100 on this A1 page"].
 */
export function conflictReadings(s: DetectedScale, pageSheetName: string | null): string[] {
  const page = `on this ${pageSheetName ? `${pageSheetName} ` : ""}page`;
  return s.readings.map((r) => `${readingLabel(r)} = 1:${r.effective} ${page}`);
}

/**
 * Story 4.3 AC 6: why a conflicting scale is one, for the Calibrate dialog:
 * "Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed".
 */
export function conflictWarning(s: DetectedScale): string {
  const [first, ...others] = s.readings;
  const parts = others
    .filter((r) => first.sheet && r.sheet)
    .map((r) => `${readingLabel(first)} = 1:${niceRatio(ratioOnSheet(first.ratio, first.sheet!, r.sheet!))} @ ${r.sheet}, but ${readingLabel(r)} is printed`);
  return `Printed scales disagree: ${parts.join("; ") || s.readings.map(readingLabel).join(" and ")}`;
}

/** "1:100 @ A1 → 1:200 on this A3 page" when the page converts it; null when it does not. */
export function conversionNote(s: DetectedScale, pageSheetName: string | null): string | null {
  if (s.effective === s.ratio) return null;
  return `${scaleLabel(s)} → 1:${s.effective} on this ${pageSheetName ? `${pageSheetName} ` : ""}page`;
}
