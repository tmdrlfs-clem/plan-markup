// Length units and the status bar's coordinate readout (Story 3.7). Framework-free.
//
// Until a page is calibrated (Epic 4, Story 4.3) coordinates are PDF units:
// points, 1/72 in, origin at the bottom-left corner of the unrotated page.
// A calibration hands formatCursor a `measure` (its unit and real length per
// point), and the same readout shows real units.

export type LengthUnit = "mm" | "in" | "pt";

/** The length unit until Settings > Units exists (Story 3.7 decision: millimetres). */
export const DEFAULT_LENGTH_UNIT: LengthUnit = "mm";

export const POINTS_PER_INCH = 72;
const MM_PER_INCH = 25.4;

/** A length in points expressed in `unit`. */
export function fromPoints(points: number, unit: LengthUnit): number {
  if (unit === "pt") return points;
  const inches = points / POINTS_PER_INCH;
  return unit === "in" ? inches : inches * MM_PER_INCH;
}

/** A calibrated page's measure: real length per PDF point, in `unit` (Story 4.3 fills it). */
export type Measure = { unit: string; perPoint: number; digits?: number };

/** A number with a fixed count of decimals and no "-0". */
export function formatNumber(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text;
}

/**
 * The cursor readout: "X 1234.5  Y 678.9 pt" (two spaces between the axes;
 * render it with white-space: pre). An empty string without a point (the
 * pointer is off the page, or no drawing is open).
 */
export function formatCursor(point: { x: number; y: number } | null, measure?: Measure): string {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return "";
  const unit = measure?.unit ?? "pt";
  const factor = measure?.perPoint ?? 1;
  const digits = measure?.digits ?? 1;
  return `X ${formatNumber(point.x * factor, digits)}  Y ${formatNumber(point.y * factor, digits)} ${unit}`;
}
