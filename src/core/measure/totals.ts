// The Measurements panel's values and totals (Story 4.11, FR30). Framework-free.
//
// Every measurement of a document, grouped by type in the measure menu's
// order, with its real value under its page's calibration and a total per
// group. Values stay unrounded until shown; a total sums them and rounds once,
// so a total can differ from the sum of the rounded rows by a step (NFR8: the
// rows read exactly as the captions do). A measurement on a page without a
// calibration has no value and stays out of its group's total (founder
// default D3); counts and angles need no scale. Angles, radii and diameters
// have no total (D2: a sum of angles means nothing).

import type { Calibration, DisplayUnit, Precision } from "@/core/calibration/calibration";
import { formatMeasured, precisionsFor } from "@/core/calibration/units";
import type { MeasureMarkup } from "@/core/schema/markup";

import { angleDegrees, formatAngle } from "./angle";
import { areaMm2, formatArea, perimeterMm } from "./area";
import { POINTS_IN_A_LINE, circleThrough, radiusMm } from "./circle";
import { SCALE_NOT_SET, lengthMm } from "./length";

type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export type MeasureType = MeasureMarkup["type"];

/** The panel's group order: the measure menu's (a Dynamic fill is an Area). */
export const MEASURE_ORDER: readonly MeasureType[] = ["length", "polylength", "area", "count", "angle", "radius", "diameter"];

export const MEASURE_NAMES: Record<MeasureType, string> = {
  length: "Length",
  polylength: "Polylength",
  area: "Area",
  count: "Count",
  angle: "Angle",
  radius: "Radius",
  diameter: "Diameter",
};

/** A measurement's real value, or why it has none. */
export type MeasurementValue =
  | { kind: "length"; mm: number }
  | { kind: "area"; mm2: number; perimeterMm: number }
  | { kind: "count"; n: number }
  | { kind: "angle"; degrees: number }
  | { kind: "none"; reason: "scale" | "line" };

/** What a measurement's page brings: its calibration and UserUnit. */
export type PageContext = { calibration: Pick<Calibration, "xFactor" | "yFactor"> | null; userUnit: number };

/** The real value of `m` on its page (radius and diameter as lengths: the diameter is twice the radius). */
export function measurementValue(m: MeasureMarkup, page: PageContext): MeasurementValue {
  const { calibration, userUnit } = page;
  switch (m.type) {
    case "count":
      return { kind: "count", n: m.points.length };
    case "angle":
      return { kind: "angle", degrees: angleDegrees(m.points[0], m.points[1], m.points[2], calibration) ?? 0 };
    case "radius":
    case "diameter": {
      if (!circleThrough(m.points[0], m.points[1], m.points[2])) return { kind: "none", reason: "line" };
      const r = radiusMm(m.points, calibration, userUnit);
      return r === null ? { kind: "none", reason: "scale" } : { kind: "length", mm: m.type === "radius" ? r : 2 * r };
    }
    case "area": {
      const mm2 = areaMm2(m.points, m.holes, calibration, userUnit);
      const p = perimeterMm(m.points, calibration, userUnit);
      return mm2 === null || p === null ? { kind: "none", reason: "scale" } : { kind: "area", mm2, perimeterMm: p };
    }
    default: {
      const mm = lengthMm(m.points, calibration, userUnit);
      return mm === null ? { kind: "none", reason: "scale" } : { kind: "length", mm };
    }
  }
}

/** The units the panel shows in: a display unit and its precision. */
export type PanelUnits = { unit: DisplayUnit; precision: Precision };

/** Defaults per unit when the active page's precision does not suit it (D4). */
export const DEFAULT_PRECISION: Record<DisplayUnit, Precision> = { mm: "0", m: "0.00", in: "0.0", "ft-in": "1/8" };

/** The precision for `unit`: the calibration's when it suits the unit, else the unit's default. */
export function panelPrecision(unit: DisplayUnit, calibration: Pick<Calibration, "precision"> | null): Precision {
  return calibration && precisionsFor(unit).includes(calibration.precision) ? calibration.precision : DEFAULT_PRECISION[unit];
}

/** A value as the panel shows it (as its caption reads, in `units`). */
export function formatValue(type: MeasureType, value: MeasurementValue, units: PanelUnits): string {
  switch (value.kind) {
    case "none":
      return value.reason === "line" ? POINTS_IN_A_LINE : SCALE_NOT_SET;
    case "count":
      return String(value.n);
    case "angle":
      return formatAngle(value.degrees);
    case "area":
      return formatArea(value.mm2, units.unit);
    case "length": {
      const text = formatMeasured(value.mm, units.unit, units.precision);
      return type === "radius" ? `R ${text}` : type === "diameter" ? `Ø ${text}` : text;
    }
  }
}

export type MeasurementRow = { markup: MeasureMarkup; pageIndex: number; value: MeasurementValue };

export type MeasurementGroup = {
  type: MeasureType;
  rows: MeasurementRow[];
  /** The sum (mm, mm² or markers); null for groups without a total (D2). */
  total: number | null;
  /** Rows without a value (no scale, no circle): left out of the total. */
  unscaled: number;
};

const TOTALLED: ReadonlySet<MeasureType> = new Set(["length", "polylength", "area", "count"]);

/** Whether a group has a total (D2: angles, radii and diameters do not). */
export function hasTotal(type: MeasureType): boolean {
  return TOTALLED.has(type);
}

/**
 * The document's measurements in groups (non-empty ones, in MEASURE_ORDER), rows in page
 * order then drawing order. `pageOf` maps a markup's page id to its index and context; a
 * markup whose page is unknown is left out.
 */
export function measurementGroups(
  markups: readonly MeasureMarkup[],
  pageOf: (pageId: string) => (PageContext & { pageIndex: number }) | null,
): MeasurementGroup[] {
  const byType = new Map<MeasureType, MeasurementRow[]>();
  markups.forEach((markup) => {
    const page = pageOf(markup.pageId);
    if (!page) return;
    const rows = byType.get(markup.type) ?? [];
    rows.push({ markup, pageIndex: page.pageIndex, value: measurementValue(markup, page) });
    byType.set(markup.type, rows);
  });
  const groups: MeasurementGroup[] = [];
  for (const type of MEASURE_ORDER) {
    const rows = byType.get(type);
    if (!rows) continue;
    // A stable sort: drawing order within a page.
    rows.sort((a, b) => a.pageIndex - b.pageIndex);
    let total = 0;
    let unscaled = 0;
    for (const { value } of rows) {
      if (value.kind === "none") unscaled++;
      else if (value.kind === "length") total += value.mm;
      else if (value.kind === "area") total += value.mm2;
      else if (value.kind === "count") total += value.n;
    }
    groups.push({ type, rows, total: hasTotal(type) ? total : null, unscaled });
  }
  return groups;
}

/** A group's total as shown; null without one (D2). */
export function formatTotal(group: MeasurementGroup, units: PanelUnits): string | null {
  if (group.total === null) return null;
  if (group.type === "count") return String(group.total);
  if (group.type === "area") return formatArea(group.total, units.unit);
  return formatMeasured(group.total, units.unit, units.precision);
}

/** The user-space box of a measurement: its points, or a radius's / diameter's whole circle. */
export function markupBounds(m: MeasureMarkup): Rect {
  let points: readonly Point[] = m.points;
  if (m.type === "radius" || m.type === "diameter") {
    const circle = circleThrough(m.points[0], m.points[1], m.points[2]);
    if (circle) {
      const { centre, radius } = circle;
      points = [
        { x: centre.x - radius, y: centre.y - radius },
        { x: centre.x + radius, y: centre.y + radius },
      ];
    }
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
