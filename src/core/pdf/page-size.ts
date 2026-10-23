// The paper size of a page (Story 3.7, FR22). Framework-free.
//
// A page whose size is within ±1 % of a standard sheet (ISO A and B, ANSI,
// ARCH) is named after it, in that sheet's own unit and in the page's
// orientation as shown (/Rotate applied): "A1 841 × 594 mm", "ANSI D 34 × 22 in".
// Any other size is given in the user's length unit (mm by default): "500 × 300 mm".

import { POINTS_PER_INCH, fromPoints, type LengthUnit } from "@/core/units/format";

export type SheetSeries = "ISO A" | "ISO B" | "ANSI" | "ARCH";
export type Orientation = "landscape" | "portrait" | "square";

export type SheetSize = {
  /** The sheet's name ("A1", "ANSI D", "ARCH E1"), or null for a size that is not a standard sheet. */
  name: string | null;
  series: SheetSeries | null;
  orientation: Orientation;
  /** Width and height as shown, in `unit` (the nominal size for a named sheet). */
  width: number;
  height: number;
  unit: LengthUnit;
  /** "A1 841 × 594 mm", "ANSI D 34 × 22 in", "500 × 300 mm". */
  label: string;
};

type Sheet = { name: string; series: SheetSeries; short: number; long: number; unit: "mm" | "in" };

const iso = (series: "ISO A" | "ISO B", prefix: string, sizes: [number, number][]): Sheet[] =>
  sizes.map(([short, long], i) => ({ name: `${prefix}${i}`, series, short, long, unit: "mm" }));

/** The standard sheets, checked in this order. */
export const SHEETS: readonly Sheet[] = [
  ...iso("ISO A", "A", [
    [841, 1189],
    [594, 841],
    [420, 594],
    [297, 420],
    [210, 297],
    [148, 210],
  ]),
  ...iso("ISO B", "B", [
    [1000, 1414],
    [707, 1000],
    [500, 707],
    [353, 500],
    [250, 353],
  ]),
  ...(
    [
      ["A", 8.5, 11],
      ["B", 11, 17],
      ["C", 17, 22],
      ["D", 22, 34],
      ["E", 34, 44],
    ] as const
  ).map(([letter, short, long]): Sheet => ({ name: `ANSI ${letter}`, series: "ANSI", short, long, unit: "in" })),
  ...(
    [
      ["A", 9, 12],
      ["B", 12, 18],
      ["C", 18, 24],
      ["D", 24, 36],
      ["E", 36, 48],
      ["E1", 30, 42],
    ] as const
  ).map(([letter, short, long]): Sheet => ({ name: `ARCH ${letter}`, series: "ARCH", short, long, unit: "in" })),
];

/** A page within this share of a sheet's sides is that sheet. */
export const SHEET_TOLERANCE = 0.01;

const MM_PER_INCH = 25.4;

/** A length for a size label: inches to one decimal at most, millimetres and points whole. */
function sizeNumber(value: number, unit: LengthUnit): string {
  return String(unit === "in" ? Math.round(value * 10) / 10 : Math.round(value));
}

/**
 * The sheet a page of `widthPt` × `heightPt` points (as shown, /Rotate
 * applied) is printed on; `unit` is the user's length unit for sizes that are
 * not a standard sheet.
 */
export function sheetSize(widthPt: number, heightPt: number, unit: LengthUnit = "mm"): SheetSize {
  const orientation: Orientation = Math.abs(widthPt - heightPt) < 1e-6 ? "square" : widthPt > heightPt ? "landscape" : "portrait";
  const shortMm = (Math.min(widthPt, heightPt) / POINTS_PER_INCH) * MM_PER_INCH;
  const longMm = (Math.max(widthPt, heightPt) / POINTS_PER_INCH) * MM_PER_INCH;
  for (const sheet of SHEETS) {
    const factor = sheet.unit === "mm" ? 1 : MM_PER_INCH;
    const s = sheet.short * factor;
    const l = sheet.long * factor;
    if (Math.abs(shortMm - s) <= s * SHEET_TOLERANCE && Math.abs(longMm - l) <= l * SHEET_TOLERANCE) {
      const [width, height] = orientation === "landscape" ? [sheet.long, sheet.short] : [sheet.short, sheet.long];
      return {
        name: sheet.name,
        series: sheet.series,
        orientation,
        width,
        height,
        unit: sheet.unit,
        label: `${sheet.name} ${sizeNumber(width, sheet.unit)} × ${sizeNumber(height, sheet.unit)} ${sheet.unit}`,
      };
    }
  }
  const width = fromPoints(widthPt, unit);
  const height = fromPoints(heightPt, unit);
  return {
    name: null,
    series: null,
    orientation,
    width,
    height,
    unit,
    label: `${sizeNumber(width, unit)} × ${sizeNumber(height, unit)} ${unit}`,
  };
}
