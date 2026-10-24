// A printed ratio stated for one sheet, on a page of another size (Story 4.2
// AC 2). Framework-free.
//
// From the prototype (tool/src/core/20-scale.js: ratioForThisSheet,
// sheetLongEdge, SHEET_MM), rebuilt on the app's own sheet table
// (src/core/pdf/page-size.ts, Story 3.7) instead of a second one: a drawing
// set out at 1:100 on A1 and printed on A3 is 1:200 on that page; the paper
// shrank, the building did not.

import { SHEETS, sheetSize } from "@/core/pdf/page-size";

const MM_PER_INCH = 25.4;
const MM_PER_POINT = MM_PER_INCH / 72;

/** A sheet name as printed ("A1", "ansi d", "ARCH  E1") in the table's spelling, or null. */
export function canonicalSheet(name: string): string | null {
  const compact = name.toUpperCase().replace(/\s+/g, "");
  for (const sheet of SHEETS) if (sheet.name.replace(/\s+/g, "") === compact) return sheet.name;
  return null;
}

/** The long edge (mm) of a named sheet, or null. */
export function sheetLongEdgeMm(name: string): number | null {
  const sheet = SHEETS.find((s) => s.name === name);
  if (!sheet) return null;
  return sheet.long * (sheet.unit === "mm" ? 1 : MM_PER_INCH);
}

/** The page's sheet (page-size.ts, ±1 %) and long edge in mm, from its size in points. */
export function pageSheet(widthPt: number, heightPt: number): { name: string | null; longMm: number } {
  return { name: sheetSize(widthPt, heightPt).name, longMm: Math.max(widthPt, heightPt) * MM_PER_POINT };
}

/**
 * The ratio a printed `ratio` (1:ratio) stated for `statedSheet` has on a
 * page of `widthPt` × `heightPt` points. Within one ISO series a step is
 * exactly √2 (A1 → A3 is exactly 2, not 841/420); otherwise the long edges'
 * ratio. Unknown stated sheet or the same sheet: unchanged.
 */
export function ratioOnPage(ratio: number, statedSheet: string | null, widthPt: number, heightPt: number): number {
  if (!statedSheet) return ratio;
  const here = pageSheet(widthPt, heightPt);
  if (here.name === statedSheet) return ratio;
  const a = /^([AB])([0-9])$/.exec(statedSheet);
  const b = here.name ? /^([AB])([0-9])$/.exec(here.name) : null;
  if (a && b && a[1] === b[1]) return ratio * 2 ** ((Number(b[2]) - Number(a[2])) / 2);
  const stated = sheetLongEdgeMm(statedSheet);
  if (!stated) return ratio;
  return (ratio * stated) / here.longMm;
}

/**
 * The ratio a 1:`ratio` stated for sheet `from` is on sheet `to` (Story 4.3's
 * conflict warning: 1:75 @ A1 is 1:150 @ A3). Unknown sheets: unchanged.
 */
export function ratioOnSheet(ratio: number, from: string, to: string): number {
  if (from === to) return ratio;
  const a = /^([AB])([0-9])$/.exec(from);
  const b = /^([AB])([0-9])$/.exec(to);
  if (a && b && a[1] === b[1]) return ratio * 2 ** ((Number(b[2]) - Number(a[2])) / 2);
  const long = sheetLongEdgeMm(from);
  const other = sheetLongEdgeMm(to);
  return long && other ? (ratio * long) / other : ratio;
}

const NICE = [2, 5, 10, 20, 25, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000];

/** A converted ratio rounded to the nearest usual one when within 2 % (prototype niceRatio), else to 2 decimals. */
export function niceRatio(r: number): number {
  for (const v of NICE) if (Math.abs(r - v) <= Math.max(0.5, v * 0.02)) return v;
  return Math.round(r * 100) / 100;
}
