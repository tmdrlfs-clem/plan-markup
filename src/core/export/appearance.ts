// Appearance streams (/AP /N) for every export markup type (framework-free).
// We always write appearances ourselves: viewers differ in whether and how
// they regenerate them, and the flattened export draws these same forms.
//
// Each form is in page user space: BBox = the annotation /Rect, identity
// Matrix, so the flattener and every viewer place it 1:1.

import {
  colorOp,
  ellipsePath,
  fmt,
  KAPPA,
  lineEnding,
  literalText,
  nums,
  type Box,
  type Pt,
} from "../pdf/content";
import type { ExtGStateResource, FormContent, ImageResource } from "../pdf/form";
import { HELVETICA_ASCENT, HELVETICA_DESCENT, helveticaWidth } from "../pdf/helvetica";
import { measureValue, polygonCentroid } from "./measure";
import type { Calibration, LineEndingStyle, Markup, Rgb } from "./model";

export const FONT_NAME = "Helv";
/** Label size for measurement captions, in pt. */
export const LABEL_SIZE = 7;
/** Size of a note icon, in pt. */
export const NOTE_SIZE = 20;
/** Fill opacity of area and dynamic-fill measurements. */
export const AREA_FILL_OPACITY = 0.35;
/** Padding added around the drawn geometry (beyond half the stroke width). */
const PAD = 1;

// ---------------------------------------------------------------- builder

/** Accumulates operators, resources and the bounds of everything drawn. */
export class ApBuilder {
  private readonly ops: string[] = [];
  private readonly fonts: Record<string, string> = {};
  private readonly extGStates: Record<string, ExtGStateResource> = {};
  private readonly images: Record<string, ImageResource> = {};
  private bounds: Box | undefined;

  push(...ops: string[]): void {
    this.ops.push(...ops);
  }

  include(p: Pt, pad = 0): void {
    const b: Box = [p[0] - pad, p[1] - pad, p[0] + pad, p[1] + pad];
    this.bounds = this.bounds
      ? [Math.min(this.bounds[0], b[0]), Math.min(this.bounds[1], b[1]), Math.max(this.bounds[2], b[2]), Math.max(this.bounds[3], b[3])]
      : b;
  }

  includeBox(box: Box, pad = 0): void {
    this.include([box[0], box[1]], pad);
    this.include([box[2], box[3]], pad);
  }

  /** Adds an ExtGState and selects it. */
  gs(state: ExtGStateResource): void {
    const n = `GS${Object.keys(this.extGStates).length}`;
    this.extGStates[n] = state;
    this.push(`/${n} gs`);
  }

  image(img: ImageResource): string {
    const n = `Im${Object.keys(this.images).length}`;
    this.images[n] = img;
    return n;
  }

  font(): string {
    this.fonts[FONT_NAME] = "Helvetica";
    return FONT_NAME;
  }

  /** The bounds of everything included so far, or undefined. */
  currentBounds(): Box | undefined {
    return this.bounds;
  }

  /** Finishes the form; `rect` overrides the computed bounds (e.g. a text box). */
  finish(rect?: Box): FormContent {
    const bbox = rect ?? this.bounds;
    if (!bbox) throw new Error("Appearance has no geometry");
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const box: Box = rect ? rect : [r(bbox[0] - PAD), r(bbox[1] - PAD), r(bbox[2] + PAD), r(bbox[3] + PAD)];
    return {
      bbox: box,
      content: this.ops.join("\n") + "\n",
      fonts: this.fonts,
      extGStates: this.extGStates,
      images: this.images,
    };
  }
}

// ---------------------------------------------------------------- primitives

type Stroke = { color: Rgb | undefined; width: number; dash: number[] | undefined };

function strokeOf(m: Markup): Stroke {
  return { color: m.color, width: m.width ?? 1, dash: m.dash };
}

function opacity(ap: ApBuilder, m: Markup): void {
  if (m.opacity !== undefined && m.opacity < 1) ap.gs({ CA: m.opacity, ca: m.opacity });
}

function setStroke(ap: ApBuilder, s: Stroke, round = false): boolean {
  if (!s.color || s.width <= 0) return false;
  ap.push(colorOp(s.color, true)!, `${fmt(s.width)} w`);
  if (s.dash && s.dash.length > 0) ap.push(`[${nums(...s.dash)}] 0 d`);
  if (round) ap.push("1 J 1 j");
  return true;
}

function pathOps(pts: Pt[], close: boolean): string {
  const lines = pts.map((p, i) => `${nums(p[0], p[1])} ${i === 0 ? "m" : "l"}`);
  if (close) lines.push("h");
  return lines.join("\n");
}

function includeAll(ap: ApBuilder, pts: Pt[], pad: number): void {
  for (const p of pts) ap.include(p, pad);
}

function paint(fill: boolean, stroke: boolean): string {
  if (fill && stroke) return "B";
  if (fill) return "f";
  if (stroke) return "S";
  return "n";
}

/** Draws the two line endings of an open path (solid even when the line is dashed). */
function endings(ap: ApBuilder, pts: Pt[], styles: [LineEndingStyle, LineEndingStyle], s: Stroke, fill: Rgb | undefined): void {
  if (pts.length < 2 || !s.color) return;
  const ends: Array<[string, Pt, Pt]> = [
    [styles[0], pts[0]!, pts[1]!],
    [styles[1], pts[pts.length - 1]!, pts[pts.length - 2]!],
  ];
  let reset = false;
  for (const [style, tip, from] of ends) {
    const e = lineEnding(style, tip, from, s.width);
    if (!e) continue;
    if (s.dash && !reset) {
      ap.push("[] 0 d");
      reset = true;
    }
    includeAll(ap, e.points, s.width);
    const f = fill ?? s.color;
    if (e.closed) ap.push(colorOp(f, false)!, e.ops, "B");
    else ap.push(e.ops, "S");
  }
}

/**
 * Text at (x, y) = left end of the baseline, rotated by `angle` radians about
 * that point. Includes the rotated text box in the bounds.
 */
function textAt(ap: ApBuilder, str: string, x: number, y: number, size: number, color: Rgb, angle = 0): void {
  const font = ap.font();
  const w = helveticaWidth(str, size);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lo = (HELVETICA_DESCENT / 1000) * size;
  const hi = (HELVETICA_ASCENT / 1000) * size;
  for (const [dx, dy] of [
    [0, lo],
    [w, lo],
    [w, hi],
    [0, hi],
  ] as Pt[]) {
    ap.include([x + dx * cos - dy * sin, y + dx * sin + dy * cos]);
  }
  ap.push("BT", colorOp(color, false)!, `/${font} ${fmt(size)} Tf`, `${nums(cos, sin, -sin, cos, x, y)} Tm`, `(${literalText(str)}) Tj`, "ET");
}

/** Text centred on `c` (both axes), rotated by `angle`. */
function textCentered(ap: ApBuilder, str: string, c: Pt, size: number, color: Rgb, angle = 0): void {
  const w = helveticaWidth(str, size);
  const midY = ((HELVETICA_ASCENT + HELVETICA_DESCENT) / 2000) * size;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Origin = centre − rotate(w/2, midY).
  const x = c[0] - ((w / 2) * cos - midY * sin);
  const y = c[1] - ((w / 2) * sin + midY * cos);
  textAt(ap, str, x, y, size, color, angle);
}

/** Readable angle for a label along a segment (never upside down). */
function labelAngle(a: Pt, b: Pt): number {
  let t = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (t > Math.PI / 2) t -= Math.PI;
  if (t < -Math.PI / 2) t += Math.PI;
  return t;
}

/** Caption above the middle of segment a→b (left side when reading). */
function segmentCaption(ap: ApBuilder, str: string, a: Pt, b: Pt, color: Rgb, gap = 3): void {
  const t = labelAngle(a, b);
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const off = gap + (LABEL_SIZE * 0.5);
  textCentered(ap, str, [mid[0] - Math.sin(t) * off, mid[1] + Math.cos(t) * off], LABEL_SIZE, color, t);
}

/** Bézier ops for a circular arc (counter-clockwise from startDeg by sweepDeg), without the moveto. */
export function arcBeziers(center: Pt, radius: number, startDeg: number, sweepDeg: number): { start: Pt; curves: Array<[Pt, Pt, Pt]> } {
  const segs = Math.max(1, Math.ceil(Math.abs(sweepDeg) / 90));
  const step = ((sweepDeg / segs) * Math.PI) / 180;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (a: number): Pt => [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)];
  let a0 = (startDeg * Math.PI) / 180;
  const start = at(a0);
  const curves: Array<[Pt, Pt, Pt]> = [];
  for (let i = 0; i < segs; i++) {
    const a1 = a0 + step;
    const p0 = at(a0);
    const p3 = at(a1);
    const c1: Pt = [p0[0] - k * radius * Math.sin(a0), p0[1] + k * radius * Math.cos(a0)];
    const c2: Pt = [p3[0] + k * radius * Math.sin(a1), p3[1] - k * radius * Math.cos(a1)];
    curves.push([c1, c2, p3]);
    a0 = a1;
  }
  return { start, curves };
}

/** Vertices that approximate an arc (for /Vertices), one every `stepDeg`. */
export function arcVertices(center: Pt, radius: number, startDeg: number, sweepDeg: number, stepDeg = 10): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweepDeg) / stepDeg) + 1);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (sweepDeg * i) / (n - 1)) * Math.PI) / 180;
    out.push([center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)]);
  }
  return out;
}

function signedArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Scallop radius of a cloud border for an /BE /I intensity (0..2). */
export function cloudRadius(intensity: number): number {
  return 4 + 3 * Math.max(0, Math.min(2, intensity));
}

/**
 * Cloud border path: each polygon edge is split into bumps that bulge
 * outwards (half circles approximated by one cubic each). Returns the path
 * ops and every control point (for bounds).
 */
export function cloudPath(points: Pt[], intensity: number): { ops: string; controls: Pt[] } {
  const r = cloudRadius(intensity);
  const ccw = signedArea(points) > 0;
  const out: string[] = [];
  const controls: Pt[] = [];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) return;
    const n = Math.max(1, Math.round(len / (2 * r)));
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    // Outward normal: right of the direction for a counter-clockwise ring.
    const nx = ccw ? uy : -uy;
    const ny = ccw ? -ux : ux;
    const step = len / n;
    const h = (2 / 3) * step; // cubic control height ≈ a half circle of diameter `step`
    for (let j = 0; j < n; j++) {
      const p0: Pt = [a[0] + ux * step * j, a[1] + uy * step * j];
      const p3: Pt = [a[0] + ux * step * (j + 1), a[1] + uy * step * (j + 1)];
      const c1: Pt = [p0[0] + nx * h, p0[1] + ny * h];
      const c2: Pt = [p3[0] + nx * h, p3[1] + ny * h];
      if (out.length === 0) out.push(`${nums(p0[0], p0[1])} m`);
      out.push(`${nums(c1[0], c1[1], c2[0], c2[1], p3[0], p3[1])} c`);
      controls.push(p0, c1, c2, p3);
    }
  });
  out.push("h");
  return { ops: out.join("\n"), controls };
}

// ---------------------------------------------------------------- text boxes

export type TextLayout = { lines: string[]; size: number; lineHeight: number; margin: number };

export function layoutText(str: string, size: number): TextLayout {
  return { lines: str.split(/\r\n|\r|\n/), size, lineHeight: size * 1.2, margin: 3 };
}

/** Width/height a text needs at `size` with the standard margin. */
export function textBlockSize(str: string, size: number): [number, number] {
  const l = layoutText(str, size);
  const w = Math.max(...l.lines.map((s) => helveticaWidth(s, size)));
  return [w + 2 * l.margin, l.lines.length * l.lineHeight + 2 * l.margin - (l.lineHeight - size)];
}

function textBlock(ap: ApBuilder, box: Box, str: string, size: number, color: Rgb): void {
  const l = layoutText(str, size);
  ap.push("q", `${nums(box[0], box[1], box[2] - box[0], box[3] - box[1])} re W n`);
  let y = box[3] - l.margin - (HELVETICA_ASCENT / 1000) * size;
  for (const line of l.lines) {
    textAt(ap, line, box[0] + l.margin, y, size, color);
    y -= l.lineHeight;
  }
  ap.push("Q");
}

function frame(ap: ApBuilder, box: Box, s: Stroke, fill: Rgb | undefined): void {
  const stroke = setStroke(ap, s);
  if (fill) ap.push(colorOp(fill, false)!);
  if (stroke || fill) {
    const h = stroke ? s.width / 2 : 0;
    ap.push(`${nums(box[0] + h, box[1] + h, box[2] - box[0] - 2 * h, box[3] - box[1] - 2 * h)} re`, paint(!!fill, stroke));
  }
  ap.includeBox(box);
}

// ---------------------------------------------------------------- markup types

export type MarkupAppearance = {
  form: FormContent;
  /** Extra appearances for markups written as several annotations (cloud+). */
  extra?: FormContent[];
  /** Inset of the drawn shape from /Rect, for /RD (left, top, right, bottom). */
  rd?: [number, number, number, number];
};

function shape(ap: ApBuilder, m: Markup, box: Box, circle: boolean): MarkupAppearance {
  const s = strokeOf(m);
  opacity(ap, m);
  const stroke = setStroke(ap, s);
  if (m.fill) ap.push(colorOp(m.fill, false)!);
  ap.push(circle ? ellipsePath(box[0], box[1], box[2], box[3]) : `${nums(box[0], box[1], box[2] - box[0], box[3] - box[1])} re`, paint(!!m.fill, stroke));
  const half = stroke ? s.width / 2 : 0;
  ap.includeBox(box, half);
  const form = ap.finish();
  const b = form.bbox;
  return { form, rd: [box[0] - b[0], b[3] - box[3], b[2] - box[2], box[1] - b[1]] };
}

function openPath(ap: ApBuilder, m: Markup, pts: Pt[], ends: [LineEndingStyle, LineEndingStyle] = ["None", "None"]): void {
  const s = strokeOf(m);
  opacity(ap, m);
  if (setStroke(ap, s)) {
    ap.push(pathOps(pts, false), "S");
    endings(ap, pts, ends, s, m.fill);
  }
  includeAll(ap, pts, s.width / 2);
}

function closedPath(ap: ApBuilder, m: Markup, pts: Pt[], fillOpacity?: number): void {
  const s = strokeOf(m);
  opacity(ap, m);
  if (m.fill) {
    ap.push("q");
    if (fillOpacity !== undefined) ap.gs({ ca: fillOpacity });
    ap.push(colorOp(m.fill, false)!, pathOps(pts, true), "f", "Q");
  }
  if (setStroke(ap, s)) ap.push(pathOps(pts, true), "S");
  includeAll(ap, pts, s.width / 2);
}

function checkMark(ap: ApBuilder, p: Pt, size: number): void {
  const pts: Pt[] = [
    [p[0] - size, p[1]],
    [p[0] - size * 0.3, p[1] - size * 0.7],
    [p[0] + size, p[1] + size * 0.8],
  ];
  ap.push(pathOps(pts, false), "S");
  includeAll(ap, pts, 2);
}

function noteIcon(ap: ApBuilder, at: Pt): void {
  const [x, y] = at;
  const s = NOTE_SIZE;
  ap.push("1 0.85 0.2 rg", "0.4 0.3 0 RG", "1 w", "1 j");
  ap.push(pathOps([
    [x + 1, y + 6],
    [x + 1, y + s - 1],
    [x + s - 1, y + s - 1],
    [x + s - 1, y + 6],
    [x + 8, y + 6],
    [x + 4, y + 1],
    [x + 5, y + 6],
  ], true), "B");
  ap.push("0.4 0.3 0 RG", "0.8 w");
  for (const dy of [14, 11, 8.5]) ap.push(`${nums(x + 4, y + dy)} m ${nums(x + s - 4, y + dy)} l S`);
  ap.includeBox([x, y, x + s, y + s]);
}

function approvedStamp(ap: ApBuilder, m: Markup & { rect: Box; label: string }): void {
  const [x0, y0, x1, y1] = m.rect;
  const color = m.color ?? [0.75, 0.1, 0.1];
  opacity(ap, m);
  const r = 4;
  const w = 2;
  ap.push(colorOp(color, true)!, `${fmt(w)} w`);
  // Rounded rectangle.
  const k = r * KAPPA;
  const a = x0 + w / 2;
  const b = y0 + w / 2;
  const c = x1 - w / 2;
  const d = y1 - w / 2;
  ap.push(
    [
      `${nums(a + r, b)} m`,
      `${nums(c - r, b)} l`,
      `${nums(c - r + k, b, c, b + r - k, c, b + r)} c`,
      `${nums(c, d - r)} l`,
      `${nums(c, d - r + k, c - r + k, d, c - r, d)} c`,
      `${nums(a + r, d)} l`,
      `${nums(a + r - k, d, a, d - r + k, a, d - r)} c`,
      `${nums(a, b + r)} l`,
      `${nums(a, b + r - k, a + r - k, b, a + r, b)} c`,
      "h S",
    ].join("\n"),
  );
  const size = Math.min((y1 - y0) * 0.5, ((x1 - x0) * 0.85 * 1000) / Math.max(1, helveticaWidth(m.label, 1000)));
  textCentered(ap, m.label, [(x0 + x1) / 2, (y0 + y1) / 2], size, color);
  ap.includeBox(m.rect);
}

function flagIcon(ap: ApBuilder, m: Markup & { rect: Box }): void {
  const [x0, y0, x1, y1] = m.rect;
  const pole = x0 + (x1 - x0) * 0.15;
  ap.push("0.2 0.2 0.2 RG", "1.5 w", `${nums(pole, y0)} m ${nums(pole, y1)} l S`);
  ap.push(colorOp(m.fill ?? [0.9, 0.2, 0.1], false)!, colorOp(m.color ?? [0.5, 0.05, 0.05], true)!, "0.8 w");
  ap.push(pathOps([
    [pole, y1],
    [x1, y1 - (y1 - y0) * 0.25],
    [pole, y1 - (y1 - y0) * 0.5],
  ], true), "B");
  ap.includeBox(m.rect);
}

function sprinklerIcon(ap: ApBuilder, m: Markup & { center: Pt; size: number }): void {
  const [cx, cy] = m.center;
  const r = m.size / 2;
  ap.push(colorOp(m.fill ?? [0.85, 0.1, 0.1], false)!, colorOp(m.color ?? [0, 0, 0], true)!, "0.8 w");
  ap.push(ellipsePath(cx - r, cy - r, cx + r, cy + r), "B");
  const d = r * 0.7071;
  ap.push("1 1 1 RG", "0.8 w", `${nums(cx - d, cy - d)} m ${nums(cx + d, cy + d)} l S`, `${nums(cx - d, cy + d)} m ${nums(cx + d, cy - d)} l S`);
  ap.includeBox([cx - r, cy - r, cx + r, cy + r], 0.4);
}

function quadAppearance(ap: ApBuilder, m: Markup & { type: "highlight" | "underline" | "strikeout"; quads: Box[] }): void {
  const color = m.color ?? [1, 1, 0];
  if (m.type === "highlight") {
    ap.gs({ BM: "Multiply", ...(m.opacity !== undefined && m.opacity < 1 ? { ca: m.opacity, CA: m.opacity } : {}) });
    ap.push(colorOp(color, false)!);
    for (const q of m.quads) {
      ap.push(`${nums(q[0], q[1], q[2] - q[0], q[3] - q[1])} re f`);
      ap.includeBox(q);
    }
    return;
  }
  opacity(ap, m);
  for (const q of m.quads) {
    const h = q[3] - q[1];
    const w = Math.max(0.5, h / 14);
    // Underline sits just above the quad bottom; strike-out at the middle of the x-height.
    const y = m.type === "underline" ? q[1] + w / 2 + h * 0.05 : q[1] + h * 0.42;
    ap.push(colorOp(color, true)!, `${fmt(w)} w`, `${nums(q[0], y)} m ${nums(q[2], y)} l S`);
    ap.includeBox(q);
  }
}

function dimensionLines(m: Markup & { from: Pt; to: Pt; leader: number; leaderExtension: number }): { a: Pt; b: Pt; leaders: Array<[Pt, Pt]> } {
  const dx = m.to[0] - m.from[0];
  const dy = m.to[1] - m.from[1];
  const len = Math.hypot(dx, dy) || 1;
  // Leader lines run counter-clockwise from the start→end direction for a positive /LL (ISO 32000 12.5.6.7).
  const nx = -dy / len;
  const ny = dx / len;
  const a: Pt = [m.from[0] + nx * m.leader, m.from[1] + ny * m.leader];
  const b: Pt = [m.to[0] + nx * m.leader, m.to[1] + ny * m.leader];
  const ext = m.leaderExtension * Math.sign(m.leader || 1);
  const leaders: Array<[Pt, Pt]> = [
    [m.from, [a[0] + nx * ext, a[1] + ny * ext]],
    [m.to, [b[0] + nx * ext, b[1] + ny * ext]],
  ];
  return { a, b, leaders };
}

/** Builds the normal appearance of a markup. */
export function markupAppearance(m: Markup, cal: Calibration): MarkupAppearance {
  const ap = new ApBuilder();
  const value = measureValue(m, cal);
  const labelColor: Rgb = m.color ?? [0, 0, 0];
  switch (m.type) {
    case "line":
      openPath(ap, m, [m.from, m.to]);
      return { form: ap.finish() };
    case "arrow":
      openPath(ap, m, [m.from, m.to], m.endings);
      return { form: ap.finish() };
    case "polyline":
      openPath(ap, m, m.points);
      return { form: ap.finish() };
    case "polygon":
      closedPath(ap, m, m.points);
      return { form: ap.finish() };
    case "rectangle":
    case "whiteout":
      return shape(ap, m, m.rect, false);
    case "ellipse":
      return shape(ap, m, m.rect, true);
    case "arc": {
      const s = strokeOf(m);
      opacity(ap, m);
      const { start, curves } = arcBeziers(m.center, m.radius, m.startDeg, m.sweepDeg);
      if (setStroke(ap, s)) {
        ap.push(`${nums(start[0], start[1])} m`, ...curves.map(([c1, c2, p]) => `${nums(c1[0], c1[1], c2[0], c2[1], p[0], p[1])} c`), "S");
      }
      includeAll(ap, arcVertices(m.center, m.radius, m.startDeg, m.sweepDeg, 2), s.width / 2);
      return { form: ap.finish() };
    }
    case "cloud":
    case "cloudPlus": {
      const s = strokeOf(m);
      opacity(ap, m);
      const cloud = cloudPath(m.points, m.intensity);
      const stroke = setStroke(ap, s, true);
      if (m.fill) ap.push(colorOp(m.fill, false)!);
      ap.push(cloud.ops, paint(!!m.fill, stroke));
      includeAll(ap, cloud.controls, s.width / 2);
      const form = ap.finish();
      if (m.type === "cloud") return { form };
      return { form, extra: [calloutAppearance(m, m.textRect, m.leader).form] };
    }
    case "callout":
      return calloutAppearance(m, m.textRect, m.leader);
    case "textBox": {
      opacity(ap, m);
      frame(ap, m.rect, strokeOf(m), m.fill);
      textBlock(ap, m.rect, m.text, m.fontSize, m.textColor);
      return { form: ap.finish(m.rect) };
    }
    case "typewriter": {
      const [w, h] = textBlockSize(m.text, m.fontSize);
      const rect: Box = [m.at[0], m.at[1] - h, m.at[0] + w, m.at[1]];
      opacity(ap, m);
      textBlock(ap, rect, m.text, m.fontSize, m.textColor);
      return { form: ap.finish(rect) };
    }
    case "note":
      noteIcon(ap, m.at);
      return { form: ap.finish([m.at[0], m.at[1], m.at[0] + NOTE_SIZE, m.at[1] + NOTE_SIZE]) };
    case "highlight":
    case "underline":
    case "strikeout":
      quadAppearance(ap, m);
      return { form: ap.finish() };
    case "pen": {
      const s = strokeOf(m);
      opacity(ap, m);
      if (setStroke(ap, s, true)) {
        for (const stroke of m.strokes) ap.push(pathOps(stroke, false), "S");
      }
      for (const stroke of m.strokes) includeAll(ap, stroke, s.width / 2);
      return { form: ap.finish() };
    }
    case "stamp":
      approvedStamp(ap, m);
      return { form: ap.finish(m.rect) };
    case "imageStamp": {
      opacity(ap, m);
      const n = ap.image(m.image);
      const [x0, y0, x1, y1] = m.rect;
      ap.push("q", `${nums(x1 - x0, 0, 0, y1 - y0, x0, y0)} cm`, `/${n} Do`, "Q");
      ap.includeBox(m.rect);
      return { form: ap.finish(m.rect) };
    }
    case "flag":
      flagIcon(ap, m);
      return { form: ap.finish(m.rect) };
    case "deviceStamp":
      sprinklerIcon(ap, m);
      return { form: ap.finish() };
    case "hyperlink": {
      const s: Stroke = { color: m.color ?? [0, 0, 1], width: m.width ?? 1, dash: m.dash ?? [3, 2] };
      frame(ap, m.rect, s, undefined);
      return { form: ap.finish(m.rect) };
    }
    case "length": {
      const s = strokeOf(m);
      openPath(ap, m, [m.from, m.to], ["Butt", "Butt"]);
      if (value) segmentCaption(ap, value.text, m.from, m.to, labelColor, s.width + 3);
      return { form: ap.finish() };
    }
    case "dimension": {
      const s = strokeOf(m);
      const { a, b, leaders } = dimensionLines(m);
      opacity(ap, m);
      if (setStroke(ap, s)) {
        for (const [p, q] of leaders) ap.push(pathOps([p, q], false), "S");
        ap.push(pathOps([a, b], false), "S");
        endings(ap, [a, b], ["ClosedArrow", "ClosedArrow"], s, undefined);
      }
      for (const [p, q] of leaders) includeAll(ap, [p, q], s.width / 2);
      includeAll(ap, [a, b], s.width / 2);
      if (value) segmentCaption(ap, value.text, a, b, labelColor, 2);
      return { form: ap.finish() };
    }
    case "polylength": {
      openPath(ap, m, m.points);
      const n = m.points.length;
      if (value && n >= 2) segmentCaption(ap, value.text, m.points[n - 2]!, m.points[n - 1]!, labelColor, 3);
      return { form: ap.finish() };
    }
    case "perimeter": {
      openPath(ap, m, [...m.points, m.points[0]!]);
      if (value) textCentered(ap, value.text, polygonCentroid(m.points), LABEL_SIZE, labelColor);
      return { form: ap.finish() };
    }
    case "area":
    case "dynamicFill": {
      closedPath(ap, m, m.points, AREA_FILL_OPACITY);
      if (value) textCentered(ap, value.text, polygonCentroid(m.points), LABEL_SIZE, labelColor);
      return { form: ap.finish() };
    }
    case "count": {
      opacity(ap, m);
      ap.push(colorOp(m.color ?? [0, 0.5, 0], true)!, "1.5 w", "1 J 1 j");
      for (const p of m.points) checkMark(ap, p, 4);
      return { form: ap.finish() };
    }
    case "angle": {
      const s = strokeOf(m);
      openPath(ap, m, [m.a, m.vertex, m.b]);
      const r = Math.min(18, 0.5 * Math.hypot(m.a[0] - m.vertex[0], m.a[1] - m.vertex[1]), 0.5 * Math.hypot(m.b[0] - m.vertex[0], m.b[1] - m.vertex[1]));
      let t1 = (Math.atan2(m.a[1] - m.vertex[1], m.a[0] - m.vertex[0]) * 180) / Math.PI;
      let t2 = (Math.atan2(m.b[1] - m.vertex[1], m.b[0] - m.vertex[0]) * 180) / Math.PI;
      let sweep = t2 - t1;
      if (sweep > 180) sweep -= 360;
      if (sweep < -180) sweep += 360;
      if (setStroke(ap, { ...s, dash: undefined })) {
        const { start, curves } = arcBeziers(m.vertex, r, t1, sweep);
        ap.push(`${nums(start[0], start[1])} m`, ...curves.map(([c1, c2, p]) => `${nums(c1[0], c1[1], c2[0], c2[1], p[0], p[1])} c`), "S");
      }
      const mid = ((t1 + sweep / 2) * Math.PI) / 180;
      t1 = mid;
      t2 = r + LABEL_SIZE * 1.6;
      if (value) textCentered(ap, value.text, [m.vertex[0] + Math.cos(t1) * t2, m.vertex[1] + Math.sin(t1) * t2], LABEL_SIZE, labelColor);
      return { form: ap.finish() };
    }
    case "radius":
    case "diameter": {
      const s = strokeOf(m);
      const [cx, cy] = m.center;
      const box: Box = [cx - m.radius, cy - m.radius, cx + m.radius, cy + m.radius];
      opacity(ap, m);
      const t = (m.angleDeg * Math.PI) / 180;
      const edge: Pt = [cx + Math.cos(t) * m.radius, cy + Math.sin(t) * m.radius];
      const start: Pt = m.type === "radius" ? m.center : [cx - Math.cos(t) * m.radius, cy - Math.sin(t) * m.radius];
      if (setStroke(ap, s)) {
        ap.push(ellipsePath(box[0], box[1], box[2], box[3]), "S");
        ap.push(pathOps([start, edge], false), "S");
        endings(ap, [start, edge], [m.type === "radius" ? "None" : "ClosedArrow", "ClosedArrow"], s, undefined);
      }
      ap.includeBox(box, s.width / 2);
      if (value) segmentCaption(ap, value.text, m.type === "radius" ? start : m.center, edge, labelColor, 2);
      const form = ap.finish();
      const b = form.bbox;
      return { form, rd: [box[0] - b[0], b[3] - box[3], b[2] - box[2], box[1] - b[1]] };
    }
  }
}

function calloutAppearance(m: Markup & { fontSize: number; textColor: Rgb; text: string }, textRect: Box, leader: Pt[]): MarkupAppearance {
  const ap = new ApBuilder();
  const s = strokeOf(m);
  opacity(ap, m);
  if (setStroke(ap, s)) {
    ap.push(pathOps(leader, false), "S");
    // The arrow points at the first leader point (the annotated object).
    endings(ap, leader, ["OpenArrow", "None"], s, undefined);
  }
  includeAll(ap, leader, s.width / 2);
  frame(ap, textRect, s, m.type === "cloudPlus" ? [1, 1, 1] : m.fill);
  textBlock(ap, textRect, m.text, m.fontSize, m.textColor);
  const form = ap.finish();
  const b = form.bbox;
  return { form, rd: [textRect[0] - b[0], b[3] - textRect[3], b[2] - textRect[2], textRect[1] - b[1]] };
}
