// Length parsing and formatting for measurement fields. Framework-free.
// Lengths are stored in millimetres (`lengthMm`); other units appear only at the edges.
import { MM_PER_INCH } from "./units";

export type LengthUnit = "mm" | "m" | "ft-in";

export type ParseLengthResult =
  | { ok: true; mm: number }
  | { ok: false; reason: "empty" | "invalid" | "negative" };

const MM_PER_FOOT = MM_PER_INCH * 12;
const NUM = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;

// Metric: number with optional unit (mm, cm, m).
const METRIC = new RegExp(String.raw`^(${NUM})\s*(mm|cm|m)?$`);
// Revu-style feet-inches: 15-6 (or 15-6.5).
const FEET_DASH = new RegExp(String.raw`^(\d+)-(${NUM})$`);
// Imperial: optional feet part (15' / 15ft) and optional inches part (6" / 6in / 6 1/2" / 1/2").
const IMPERIAL = new RegExp(
  String.raw`^(?:(${NUM})\s*(?:'|ft)\s*)?(?:(?:(${NUM})(?:\s+(\d+)\s*/\s*(\d+))?|(\d+)\s*/\s*(\d+))\s*(?:"|in))?$`,
);

function normalise(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"');
}

function fraction(num: string, den: string): number | null {
  const d = Number(den);
  return d === 0 ? null : Number(num) / d;
}

/**
 * Parses a typed length into millimetres. Whitespace is ignored, units are
 * case-insensitive and the decimal separator is ".". Bare numbers use `defaultUnit`
 * (feet when it is "ft-in"). The result is not rounded.
 */
export function parseLength(input: string, defaultUnit: LengthUnit): ParseLengthResult {
  const text = normalise(input);
  if (text === "") return { ok: false, reason: "empty" };
  if (/^-\s*[\d.]/.test(text)) return { ok: false, reason: "negative" };

  const metric = METRIC.exec(text);
  if (metric) {
    const value = Number(metric[1]);
    const unit = metric[2] ?? (defaultUnit === "ft-in" ? "ft" : defaultUnit);
    if (unit === "ft") return { ok: true, mm: value * MM_PER_FOOT };
    const factor = unit === "mm" ? 1 : unit === "cm" ? 10 : 1000;
    return { ok: true, mm: value * factor };
  }

  if (defaultUnit === "ft-in") {
    const dash = FEET_DASH.exec(text);
    if (dash) return { ok: true, mm: Number(dash[1]) * MM_PER_FOOT + Number(dash[2]) * MM_PER_INCH };
  }

  const imp = IMPERIAL.exec(text);
  if (imp && (imp[1] !== undefined || imp[2] !== undefined || imp[5] !== undefined)) {
    let inches = 0;
    if (imp[2] !== undefined) {
      inches = Number(imp[2]);
      if (imp[3] !== undefined && imp[4] !== undefined) {
        const f = fraction(imp[3], imp[4]);
        if (f === null) return { ok: false, reason: "invalid" };
        inches += f;
      }
    } else if (imp[5] !== undefined && imp[6] !== undefined) {
      const f = fraction(imp[5], imp[6]);
      if (f === null) return { ok: false, reason: "invalid" };
      inches = f;
    }
    const feet = imp[1] !== undefined ? Number(imp[1]) : 0;
    return { ok: true, mm: feet * MM_PER_FOOT + inches * MM_PER_INCH };
  }

  return { ok: false, reason: "invalid" };
}

export interface FormatLengthOptions {
  /** Maximum decimals for mm (default 0) and m (default 3, trailing zeros trimmed). */
  decimals?: number;
}

function trimNumber(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function feetInches(mm: number): { sign: string; feet: number; whole: number; num: number; den: number } {
  const sign = mm < 0 ? "-" : "";
  const eighths = Math.round((Math.abs(mm) / MM_PER_INCH) * 8);
  const feet = Math.floor(eighths / 96);
  const rem = eighths % 96;
  const whole = Math.floor(rem / 8);
  let num = rem % 8;
  let den = 8;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  return { sign, feet, whole, num, den };
}

/** The number text without a unit suffix for mm / m; the full `15'6"` text for ft-in. */
export function formatLengthValue(mm: number, unit: LengthUnit, options: FormatLengthOptions = {}): string {
  if (unit === "mm") return trimNumber(mm, options.decimals ?? 0);
  if (unit === "m") return trimNumber(mm / 1000, options.decimals ?? 3);
  const { sign, feet, whole, num, den } = feetInches(mm);
  const frac = num > 0 ? ` ${num}/${den}` : "";
  return `${sign}${feet}'${whole}${frac}"`;
}

/** Display suffix kept outside the text: "mm", "m", or "" for ft-in (the text carries ' and "). */
export function lengthUnitSuffix(unit: LengthUnit): string {
  return unit === "ft-in" ? "" : unit;
}

/** Display text with unit: `4600 mm`, `4.6 m`, `15'6"`. */
export function formatLength(mm: number, unit: LengthUnit, options: FormatLengthOptions = {}): string {
  const value = formatLengthValue(mm, unit, options);
  return unit === "ft-in" ? value : `${value} ${unit}`;
}

/** Spoken form for aria-valuetext: `4.6 m`, `15 feet 6 inches`. */
export function describeLength(mm: number, unit: LengthUnit, options: FormatLengthOptions = {}): string {
  if (unit !== "ft-in") return formatLength(mm, unit, options);
  const { sign, feet, whole, num, den } = feetInches(mm);
  const parts: string[] = [];
  if (feet > 0 || (whole === 0 && num === 0)) parts.push(`${feet} ${feet === 1 ? "foot" : "feet"}`);
  if (whole > 0 || num > 0) {
    const frac = num > 0 ? `${whole > 0 ? " " : ""}${num}/${den}` : "";
    parts.push(`${whole > 0 ? whole : ""}${frac} ${whole === 1 && num === 0 ? "inch" : "inches"}`);
  }
  return `${sign}${parts.join(" ")}`;
}
