// Appearance streams for .btx annotations that carry no /AP (framework-free).
// Revu stores Circle, Square (incl. image squares), Line, PolyLine, Polygon,
// Ink and FreeText markups as bare dictionaries; we draw them ourselves from
// the dictionary instead of relying on a viewer's fallback, so every viewer
// (pdf.js today, our own renderer later) shows the same thing.
//
// The stream is in the annotation's own coordinates: BBox = /Rect, identity
// Matrix. Operators only; resources are returned by name for the caller to
// wire up (ExtGState, image XObject, standard-14 font).

import {
  colorOp,
  ellipsePath,
  fmt,
  lineEnding,
  literalText,
  normalizeRect,
  nums,
  type Box,
  type Pt,
} from "../pdf/content";
import {
  dictGet,
  getDict,
  getName,
  getNumber,
  getNumbers,
  getText,
  isRef,
  type PdfDict,
} from "./pdf-object";

export type { Box } from "../pdf/content";
export { colorOp, ellipsePath, fmt, lineEnding, literalText, normalizeRect } from "../pdf/content";

export type GeneratedAppearance = {
  bbox: Box;
  content: string;
  extGStates: Record<string, { CA?: number; ca?: number }>;
  /** Name → BBObjPtr id of an image XObject. */
  xObjects: Record<string, string>;
  /** Name → standard-14 base font. */
  fonts: Record<string, string>;
};

export const GENERATED_SUBTYPES = new Set([
  "Square",
  "Circle",
  "Line",
  "PolyLine",
  "Polygon",
  "Ink",
  "FreeText",
]);

/** True when the dictionary has a usable normal appearance (/AP /N). */
export function hasAppearance(dict: PdfDict): boolean {
  const ap = getDict(dict, "AP");
  if (!ap) return false;
  const n = dictGet(ap, "N");
  return n !== undefined && n !== null;
}

type Border = { width: number; dash: number[] | undefined };

/** Border width (/BS /W, else /Border[2], default 1) and dash pattern. */
export function borderOf(dict: PdfDict): Border {
  const bs = getDict(dict, "BS");
  let width = 1;
  let dash: number[] | undefined;
  if (bs) {
    width = getNumber(bs, "W") ?? 1;
    if (getName(bs, "S") === "D") dash = getNumbers(bs, "D") ?? [3];
  } else {
    const border = dictGet(dict, "Border");
    if (Array.isArray(border) && typeof border[2] === "number") {
      width = border[2];
      if (Array.isArray(border[3]) && border[3].every((x) => typeof x === "number")) dash = border[3] as number[];
    }
  }
  if (!(width >= 0)) width = 1;
  return { width, dash };
}

// ---------------------------------------------------------------- builder

class Ops {
  readonly lines: string[] = [];
  readonly extGStates: GeneratedAppearance["extGStates"] = {};
  readonly xObjects: Record<string, string> = {};
  readonly fonts: Record<string, string> = {};

  push(s: string): void {
    this.lines.push(s);
  }

  /** Applies stroke/fill opacity via an ExtGState when below 1. */
  opacity(dict: PdfDict): void {
    const ca = getNumber(dict, "CA");
    const fillOpacity = getNumber(dict, "FillOpacity");
    const state: { CA?: number; ca?: number } = {};
    if (ca !== undefined && ca < 1) {
      state.CA = ca;
      state.ca = ca;
    }
    if (fillOpacity !== undefined && fillOpacity < 1) state.ca = (state.ca ?? 1) * fillOpacity;
    if (state.CA !== undefined || state.ca !== undefined) {
      this.extGStates.GS0 = state;
      this.push("/GS0 gs");
    }
  }

  strokeSetup(border: Border, round = false): void {
    this.push(`${fmt(border.width)} w`);
    if (border.dash && border.dash.length > 0) this.push(`[${nums(...border.dash)}] 0 d`);
    if (round) this.push("1 J 1 j");
  }

  result(bbox: Box): GeneratedAppearance {
    return {
      bbox,
      content: this.lines.join("\n") + "\n",
      extGStates: this.extGStates,
      xObjects: this.xObjects,
      fonts: this.fonts,
    };
  }
}

/** Paint operator for the current path. */
function paintOp(fill: boolean, stroke: boolean): string {
  if (fill && stroke) return "B";
  if (fill) return "f";
  if (stroke) return "S";
  return "n";
}

function shapeAppearance(dict: PdfDict, rect: Box, circle: boolean): GeneratedAppearance {
  const ops = new Ops();
  const border = borderOf(dict);
  const strokeColor = colorOp(getNumbers(dict, "C"), true);
  const fillColor = colorOp(getNumbers(dict, "IC"), false);
  const stroke = strokeColor !== undefined && border.width > 0;
  const rd = getNumbers(dict, "RD");
  // RD = [left top right bottom] inset of the shape from /Rect (the stroke
  // centre line); default: half the border width.
  const half = border.width / 2;
  const [l, t, r, b] = rd && rd.length === 4 ? (rd as [number, number, number, number]) : [half, half, half, half];
  const x0 = rect[0] + l;
  const y0 = rect[1] + b;
  const x1 = rect[2] - r;
  const y1 = rect[3] - t;
  ops.opacity(dict);

  const image = dictGet(dict, "Image");
  if (!circle && isRef(image)) {
    ops.xObjects.Im0 = image.ref;
    ops.push("q");
    ops.push(`${nums(x1 - x0, 0, 0, y1 - y0, x0, y0)} cm`);
    ops.push("/Im0 Do");
    ops.push("Q");
    if (stroke) {
      ops.push(strokeColor!);
      ops.strokeSetup(border);
      ops.push(`${nums(x0, y0, x1 - x0, y1 - y0)} re`);
      ops.push("S");
    }
    return ops.result(rect);
  }

  const fill = fillColor !== undefined;
  if (!fill && !stroke) return ops.result(rect);
  if (fill) ops.push(fillColor!);
  if (stroke) {
    ops.push(strokeColor!);
    ops.strokeSetup(border);
  }
  ops.push(circle ? ellipsePath(x0, y0, x1, y1) : `${nums(x0, y0, x1 - x0, y1 - y0)} re`);
  ops.push(paintOp(fill, stroke));
  return ops.result(rect);
}

function pointsOf(flat: number[]): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push([flat[i]!, flat[i + 1]!]);
  return pts;
}

function lineEndingNames(dict: PdfDict): [string, string] {
  const le = dictGet(dict, "LE");
  if (Array.isArray(le)) {
    const n = (o: unknown) =>
      typeof o === "object" && o !== null && (o as { kind?: string }).kind === "name" ? (o as { value: string }).value : "None";
    return [n(le[0]), n(le[1])];
  }
  return ["None", "None"];
}

function polyAppearance(dict: PdfDict, rect: Box, pts: Pt[], closePath: boolean): GeneratedAppearance {
  const ops = new Ops();
  const border = borderOf(dict);
  const strokeColor = colorOp(getNumbers(dict, "C"), true);
  const fillColor = colorOp(getNumbers(dict, "IC"), false);
  const stroke = strokeColor !== undefined && border.width > 0;
  ops.opacity(dict);
  if (pts.length < 2) return ops.result(rect);
  if (stroke) {
    ops.push(strokeColor!);
    ops.strokeSetup(border);
  }
  const fillShape = closePath && fillColor !== undefined;
  if (fillShape) ops.push(fillColor!);
  const path = pts.map((pt, i) => `${nums(pt[0], pt[1])} ${i === 0 ? "m" : "l"}`);
  if (closePath) path.push("h");
  ops.push(path.join("\n"));
  ops.push(paintOp(fillShape, stroke));

  if (!closePath && stroke) {
    const [startStyle, endStyle] = lineEndingNames(dict);
    // Endings are drawn solid even on a dashed line.
    if (border.dash) ops.push("[] 0 d");
    const ends: Array<[string, Pt, Pt]> = [
      [startStyle, pts[0]!, pts[1]!],
      [endStyle, pts[pts.length - 1]!, pts[pts.length - 2]!],
    ];
    for (const [style, tip, from] of ends) {
      const e = lineEnding(style, tip, from, border.width);
      if (!e) continue;
      if (e.closed && fillColor) {
        ops.push(fillColor);
        ops.push(e.ops);
        ops.push("B");
      } else {
        ops.push(e.ops);
        ops.push(e.closed ? "s" : "S");
      }
    }
  }
  return ops.result(rect);
}

function inkAppearance(dict: PdfDict, rect: Box): GeneratedAppearance {
  const ops = new Ops();
  const border = borderOf(dict);
  const strokeColor = colorOp(getNumbers(dict, "C"), true);
  const inkList = dictGet(dict, "InkList");
  ops.opacity(dict);
  if (!strokeColor || border.width <= 0 || !Array.isArray(inkList)) return ops.result(rect);
  ops.push(strokeColor);
  ops.strokeSetup(border, true);
  for (const stroke of inkList) {
    if (!Array.isArray(stroke)) continue;
    const pts = pointsOf(stroke.filter((x): x is number => typeof x === "number"));
    if (pts.length === 0) continue;
    if (pts.length === 1) pts.push(pts[0]!); // a dot: zero-length line with round caps
    ops.push(pts.map((pt, i) => `${nums(pt[0], pt[1])} ${i === 0 ? "m" : "l"}`).join("\n"));
    ops.push("S");
  }
  return ops.result(rect);
}

/** Parses "r g b rg" / "g g" colour and "/Font size Tf" from a /DA string. */
export function parseDefaultAppearance(da: string | undefined): { color: number[]; size: number } {
  const out = { color: [0], size: 12 };
  if (!da) return out;
  const tf = /\/[^\s/]+\s+([\d.]+)\s+Tf/.exec(da);
  if (tf) {
    const size = Number(tf[1]);
    if (Number.isFinite(size) && size > 0) out.size = size;
  }
  const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
  const g = /(?:^|\s)([\d.]+)\s+g(?:\s|$)/.exec(da);
  if (rg) out.color = [Number(rg[1]), Number(rg[2]), Number(rg[3])];
  else if (g) out.color = [Number(g[1])];
  return out;
}

function freeTextAppearance(dict: PdfDict, rect: Box): GeneratedAppearance {
  const ops = new Ops();
  const border = borderOf(dict);
  const strokeColor = colorOp(getNumbers(dict, "C"), true);
  const fillColor = colorOp(getNumbers(dict, "IC"), false);
  ops.opacity(dict);
  if (fillColor) {
    ops.push(fillColor);
    ops.push(`${nums(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])} re f`);
  }
  if (strokeColor && border.width > 0) {
    const h = border.width / 2;
    ops.push(strokeColor);
    ops.strokeSetup(border);
    ops.push(`${nums(rect[0] + h, rect[1] + h, rect[2] - rect[0] - border.width, rect[3] - rect[1] - border.width)} re S`);
  }
  const text = getText(dict, "Contents") ?? "";
  if (text.length > 0) {
    const da = parseDefaultAppearance(getText(dict, "DA"));
    const ds = getText(dict, "DS") ?? "";
    const margin = Number(/margin:\s*([\d.]+)pt/.exec(ds)?.[1] ?? 2);
    const lineHeight = Number(/line-height:\s*([\d.]+)pt/.exec(ds)?.[1] ?? da.size * 1.15);
    const align = /text-align:\s*(center|right)/.exec(ds)?.[1] ?? (getNumber(dict, "Q") === 1 ? "center" : getNumber(dict, "Q") === 2 ? "right" : "left");
    ops.fonts.Helv = "Helvetica";
    ops.push("q");
    ops.push(`${nums(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1])} re W n`);
    ops.push(colorOp(da.color, false) ?? "0 g");
    ops.push("BT");
    ops.push(`/Helv ${fmt(da.size)} Tf`);
    const lines = text.split(/\r\n|\r|\n/);
    let y = rect[3] - margin - da.size * 0.8;
    for (const line of lines) {
      // Approximate width for alignment: Helvetica average ≈ 0.5 em.
      const w = line.length * da.size * 0.5;
      const left = rect[0] + margin;
      const avail = rect[2] - rect[0] - 2 * margin;
      const x = align === "center" ? left + (avail - w) / 2 : align === "right" ? left + avail - w : left;
      ops.push(`1 0 0 1 ${nums(x, y)} Tm`);
      ops.push(`(${literalText(line)}) Tj`);
      y -= lineHeight;
    }
    ops.push("ET");
    ops.push("Q");
  }
  return ops.result(rect);
}

/**
 * Generates the normal appearance for a dictionary without /AP. Returns
 * undefined for subtypes we do not draw (the caller reports them).
 */
export function generateAppearance(dict: PdfDict): GeneratedAppearance | undefined {
  const subtype = getName(dict, "Subtype");
  const rect = normalizeRect(getNumbers(dict, "Rect"));
  if (!subtype || !rect || !GENERATED_SUBTYPES.has(subtype)) return undefined;
  switch (subtype) {
    case "Square":
      return shapeAppearance(dict, rect, false);
    case "Circle":
      return shapeAppearance(dict, rect, true);
    case "Line": {
      const l = getNumbers(dict, "L");
      return polyAppearance(dict, rect, l && l.length >= 4 ? pointsOf(l.slice(0, 4)) : [], false);
    }
    case "PolyLine":
      return polyAppearance(dict, rect, pointsOf(getNumbers(dict, "Vertices") ?? []), false);
    case "Polygon":
      return polyAppearance(dict, rect, pointsOf(getNumbers(dict, "Vertices") ?? []), true);
    case "Ink":
      return inkAppearance(dict, rect);
    case "FreeText":
      return freeTextAppearance(dict, rect);
    default:
      return undefined;
  }
}
