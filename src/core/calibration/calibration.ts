// A page's calibration (Story 4.3, FR24, AR8). Framework-free.
//
// A calibration is a pure value: how many real millimetres one point of the
// page is, along the page's x and y (PDF user space axes, UserUnit applied:
// the axes of the status bar's X/Y readout), with the display unit and
// precision the user chose and where it came from. Lengths are stored in
// millimetres everywhere (src/core/geometry/length.ts); other units appear
// only when shown or typed. The Zod schema is shared with persistence
// (Epic 6 saves it with the markup set).

import { z } from "zod";

import { ratioOnPage } from "@/core/scale/sheet";

/** Real millimetres of paper per PDF point (1/72 in). */
export const MM_PER_POINT = 25.4 / 72;

/** Units a calibration shows lengths in (UX: mm, m, in, ft-in). */
export const DISPLAY_UNITS = ["mm", "m", "in", "ft-in"] as const;
export type DisplayUnit = (typeof DISPLAY_UNITS)[number];

/** Precisions: decimals, or a fraction of an inch for in and ft-in. */
export const PRECISIONS = ["0", "0.0", "0.00", "1/8", "1/16"] as const;
export type Precision = (typeof PRECISIONS)[number];

export const CALIBRATION_SOURCES = ["detected", "ratio", "points"] as const;
export type CalibrationSource = (typeof CALIBRATION_SOURCES)[number];

const factor = z.number().finite().positive();

export const calibrationSchema = z.object({
  /**
   * Real millimetres per page point along PDF user space x, and along y (equal unless a separate
   * vertical scale was set). On a page whose /Rotate is 90 or 270 the drawing's vertical is user
   * space x (4.3 review R2): see calibrationsFor and calibrationLabel.
   */
  xFactor: factor,
  yFactor: factor,
  unit: z.enum(DISPLAY_UNITS),
  precision: z.enum(PRECISIONS),
  source: z.enum(CALIBRATION_SOURCES),
  /** The ratio as entered or detected (1:ratio), with the sheet it was stated for, if any. */
  ratio: factor.optional(),
  sheet: z.string().max(16).nullable().optional(),
  /** A separate vertical ratio (1:yRatio), if one was set. */
  yRatio: factor.optional(),
});

export type Calibration = z.infer<typeof calibrationSchema>;

/**
 * The stable id of a page (AR8). Pages have no ids of their own until saved
 * documents (Epic 6) and page edits (Epic 12) exist, so it is the document's
 * sha256 and the page's 0-based index.
 * TODO(A2, Epic 12): page inserts / deletes must carry the ids with the pages.
 */
export function pageIdOf(sha256: string, index: number): string {
  return `${sha256}:${index}`;
}

/** Real millimetres per page point at 1:ratio. */
export function factorForRatio(ratio: number): number {
  return ratio * MM_PER_POINT;
}

/** The page size a ratio is converted for (points, as shown), and its /Rotate (the vertical scale follows the page as it reads). */
export type PageSize = { width: number; height: number; rotate?: number };

/**
 * The ratio a printed or typed 1:`ratio` stated for `sheet` (null: none) has
 * on a page of `page` (Story 4.2's conversion: 1:100 @ A1 on an A3 page is
 * 1:200).
 */
export function ratioForPage(ratio: number, sheet: string | null | undefined, page: PageSize): number {
  return ratioOnPage(ratio, sheet ?? null, page.width, page.height);
}

/** Real millimetres per page point from two points `distancePt` apart that are `realMm` apart in reality. */
export function factorFromPoints(distancePt: number, realMm: number): number {
  if (!(distancePt > 0) || !(realMm > 0)) throw new RangeError("Both distances must be positive");
  return realMm / distancePt;
}

/** Usual drawing ratios (metric and imperial) a two-point calibration is rounded to. */
const USUAL_RATIOS = [
  1, 2, 4, 5, 8, 10, 12, 16, 20, 24, 25, 30, 32, 40, 48, 50, 60, 64, 75, 96, 100, 120, 125, 150, 192, 200, 240, 250, 300, 360, 400, 480,
  500, 600, 750, 1000, 1200, 1250, 1500, 2000, 2500, 5000, 10000,
];

/** The usual ratio (1:n) a factor is within 0.5 % of, or null (a two-point calibration that is not a round ratio). */
export function roundRatioOf(f: number): number | null {
  const ratio = f / MM_PER_POINT;
  return USUAL_RATIOS.find((n) => Math.abs(ratio - n) <= n * 0.005) ?? null;
}

/**
 * The real length in millimetres of a line `dx`, `dy` page points long along
 * user space x and y (UserUnit applied) under `calibration` (Story 4.4 AC 5,
 * NFR8): the one function verification and the measuring tools (4.5) use.
 */
export function measureLength(dx: number, dy: number, calibration: Pick<Calibration, "xFactor" | "yFactor">): number {
  return Math.hypot(dx * calibration.xFactor, dy * calibration.yFactor);
}

/** What the ScaleIndicator shows for a calibrated page: the label and its tooltip. */
export function calibrationLabel(c: Calibration, rotate = 0): { label: string; tooltip: string } {
  // A ratio typed or printed is shown as it is (1:33.3); two points only when they make a usual ratio.
  const ratioOf = (f: number) => (c.source === "points" ? roundRatioOf(f) : Number((f / MM_PER_POINT).toFixed(2)));
  // X / Y as the page reads (review R2): on a page turned by /Rotate 90 or 270, its horizontal is user space y.
  const [hFactor, vFactor] = sideways(rotate) ? [c.yFactor, c.xFactor] : [c.xFactor, c.yFactor];
  const x = ratioOf(hFactor);
  const y = ratioOf(vFactor);
  const how = c.source === "points" ? "two points" : c.source === "detected" ? "the printed scale" : "a ratio";
  const per = (f: number) => `1 pt = ${trim(f, 4)} mm`;
  if (hFactor === vFactor || (x !== null && x === y)) {
    if (x !== null) return { label: `Scale 1:${x}`, tooltip: `Calibrated from ${how}: 1:${x} (${per(hFactor)})` };
    return { label: "Calibrated", tooltip: `Calibrated from ${how}: ${per(hFactor)}` };
  }
  const name = (r: number | null, f: number) => (r !== null ? `1:${r}` : per(f));
  const both = `horizontal ${name(x, hFactor)}, vertical ${name(y, vFactor)}`;
  if (x !== null && y !== null) return { label: `Scale 1:${x} / 1:${y}`, tooltip: `Calibrated from ${how}: ${both}` };
  return { label: "Calibrated (X ≠ Y)", tooltip: `Calibrated from ${how}: ${both}` };
}

/** A page turned a quarter by its /Rotate: its horizontal and vertical are user space y and x. */
export function sideways(rotate: number | undefined): boolean {
  const r = (((rotate ?? 0) % 360) + 360) % 360;
  return r === 90 || r === 270;
}

function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** What the Calibrate dialog applies (AC 1, 3): a ratio (typed or detected) or a two-point factor. */
export type CalibrationInput =
  | { kind: "ratio" | "detected"; ratio: number; sheet: string | null; yRatio?: number }
  | { kind: "points"; factor: number; yRatio?: number };

/**
 * The calibration of each page of a range (AC 3): a ratio applies to each
 * page as a ratio (one stated for a sheet is converted per page, like 4.2);
 * a two-point factor applies as the same mm per point to every page. A
 * separate vertical ratio follows the same rule as a ratio; it is the page's
 * vertical as the page reads (its /Rotate applied, the view rotation not:
 * founder decision 2026-10-25), so on a /Rotate 90 or 270 page it lands on
 * user space x (review R2).
 */
export function calibrationsFor(
  input: CalibrationInput,
  pages: readonly { index: number; size: PageSize }[],
  display: { unit: DisplayUnit; precision: Precision },
): Map<number, Calibration> {
  const out = new Map<number, Calibration>();
  for (const { index, size } of pages) {
    const sheet = input.kind === "points" ? null : input.sheet;
    const hFactor = input.kind === "points" ? input.factor : factorForRatio(ratioForPage(input.ratio, sheet, size));
    const vFactor = input.yRatio ? factorForRatio(ratioForPage(input.yRatio, sheet, size)) : hFactor;
    const [xFactor, yFactor] = sideways(size.rotate) ? [vFactor, hFactor] : [hFactor, vFactor];
    const c: Calibration = { xFactor, yFactor, unit: display.unit, precision: display.precision, source: input.kind === "detected" ? "detected" : input.kind };
    if (input.kind !== "points") {
      c.ratio = input.ratio;
      c.sheet = input.sheet;
    }
    if (input.yRatio) c.yRatio = input.yRatio;
    out.set(index, c);
  }
  return out;
}

/** True when the pages are not all the same size (±1 %, either orientation): the dialog says how the range is handled. */
export function mixedSizes(sizes: readonly PageSize[]): boolean {
  if (sizes.length < 2) return false;
  const key = (s: PageSize) => [Math.min(s.width, s.height), Math.max(s.width, s.height)] as const;
  const [a0, a1] = key(sizes[0]);
  return sizes.some((s) => {
    const [b0, b1] = key(s);
    return Math.abs(b0 - a0) > a0 * 0.01 || Math.abs(b1 - a1) > a1 * 0.01;
  });
}
