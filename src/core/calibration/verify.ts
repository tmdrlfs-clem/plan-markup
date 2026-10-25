// Verifying a calibration against a known dimension (Story 4.4, FR25, NFR8). Framework-free.
//
// Two points picked on the page are measured with the page's calibration
// (measureLength: separate X / Y factors applied along the line) and compared
// with the distance the user knows. Both are compared as they are shown: at
// the calibration's display unit and precision, so "Matches" means the shown
// numbers are equal and "Off by" is the difference of the shown numbers.

import { measureLength, type Calibration } from "./calibration";
import { formatReal, roundToPrecision } from "./units";

/** A picked line: its length along user space x and y in page points (UserUnit applied). */
export type PickedLine = { dxPt: number; dyPt: number };

export type VerifyResult = {
  /** The measured length (mm, unrounded) and as shown. */
  measuredMm: number;
  measuredText: string;
  /** The known length, its text, the signed difference (measured − known, of the shown values) and the percentage (unrounded); null without a known length. */
  knownMm: number | null;
  knownText: string | null;
  differenceMm: number | null;
  differenceText: string | null;
  percent: number | null;
  /** Measured and known are equal at the shown precision; null without a known length. */
  matches: boolean | null;
};

/** A signed length as shown (rounded to the precision): "+12 mm", "-0.05 m", `+0'-1/8"`, "0 mm". */
export function formatSigned(mm: number, unit: Calibration["unit"], precision: Calibration["precision"]): string {
  const shown = roundToPrecision(mm, unit, precision);
  const text = formatReal(shown, unit, precision);
  return shown > 0 ? `+${text}` : text;
}

/** The measured length of `line` under `calibration`, compared with `knownMm` when given (AC 3, 5). */
export function verifyCalibration(
  line: PickedLine,
  calibration: Pick<Calibration, "xFactor" | "yFactor" | "unit" | "precision">,
  knownMm: number | null,
): VerifyResult {
  const { unit, precision } = calibration;
  const measuredMm = measureLength(line.dxPt, line.dyPt, calibration);
  const shownMeasured = roundToPrecision(measuredMm, unit, precision);
  const measuredText = formatReal(shownMeasured, unit, precision);
  if (knownMm === null || !(knownMm > 0) || !Number.isFinite(knownMm)) {
    return { measuredMm, measuredText, knownMm: null, knownText: null, differenceMm: null, differenceText: null, percent: null, matches: null };
  }
  const shownKnown = roundToPrecision(knownMm, unit, precision);
  // The difference of the shown values, snapped to whole steps (no 1e-13 left over).
  const differenceMm = roundToPrecision(shownMeasured - shownKnown, unit, precision);
  const matches = formatReal(shownMeasured, unit, precision) === formatReal(shownKnown, unit, precision);
  return {
    measuredMm,
    measuredText,
    knownMm,
    knownText: formatReal(shownKnown, unit, precision),
    differenceMm: matches ? 0 : differenceMm,
    differenceText: formatSigned(matches ? 0 : differenceMm, unit, precision),
    percent: ((measuredMm - knownMm) / knownMm) * 100,
    matches,
  };
}

/** "+0.80 %", "-0.10 %", "+<0.01 %" (review V3: a difference never reads as none), "0.00 %" only for none. */
export function formatPercent(percent: number): string {
  if (percent === 0 || !Number.isFinite(percent)) return "0.00 %";
  const sign = percent > 0 ? "+" : "-";
  const text = Math.abs(percent).toFixed(2);
  return text === "0.00" ? `${sign}<0.01 %` : `${sign}${text} %`;
}
