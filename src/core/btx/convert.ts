// Story 7.5 (FR42, NFR10): a .btx item → our own markups, so an imported tool
// stays editable like one drawn here (framework-free; runs in the .btx worker).
//
// Revu stores Circle, Square, Line, PolyLine, Polygon, Ink and FreeText
// markups as bare dictionaries (no /AP): those convert member by member, at
// their -(X, Y) offsets, with the geometry Story 2.1's generated appearances
// draw (shape centre line inset by /RD, else half the border width), stroke
// /C, fill /IC, width /BS /W, dash /BS /D, opacity /CA. Ink drops Revu's
// pressure and draws at a uniform width (founder decision 2); FreeText asking
// for Calibri renders with the bundled Carlito (founder decision 3).
//
// Anything else stays an image of its own appearance (Story 7.4): stamps,
// image squares, count measurements, any member that carries an /AP (Revu's
// drawing is the reference), or a member we cannot express. Null means that.

import { normalizeRect, type Box } from "../pdf/content";
import { markupSchema, type Markup, type MarkupStyle } from "../schema/markup";
import { borderOf, hasAppearance, parseDefaultAppearance } from "./appearance";
import { dictGet, getName, getNumber, getNumbers, getText, isRef, type PdfDict } from "./pdf-object";
import type { BtxAnnotation, BtxItem } from "./parse";
import { memberOffset } from "./to-pdf";

/** The page converted markups are on until they become a tool. */
export const IMPORT_PAGE = "import:0";
/** Width given to a filled shape Revu draws without a stroke (painted in its fill's colour). */
export const FILL_ONLY_WIDTH = 0.01;
/** The fonts a text's /DA asks for that we draw with a bundled face. */
const CARLITO = /calibri/i;

type Pt = { x: number; y: number };

/** A PDF colour (gray, RGB or CMYK, 0–1) as #rrggbb; undefined when absent or malformed. */
export function hexColor(c: readonly number[] | undefined): string | undefined {
  if (!c || !c.every((n) => Number.isFinite(n))) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  let rgb: number[];
  if (c.length === 1) rgb = [c[0]!, c[0]!, c[0]!];
  else if (c.length === 3) rgb = [...c];
  else if (c.length === 4) rgb = [0, 1, 2].map((i) => (1 - clamp(c[i]!)) * (1 - clamp(c[3]!)));
  else return undefined;
  return `#${rgb.map((n) => Math.round(clamp(n) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Whether the item is a Revu count measurement (a Polygon with /IT /PolygonCount, or a /BBMeasure one). */
export function isCountItem(item: BtxItem): boolean {
  const root = item.annotations[0];
  if (!root) return false;
  return getName(root.dict, "IT") === "PolygonCount" || (getName(root.dict, "Subtype") === "Polygon" && dictGet(root.dict, "BBMeasure") !== undefined);
}

const VECTOR_SUBTYPES = new Set(["Square", "Circle", "Line", "PolyLine", "Polygon", "Ink", "FreeText"]);
const ARROW_ENDS = new Set(["OpenArrow", "ClosedArrow", "ROpenArrow", "RClosedArrow"]);

function opacityOf(dict: PdfDict): number | undefined {
  const ca = getNumber(dict, "CA");
  return ca !== undefined && ca >= 0 && ca < 1 ? ca : undefined;
}

function dashOf(dash: number[] | undefined): number[] | undefined {
  if (!dash || dash.length === 0 || dash.length > 8) return undefined;
  if (!dash.every((n) => Number.isFinite(n) && n >= 0 && n <= 144) || dash.every((n) => n === 0)) return undefined;
  return dash;
}

/** The stroke style of a member; null when it draws no stroke. */
function strokeStyle(dict: PdfDict): MarkupStyle | null {
  const color = hexColor(getNumbers(dict, "C"));
  const border = borderOf(dict);
  if (!color || !(border.width > 0)) return null;
  const style: MarkupStyle = { color, width: Math.min(144, border.width), fontSize: 10 };
  const dash = dashOf(border.dash);
  if (dash) style.dash = dash;
  const opacity = opacityOf(dict);
  if (opacity !== undefined) style.opacity = opacity;
  return style;
}

function pairs(flat: number[] | undefined): Pt[] {
  const out: Pt[] = [];
  if (!flat) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
  return out;
}

/** A box's corners from the screen's top left (y up): top left, top right, bottom right, bottom left. */
function corners([x0, y0, x1, y1]: Box): [Pt, Pt, Pt, Pt] {
  return [
    { x: x0, y: y1 },
    { x: x1, y: y1 },
    { x: x1, y: y0 },
    { x: x0, y: y0 },
  ];
}

type Draft = { type: Markup["type"]; points: Pt[]; style: MarkupStyle; text?: string };

/** Square / Circle: the shape's centre line, filled with /IC (a fill-only shape strokes in its fill). */
function shape(dict: PdfDict, rect: Box, type: "rectangle" | "ellipse"): Draft[] | null {
  if (type === "rectangle" && isRef(dictGet(dict, "Image"))) return null;
  const border = borderOf(dict);
  const stroke = strokeStyle(dict);
  const fill = hexColor(getNumbers(dict, "IC"));
  if (!stroke && !fill) return [];
  const width = stroke ? border.width : 0;
  const rd = getNumbers(dict, "RD");
  const half = width / 2;
  const [l, t, r, b] = rd && rd.length === 4 ? rd : [half, half, half, half];
  // A fill-only shape fills the inset box; its hairline stroke sits on that edge.
  const box: Box = [rect[0] + l!, rect[1] + b!, rect[2] - r!, rect[3] - t!];
  if (!(box[2] > box[0] && box[3] > box[1])) return null;
  let style: MarkupStyle;
  if (stroke) style = fill ? { ...stroke, fill } : stroke;
  else {
    style = { color: fill!, width: FILL_ONLY_WIDTH, fontSize: 10, fill: fill! };
    const opacity = opacityOf(dict);
    if (opacity !== undefined) style.opacity = opacity;
  }
  const fillOpacity = getNumber(dict, "FillOpacity");
  if (!stroke && fillOpacity !== undefined && fillOpacity >= 0 && fillOpacity < 1) style.opacity = (style.opacity ?? 1) * fillOpacity;
  return [{ type, points: corners(box), style }];
}

function lineEnds(dict: PdfDict): [string, string] {
  const le = dictGet(dict, "LE");
  const n = (o: unknown) => (typeof o === "object" && o !== null && (o as { kind?: string }).kind === "name" ? (o as { value: string }).value : "None");
  return Array.isArray(le) ? [n(le[0]), n(le[1])] : ["None", "None"];
}

/** Line: a line, or an arrow when one end (and only one) is an arrow head. */
function line(dict: PdfDict): Draft[] | null {
  const pts = pairs(getNumbers(dict, "L")?.slice(0, 4));
  if (pts.length !== 2) return null;
  const style = strokeStyle(dict);
  if (!style) return [];
  const [start, end] = lineEnds(dict).map((e) => ARROW_ENDS.has(e));
  if (end && !start) return [{ type: "arrow", points: pts, style }];
  if (start && !end) return [{ type: "arrow", points: [pts[1]!, pts[0]!], style }];
  return [{ type: "line", points: pts, style }];
}

function poly(dict: PdfDict, closed: boolean): Draft[] | null {
  const pts = pairs(getNumbers(dict, "Vertices"));
  if (pts.length < (closed ? 3 : 2)) return null;
  const stroke = strokeStyle(dict);
  const fill = closed ? hexColor(getNumbers(dict, "IC")) : undefined;
  if (!stroke && !fill) return [];
  const style: MarkupStyle = stroke ? (fill ? { ...stroke, fill } : stroke) : { color: fill!, width: FILL_ONLY_WIDTH, fontSize: 10, fill: fill! };
  return [{ type: closed ? "polygon" : "polyline", points: pts, style }];
}

/** Ink: one pen stroke a path, uniform width (pressure dropped). */
function ink(dict: PdfDict): Draft[] | null {
  const list = dictGet(dict, "InkList");
  if (!Array.isArray(list)) return null;
  const style = strokeStyle(dict);
  if (!style) return [];
  delete style.dash;
  const out: Draft[] = [];
  for (const path of list) {
    if (!Array.isArray(path)) return null;
    const pts = pairs(path.filter((n): n is number => typeof n === "number"));
    if (pts.length === 0) continue;
    if (pts.length === 1) pts.push({ ...pts[0]! });
    out.push({ type: "pen", points: pts, style: { ...style } });
  }
  return out;
}

/** FreeText: a text box (a typewriter when it has no border), its /DA size and colour, /IC fill. */
function freeText(dict: PdfDict, rect: Box): Draft[] | null {
  const text = (getText(dict, "Contents") ?? "").replace(/\r\n?/g, "\n");
  const daText = getText(dict, "DA");
  const da = parseDefaultAppearance(daText);
  const color = hexColor(da.color) ?? "#000000";
  const stroke = strokeStyle(dict);
  const fill = hexColor(getNumbers(dict, "IC"));
  const style: MarkupStyle = { color, width: stroke ? stroke.width : 1, fontSize: Math.min(144, da.size) };
  if (stroke?.dash) style.dash = stroke.dash;
  if (fill) style.fill = fill;
  const opacity = opacityOf(dict);
  if (opacity !== undefined) style.opacity = opacity;
  const face = /\/([^\s/]+)\s+[\d.]+\s+Tf/.exec(daText ?? "")?.[1] ?? "";
  const ds = getText(dict, "DS") ?? "";
  if (CARLITO.test(face) || CARLITO.test(ds)) style.font = "carlito";
  if (!stroke && text === "" && !fill) return [];
  return [{ type: stroke ? "text" : "typewriter", points: corners(rect), style, text }];
}

function member(a: BtxAnnotation): Draft[] | null {
  const subtype = getName(a.dict, "Subtype");
  if (!subtype || !VECTOR_SUBTYPES.has(subtype) || hasAppearance(a.dict)) return null;
  const rect = normalizeRect(getNumbers(a.dict, "Rect"));
  if (!rect) return null;
  switch (subtype) {
    case "Square":
      return shape(a.dict, rect, "rectangle");
    case "Circle":
      return shape(a.dict, rect, "ellipse");
    case "Line":
      return line(a.dict);
    case "PolyLine":
      return poly(a.dict, false);
    case "Polygon":
      return poly(a.dict, true);
    case "Ink":
      return ink(a.dict);
    case "FreeText":
      return freeText(a.dict, rect);
    default:
      return null;
  }
}

/**
 * The item as our markups (root first, children in file order, each at its
 * placement offset, subject = `name`); null when it stays an image.
 */
export function convertItem(item: BtxItem, name: string, newId: () => string, createdAt: string): Markup[] | null {
  if (item.annotations.length === 0 || isCountItem(item)) return null;
  const out: Markup[] = [];
  for (const a of item.annotations) {
    const drafts = member(a);
    if (!drafts) return null;
    const [dx, dy] = memberOffset(a);
    for (const d of drafts) {
      const candidate = {
        id: newId(),
        pageId: IMPORT_PAGE,
        createdAt,
        type: d.type,
        subject: name,
        style: d.style,
        points: d.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        ...(d.text !== undefined ? { text: d.text } : {}),
      };
      const parsed = markupSchema.safeParse(candidate);
      if (!parsed.success) return null;
      out.push(parsed.data);
    }
  }
  return out.length > 0 ? out : null;
}
