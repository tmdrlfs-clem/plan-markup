// Story 8.1 (FR60, AR25): the app's markups → the export engine's model
// (framework-free). One model per page, in that page's user space; sizes in
// points become user units (UserUnit). Each type follows docs/export-mapping.md:
// native where a standard annotation fits, and white-out and eraser strokes
// marked to be flattened (A5: a cover must not move). Measurement values are
// the captions the app shows (its unit and precision, NFR8), written as the
// annotations' text; a rotated box that no axis-aligned annotation can hold
// keeps its shape as a polygon. A revision stamp and a legend become text
// boxes holding the text they show.

import type { Calibration as AppCalibration, DisplayUnit, Precision } from "@/core/calibration/calibration";
import { calibrationLabel } from "@/core/calibration/calibration";
import { dimensionLine } from "@/core/markup/dimension";
import { LEGEND_EMPTY, LEGEND_QTY, LEGEND_TOTAL, legendRows, legendScopeMarkups, legendTotal } from "@/core/markup/legend";
import { subjectOf } from "@/core/markup/properties";
import { revisionText } from "@/core/markup/revision";
import { ellipseFrame, ellipseOutline } from "@/core/markup/shapes";
import { cloudRingOf, leaderTo, leaderToRing } from "@/core/markup/text";
import { angleCaption } from "@/core/measure/angle";
import { areaCaption, areaCaptionText } from "@/core/measure/area";
import { circleCaption, circleThrough } from "@/core/measure/circle";
import { arcPoints } from "@/core/markup/arc";
import { lengthCaption } from "@/core/measure/length";
import type { Layer as AppLayer } from "@/core/schema/layer";
import type { Markup as AppMarkup, MarkupStyle } from "@/core/schema/markup";

import type { Box, Calibration, ExportDocument, Layer, Markup, MarkupBase, Pt, Rgb } from "./model";

type Point = { x: number; y: number };

/** A decoded image (Story 5.8 / 5.13 markups): 8-bit RGB and alpha. */
export type DecodedImage = { width: number; height: number; rgb: Uint8Array; alpha?: Uint8Array };

/** One page to export. */
export type ExportPageInput = { pageIndex: number; pageId: string; calibration: AppCalibration | null; userUnit: number };

/** What the export worker writes: the layers (shared by the pages) and each page's model and covers. */
export type ExportJob = {
  layers: Layer[];
  pages: { pageIndex: number; model: ExportDocument; flatten: string[] }[];
};

/** Real millimetres per display unit (ft-in is written in feet). */
const MM_PER: Record<DisplayUnit, number> = { mm: 1, m: 1000, in: 25.4, "ft-in": 304.8 };
const UNIT_NAME: Record<DisplayUnit, string> = { mm: "mm", m: "m", in: "in", "ft-in": "ft" };
const DECIMALS: Record<Precision, number> = { "0": 0, "0.0": 1, "0.00": 2, "1/8": 3, "1/16": 4 };

/** The export calibration of a page (/Measure): its unit per user unit; an uncalibrated page measures in points. */
export function exportCalibration(cal: AppCalibration | null, userUnit: number): Calibration {
  const u = userUnit > 0 ? userUnit : 1;
  if (!cal) return { label: "Scale not set", unit: "pt", unitsPerPoint: u, decimals: 2 };
  return { label: calibrationLabel(cal).label.replace(/^Scale /, ""), unit: UNIT_NAME[cal.unit], unitsPerPoint: (cal.xFactor * u) / MM_PER[cal.unit], decimals: DECIMALS[cal.precision] };
}

/** #rrggbb → 0..1 components. */
export function rgbOf(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const pt = (p: Point): Pt => [p.x, p.y];

/** The axis-aligned box around `points`. */
export function boundsOf(points: readonly Point[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [x0, y0, x1, y1];
}

/** Whether a four-corner box's sides run along the axes (an annotation /Rect can hold it). */
export function axisAligned(box: readonly Point[]): boolean {
  const eps = 1e-6 * Math.max(1, ...box.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  for (let i = 0; i < 4; i++) {
    const a = box[i];
    const b = box[(i + 1) % 4];
    if (Math.abs(a.x - b.x) > eps && Math.abs(a.y - b.y) > eps) return false;
  }
  return true;
}

/** The markup's caption as the app shows it (measurements and dimensions), else undefined. */
export function captionText(m: AppMarkup, cal: AppCalibration | null, userUnit: number): string | undefined {
  switch (m.type) {
    case "count":
      return String(m.points.length);
    case "angle":
      return angleCaption(m.points, cal).text;
    case "radius":
    case "diameter":
      return circleCaption(m.type, m.points, cal, userUnit).text;
    case "area":
      return areaCaptionText(areaCaption(m.points, m.holes, cal, userUnit));
    case "length":
    case "polylength":
      return lengthCaption(m.points, cal, userUnit).text;
    case "dimension":
      return lengthCaption(m.points.slice(0, 2), cal, userUnit).text;
    default:
      return undefined;
  }
}

/** A legend's text, as it reads: title and QTY, a line per device type, the total. */
export function legendText(title: string, rows: ReturnType<typeof legendRows>): string {
  if (rows.length === 0) return `${title} (${LEGEND_QTY})\n${LEGEND_EMPTY}`;
  return [`${title} (${LEGEND_QTY})`, ...rows.map((r) => `${r.text}: ${r.count}`), `${LEGEND_TOTAL}: ${legendTotal(rows)}`].join("\n");
}

/** `base` without a stroke colour (a typewriter has no frame; a cover no outline). */
function noStroke(base: MarkupBase): MarkupBase {
  const out = { ...base };
  delete out.color;
  return out;
}

export type ConvertContext = {
  calibration: AppCalibration | null;
  userUnit: number;
  author: string;
  images: ReadonlyMap<string, DecodedImage>;
  /** The document's markups (a legend counts them). */
  documentMarkups: readonly AppMarkup[];
};

/** One app markup as export markups (null: nothing to write, such as an image not decoded). */
export function exportMarkup(m: AppMarkup, ctx: ConvertContext): Markup | null {
  const u = ctx.userUnit > 0 ? ctx.userUnit : 1;
  const s: MarkupStyle = m.style;
  const base: MarkupBase = {
    id: m.id,
    subject: subjectOf(m),
    author: ctx.author,
    color: rgbOf(s.color),
    ...(s.fill ? { fill: rgbOf(s.fill) } : {}),
    ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}),
    width: s.width / u,
    ...(s.dash ? { dash: s.dash.map((d) => d / u) } : {}),
    ...(m.layerId ? { layer: m.layerId } : {}),
    ...(m.groupId ? { group: m.groupId } : {}),
  };
  const text = { fontSize: s.fontSize / u, textColor: rgbOf(s.color) };
  const value = captionText(m, ctx.calibration, u);
  const measured = value !== undefined ? { ...base, valueText: value } : base;
  const box = (points: readonly Point[]): Box => boundsOf(points);
  switch (m.type) {
    case "length":
      return { ...measured, type: "length", from: pt(m.points[0]), to: pt(m.points[1]) };
    case "polylength":
      return { ...measured, type: "polylength", points: m.points.map(pt) };
    case "area":
      return { ...measured, type: "area", points: m.points.map(pt) };
    case "count":
      return { ...measured, type: "count", points: m.points.map(pt) };
    case "angle":
      return { ...measured, type: "angle", a: pt(m.points[0]), vertex: pt(m.points[1]), b: pt(m.points[2]) };
    case "radius":
    case "diameter": {
      const c = circleThrough(m.points[0], m.points[1], m.points[2]);
      if (!c) return null;
      const angleDeg = (Math.atan2(m.points[0].y - c.centre.y, m.points[0].x - c.centre.x) * 180) / Math.PI;
      return { ...measured, type: m.type, center: pt(c.centre), radius: c.radius, angleDeg };
    }
    case "dimension": {
      const line = dimensionLine(m.points[0], m.points[1], m.points[2]);
      if (!line) return null;
      const dx = m.points[1].x - m.points[0].x;
      const dy = m.points[1].y - m.points[0].y;
      // /LL is positive counter-clockwise from the from→to direction (its left).
      const left = line.normal.x * -dy + line.normal.y * dx >= 0;
      return { ...measured, type: "dimension", from: pt(m.points[0]), to: pt(m.points[1]), leader: left ? line.offset : -line.offset, leaderExtension: 4 / u };
    }
    case "line":
      return { ...base, type: "line", from: pt(m.points[0]), to: pt(m.points[1]) };
    case "arrow":
      return { ...base, fill: rgbOf(s.color), type: "arrow", from: pt(m.points[0]), to: pt(m.points[1]), endings: ["None", "ClosedArrow"] };
    case "polyline":
      return { ...base, type: "polyline", points: m.points.map(pt) };
    case "polygon":
      return { ...base, type: "polygon", points: m.points.map(pt) };
    // An arc goes out as a polyline along it (PDF has no arc annotation).
    case "arc":
      return { ...base, type: "polyline", points: arcPoints(m.points[0], m.points[1], m.points[2]).map(pt) };
    case "rectangle":
      return axisAligned(m.points) ? { ...base, type: "rectangle", rect: box(m.points) } : { ...base, type: "polygon", points: m.points.map(pt) };
    case "ellipse":
      return axisAligned(m.points) ? { ...base, type: "ellipse", rect: box(m.points) } : { ...base, type: "polygon", points: ellipseOutline(ellipseFrame(m.points), 72).map(pt) };
    case "cloud":
      return { ...base, type: "cloud", points: m.points.map(pt), intensity: 1 };
    case "text":
      return { ...base, ...text, type: "textBox", rect: box(m.points), text: m.text };
    case "typewriter": {
      const [x0, , , y1] = box(m.points);
      return { ...noStroke(base), ...text, type: "typewriter", at: [x0, y1], text: m.text };
    }
    case "note":
      return { ...base, type: "note", at: pt(m.points[0]), text: m.text };
    case "callout": {
      const frame = m.points.slice(0, 4);
      const [side, tip] = leaderTo(frame, m.points[4]);
      return { ...base, ...text, type: "callout", textRect: box(frame), text: m.text, leader: [pt(tip), pt(side)] };
    }
    case "cloudplus": {
      const frame = m.points.slice(-4);
      const ring = cloudRingOf(m);
      const [side, corner] = leaderToRing(frame, ring);
      return { ...base, ...text, type: "cloudPlus", points: ring.map(pt), intensity: 1, textRect: box(frame), text: m.text, leader: [pt(corner), pt(side)] };
    }
    case "pen":
    case "highlight":
      return { ...base, type: "pen", strokes: [m.points.map(pt)] };
    case "eraser":
      return { ...base, color: [1, 1, 1], type: "pen", strokes: [m.points.map(pt)] };
    case "whiteout": {
      const rest = noStroke(base);
      if (m.points.length === 4 && axisAligned(m.points)) return { ...rest, fill: [1, 1, 1], type: "whiteout", rect: box(m.points) };
      return { ...rest, fill: [1, 1, 1], width: 0, type: "polygon", points: m.points.map(pt) };
    }
    case "underline":
    case "strikethrough": {
      const quads: Box[] = [];
      for (let i = 0; i + 3 < m.points.length; i += 4) quads.push(box(m.points.slice(i, i + 4)));
      return { ...base, type: m.type === "underline" ? "underline" : "strikeout", quads };
    }
    case "image": {
      const image = ctx.images.get(m.id);
      if (!image) return null;
      return { ...base, type: "imageStamp", rect: box(m.points), image };
    }
    case "revision": {
      const t = revisionText(m.revision);
      return { ...base, ...text, type: "textBox", rect: box(m.points), text: [`${t.left} · ${t.right}`, ...t.lines].join("\n") };
    }
    case "legend": {
      const rows = legendRows(legendScopeMarkups(ctx.documentMarkups, m.legend.scope, m.pageId));
      return { ...base, ...text, type: "textBox", rect: box(m.points), text: legendText(m.legend.title, rows) };
    }
    // Story 9.2: a 4541 zone is design data, never written to the PDF.
    case "zone":
      return null;
  }
}

/** The types written then flattened into the page (covers, A5). */
export function isCover(m: AppMarkup): boolean {
  return m.type === "whiteout" || m.type === "eraser";
}

export type JobInput = {
  /** The document's markups, in paint order. */
  markups: readonly AppMarkup[];
  layers: readonly AppLayer[];
  pages: readonly ExportPageInput[];
  author: string;
  images: ReadonlyMap<string, DecodedImage>;
  /** Markups on hidden layers are written too (on layers that start hidden). */
  includeHidden: boolean;
};

/** The export job: the chosen pages' markups (those on hidden layers left out unless chosen), converted. */
export function exportJob(input: JobInput): ExportJob {
  const hidden = new Set(input.layers.filter((l) => l.hidden).map((l) => l.id));
  const shown = (m: AppMarkup) => input.includeHidden || !m.layerId || !hidden.has(m.layerId);
  const known = new Set(input.layers.map((l) => l.id));
  const written = input.markups.filter((m) => shown(m));
  const used = new Set(written.flatMap((m) => (m.layerId && known.has(m.layerId) ? [m.layerId] : [])));
  const layers: Layer[] = input.layers.filter((l) => used.has(l.id)).map((l) => ({ id: l.id, name: l.name, visible: !l.hidden }));
  const pages = input.pages.map((page) => {
    const ctx: ConvertContext = { calibration: page.calibration, userUnit: page.userUnit, author: input.author, images: input.images, documentMarkups: input.markups };
    const markups: Markup[] = [];
    const flatten: string[] = [];
    for (const m of written) {
      if (m.pageId !== page.pageId) continue;
      const out = exportMarkup(m, ctx);
      if (!out) continue;
      // A layer no longer in the list: written without one.
      if (out.layer && !known.has(out.layer)) delete out.layer;
      markups.push(out);
      if (isCover(m)) flatten.push(m.id);
    }
    return { pageIndex: page.pageIndex, model: { calibration: exportCalibration(page.calibration, page.userUnit), layers, markups }, flatten };
  });
  return { layers, pages };
}

/** The pages the job writes markups on. */
export function markedPages(job: ExportJob): number {
  return job.pages.filter((p) => p.model.markups.length > 0).length;
}
