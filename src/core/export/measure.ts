// Measurement values and ISO 32000 measure dictionaries (framework-free).
// Values follow the page calibration; the /Measure dictionary lets a reader
// that understands ISO 32000 rectilinear measurement recompute them.

import { name, text, type PdfDictValue } from "../pdf/value";
import type { Calibration, Markup, Pt } from "./model";

export type MeasureValue = {
  value: number;
  /** Unit label shown with the value ("m", "m²", "°", "" for counts). */
  unit: string;
  /** Display text, e.g. "3.53 m". */
  text: string;
};

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function pathLength(points: Pt[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  if (closed && points.length > 2) total += dist(points[points.length - 1]!, points[0]!);
  return total;
}

/** Unsigned shoelace area in pt². */
export function polygonArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** Area-weighted centroid of a simple polygon (vertex mean when degenerate). */
export function polygonCentroid(points: Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Angle at `vertex` between the rays to `a` and `b`, in degrees (0..180). */
export function angleDeg(vertex: Pt, a: Pt, b: Pt): number {
  const a1 = Math.atan2(a[1] - vertex[1], a[0] - vertex[0]);
  const a2 = Math.atan2(b[1] - vertex[1], b[0] - vertex[0]);
  let d = Math.abs(a1 - a2) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

export function areaUnit(unit: string): string {
  return `${unit}²`;
}

function fixed(n: number, decimals: number): string {
  return n.toFixed(decimals);
}

/** The value of a measurement markup, or undefined for other types (Story 8.1: its text as the app shows it, when given). */
export function measureValue(m: Markup, cal: Calibration): MeasureValue | undefined {
  const v = computedValue(m, cal);
  return v && m.valueText !== undefined ? { ...v, text: m.valueText } : v;
}

function computedValue(m: Markup, cal: Calibration): MeasureValue | undefined {
  const k = cal.unitsPerPoint;
  const len = (pt: number): MeasureValue => {
    const value = pt * k;
    return { value, unit: cal.unit, text: `${fixed(value, cal.decimals)} ${cal.unit}` };
  };
  switch (m.type) {
    case "dimension":
    case "length":
      return len(dist(m.from, m.to));
    case "polylength":
      return len(pathLength(m.points));
    case "perimeter":
      return len(pathLength(m.points, true));
    case "area":
    case "dynamicFill": {
      const value = polygonArea(m.points) * k * k;
      const unit = areaUnit(cal.unit);
      return { value, unit, text: `${fixed(value, cal.decimals)} ${unit}` };
    }
    case "radius": {
      const v = len(m.radius);
      return { ...v, text: `R ${v.text}` };
    }
    case "diameter": {
      const v = len(2 * m.radius);
      return { ...v, text: `Ø ${v.text}` };
    }
    case "angle": {
      const value = angleDeg(m.vertex, m.a, m.b);
      return { value, unit: "°", text: `${value.toFixed(1)}°` };
    }
    case "count":
      return { value: m.points.length, unit: "", text: String(m.points.length) };
    default:
      return undefined;
  }
}

function numberFormat(unit: string, factor: number, decimals: number): PdfDictValue {
  return {
    Type: name("NumberFormat"),
    U: text(unit),
    C: factor,
    F: name("D"),
    D: 10 ** decimals,
  };
}

/**
 * ISO 32000 rectilinear measure dictionary (12.9, Table 261): /X converts
 * user-space units to the calibrated unit, /D formats distances and /A areas
 * (the area label is "sq <unit>", the form ISO viewers show).
 */
export function measureDictionary(cal: Calibration): PdfDictValue {
  return {
    Type: name("Measure"),
    Subtype: name("RL"),
    R: text(cal.label),
    X: [numberFormat(cal.unit, cal.unitsPerPoint, cal.decimals)],
    D: [numberFormat(cal.unit, 1, cal.decimals)],
    A: [numberFormat(`sq ${cal.unit}`, 1, cal.decimals)],
  };
}
