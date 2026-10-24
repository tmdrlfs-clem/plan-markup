// Real lengths typed and shown by calibration (Story 4.3 AC 2, 3, 5). Framework-free.
//
// Typed distances: mm, m, in, ft or ft-in (`12'-6"`, `12'6`, `12-6`, `6 1/2"`),
// a unit typed with the number wins over the selected one. Shown lengths: the
// calibration's display unit and precision (decimals, or 1/8" / 1/16" for
// inches and feet-inches). Everything is millimetres inside.

import { parseLength } from "@/core/geometry/length";
import { MM_PER_INCH } from "@/core/geometry/units";
import { formatNumber } from "@/core/units/format";

import type { Calibration, DisplayUnit, Precision } from "./calibration";

/** Units a known distance can be typed in. */
export const INPUT_UNITS = ["mm", "m", "in", "ft", "ft-in"] as const;
export type InputUnit = (typeof INPUT_UNITS)[number];

export const MM_PER_FOOT = MM_PER_INCH * 12;

export type ParseDistanceResult = { ok: true; mm: number } | { ok: false; message: string };

const BARE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A typed real distance in millimetres; zero, negative and unreadable text are errors with a message. */
export function parseDistance(text: string, unit: InputUnit): ParseDistanceResult {
  const t = text.trim();
  if (t === "") return { ok: false, message: "Enter the real distance" };
  let mm: number | null = null;
  if (BARE.test(t) && (unit === "in" || unit === "ft")) {
    mm = Number(t) * (unit === "in" ? MM_PER_INCH : MM_PER_FOOT);
  } else {
    const r = parseLength(t, unit === "in" || unit === "ft" ? "ft-in" : unit);
    if (!r.ok) {
      return { ok: false, message: r.reason === "negative" ? "The distance must be more than 0" : `Enter a distance like 4.6 m or 12'-6"` };
    }
    mm = r.mm;
  }
  if (!(mm > 0) || !Number.isFinite(mm)) return { ok: false, message: "The distance must be more than 0" };
  return { ok: true, mm };
}

/** Decimals of a precision (a fraction precision has none). */
export function precisionDecimals(precision: Precision): number {
  return precision === "0.00" ? 2 : precision === "0.0" ? 1 : 0;
}

/** The denominator of a fraction precision (8, 16), or null for decimals. */
function fractionOf(precision: Precision): number | null {
  return precision === "1/8" ? 8 : precision === "1/16" ? 16 : null;
}

/** Whole and fraction of `inches` rounded to 1/den: `6 1/2`, `6`, `1/16`. */
function inchText(inches: number, den: number): string {
  const steps = Math.round(inches * den);
  const whole = Math.floor(steps / den);
  let num = steps % den;
  let d = den;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    d /= 2;
  }
  const text = num > 0 ? (whole > 0 ? `${whole} ${num}/${d}` : `${num}/${d}`) : String(whole);
  return text;
}

/** A length's number in a unit without its unit mark (ft-in carries its marks). */
export function formatRealValue(mm: number, unit: DisplayUnit, precision: Precision): string {
  const sign = mm < 0 ? "-" : "";
  const abs = Math.abs(mm);
  const den = fractionOf(precision);
  const decimals = precisionDecimals(precision);
  switch (unit) {
    case "mm":
      return formatNumber(mm, decimals);
    case "m":
      return formatNumber(mm / 1000, decimals);
    case "in": {
      const inches = abs / MM_PER_INCH;
      if (den) {
        const t = inchText(inches, den);
        return `${t === "0" ? "" : sign}${t}`;
      }
      return formatNumber(mm / MM_PER_INCH, decimals);
    }
    case "ft-in": {
      const totalInches = abs / MM_PER_INCH;
      if (den) {
        const steps = Math.round(totalInches * den);
        const feet = Math.floor(steps / (12 * den));
        const rest = (steps - feet * 12 * den) / den;
        return `${steps === 0 ? "" : sign}${feet}'-${inchText(rest, den)}"`;
      }
      const factor = 10 ** decimals;
      const steps = Math.round(totalInches * factor);
      const feet = Math.floor(steps / (12 * factor));
      const rest = (steps - feet * 12 * factor) / factor;
      return `${steps === 0 ? "" : sign}${feet}'-${rest.toFixed(decimals)}"`;
    }
  }
}

/** The unit mark after a number (none for ft-in, whose text carries ' and "). */
export function unitSuffix(unit: DisplayUnit): string {
  return unit === "ft-in" ? "" : unit === "in" ? '"' : ` ${unit}`;
}

/** A length with its unit: `4600 mm`, `4.60 m`, `12 1/2"`, `12'-6"`. */
export function formatReal(mm: number, unit: DisplayUnit, precision: Precision): string {
  return `${formatRealValue(mm, unit, precision)}${unitSuffix(unit)}`;
}

/**
 * The status bar's cursor readout on a calibrated page (AC 5): `point` in
 * page points from the page's bottom-left corner (view.ts fromPageCorner),
 * shown in the calibration's unit and precision: "X 1234.5  Y 678.9 mm",
 * `X 12'-6"  Y 3'-0"`. Empty without a point.
 */
export function formatCursorReal(point: { x: number; y: number } | null, c: Pick<Calibration, "xFactor" | "yFactor" | "unit" | "precision">): string {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return "";
  const x = formatRealValue(point.x * c.xFactor, c.unit, c.precision);
  const y = formatRealValue(point.y * c.yFactor, c.unit, c.precision);
  if (c.unit === "ft-in") return `X ${x}  Y ${y}`;
  return `X ${x}  Y ${y}${c.unit === "in" ? " in" : ` ${c.unit}`}`;
}

/** The precisions that make sense for a unit (fractions only with inches). */
export function precisionsFor(unit: DisplayUnit): Precision[] {
  return unit === "in" || unit === "ft-in" ? ["0", "0.0", "0.00", "1/8", "1/16"] : ["0", "0.0", "0.00"];
}

/** The precision label in menus: 0, 0.0, 0.00, 1/8", 1/16". */
export function precisionLabel(p: Precision): string {
  return p === "1/8" || p === "1/16" ? `${p}"` : p;
}
