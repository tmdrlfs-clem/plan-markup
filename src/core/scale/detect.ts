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
import { canonicalSheet, niceRatio, pageSheet, ratioOnPage } from "./sheet";

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
};

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
  type Found = { ratio: number; sheet: string | null; imperial: boolean; text: string; quads: Quad[] };
  const found: Found[] = [];
  for (const line of textLines(items)) {
    const index = buildPageText(line);
    for (const m of findRatios(index.text)) {
      const sheet = m.sheet ? canonicalSheet(m.sheet) : null;
      found.push({ ratio: m.ratio, sheet, imperial: m.imperial, text: m.text.replace(/^scale\W*/i, ""), quads: matchQuads(line, index, m) });
    }
  }
  // "1:50" elsewhere on a sheet that also says "1:50 @ A1" is the same statement with the sheet left off.
  const qualified = new Map<number, string>();
  for (const f of found) if (f.sheet && !qualified.has(f.ratio)) qualified.set(f.ratio, f.sheet);
  const byEffective = new Map<number, DetectedScale>();
  for (const f of found) {
    const sheet = f.sheet ?? (f.imperial ? null : (qualified.get(f.ratio) ?? null));
    const effective = niceRatio(ratioOnPage(f.ratio, sheet, widthPt, heightPt));
    const entry = byEffective.get(effective);
    if (entry) {
      entry.count++;
      entry.quads.push(...f.quads);
      // Keep the spelling that names a sheet.
      if (sheet && !entry.sheet) Object.assign(entry, { ratio: f.ratio, sheet, text: f.text });
    } else {
      byEffective.set(effective, { ratio: f.ratio, sheet, effective, imperial: f.imperial, text: f.text, count: 1, quads: [...f.quads] });
    }
  }
  const page = pageSheet(widthPt, heightPt);
  // Implausible for the page: the whole sheet would be over 50 km in reality.
  const scales = [...byEffective.values()]
    .filter((s) => (s.effective * page.longMm) / 1e6 <= 50)
    .sort((a, b) => b.count - a.count || a.effective - b.effective);
  return { scales, pageSheet: page.name };
}

/** How a detected scale reads: "1:100 @ A1", "1:100", or `1/8" = 1'-0"` (as printed). */
export function scaleLabel(s: DetectedScale): string {
  if (s.imperial) return s.text;
  return s.sheet ? `1:${s.ratio} @ ${s.sheet}` : `1:${s.ratio}`;
}

/** "1:100 @ A1 → 1:200 on this A3 page" when the page converts it; null when it does not. */
export function conversionNote(s: DetectedScale, pageSheetName: string | null): string | null {
  if (s.effective === s.ratio) return null;
  return `${scaleLabel(s)} → 1:${s.effective} on this ${pageSheetName ? `${pageSheetName} ` : ""}page`;
}
