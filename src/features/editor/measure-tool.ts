// The measuring tools (FR26): Length (Story 4.5), Polylength (Story 4.6),
// Area and Count (Story 4.8).
// Length: two clicks, the second adds it as one undo step ("Add length").
// Polylength: each click adds a vertex; a double-click or Enter finishes it
// ("Add polylength"), Backspace removes the last vertex. Area: the same, at
// least three vertices, a click on the first vertex also closes it; a polygon
// that crosses itself is not added. While drawing, a rubber band follows the
// tool point (snapped, Shift-held or raw: the viewer's snapping rules) with the
// live value beside the pointer. The tool stays armed after a measurement
// (Revu). Esc while drawing cancels it, Ctrl+Z removes its last point; another
// tool, page or tab cancels it. Count: each click places a marker of one count;
// Enter, a double-click, Esc and leaving the tool finish it (founder default
// D4: a count is never thrown away). Angle (the first leg's start, the
// vertex, the second leg's end), Radius and Diameter (three points on the
// circle): the third click adds them (Story 4.9), as Length's second does.
// Dynamic fill (Story 4.10, fill-tool.ts) is pressed and held, not clicked;
// Enter adds its area like Area's.
//
// With Select, Shift + drag on a caption moves the caption only ("Move
// caption", a markups.update op); the offset is stored in user space.
//
// Selected markups (the Measurements panel selects one, Story 4.11; the
// Select tool, Story 5.1, select-tool.ts) get the selection outline; Esc with
// Select, another tool, page, tab or document clears it. Markups being moved
// are painted where they go.
//
// The editor paints the viewer's layers 2 and 3 through the viewer's markup
// painter interface (AR10): layer 2 the page's markups, layer 3 the drawing.

import { useLayoutEffect } from "react";

import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { angleCaption, bisector } from "@/core/measure/angle";
import { areaCaption, areaCaptionText, formatArea, polygonCentroid, selfIntersects } from "@/core/measure/area";
import { circleCaption, circleThrough } from "@/core/measure/circle";
import { SCALE_NOT_SET, captionPlacement, lengthCaption, polylineCaptionAnchor } from "@/core/measure/length";
import { translateMarkup } from "@/core/markup/geometry";
import { DEFAULT_MEASURE_STYLE, MAX_POLYLINE_POINTS, type MarkupStyle, type MeasureMarkup } from "@/core/schema/markup";
import {
  isMeasureTool,
  notifyMarkups,
  registerMarkupPainter,
  setTool,
  viewerStore,
  type LayerView,
  type MarkupPainter,
  type MeasureTool,
} from "@/features/viewer";

import { editorStore, markupsOf, pageMarkups, setCaptionDrag, setDrawing, setMarkupMenu, setMoveDrag, setPreview, setSelection, type Drawing, type MoveDrag } from "./editor-store";
import { discardFill, fillAreaUser, fillPress, paintFill, takeFillRings, undoFillStroke } from "./fill-tool";
import { handlesOf, paintHandles } from "./handles";
import { lockedNote, openMarkupMenu, paintSelectGesture, resetSelectTool, selectCursorAt, selectGesture, selectionKey, toggleSelected } from "./select-tool";
import { executeOp, registerDrawingUndo } from "./undo-store";

type Point = { x: number; y: number };

export const ADD_LENGTH = "Add length";
export const ADD_POLYLENGTH = "Add polylength";
export const ADD_AREA = "Add area";
export const ADD_COUNT = "Add count";
export const ADD_ANGLE = "Add angle";
export const ADD_RADIUS = "Add radius";
export const ADD_DIAMETER = "Add diameter";
export const MOVE_CAPTION = "Move caption";
const ADD_LABEL: Record<MeasureTool, string> = {
  length: ADD_LENGTH,
  polylength: ADD_POLYLENGTH,
  area: ADD_AREA,
  count: ADD_COUNT,
  angle: ADD_ANGLE,
  radius: ADD_RADIUS,
  diameter: ADD_DIAMETER,
  fill: ADD_AREA,
};
/** Story 4.8: what the live value says while an area crosses itself (it cannot be added). */
export const CROSSES_ITSELF = "Crosses itself";
/** Vertices a drawing needs before it can be finished. */
const MIN_POINTS: Record<MeasureTool, number> = { length: 2, polylength: 2, area: 3, count: 1, angle: 3, radius: 3, diameter: 3, fill: 0 };
/** Tools with a fixed number of points: the click that places the last one adds the measurement. */
const FIXED_POINTS: Partial<Record<MeasureTool, number>> = { length: 2, angle: 3, radius: 3, diameter: 3 };
/** Story 4.9: the arc at an angle's vertex, in CSS px (at most 40 % of the shorter leg). */
const ANGLE_ARC_PX = 14;
/** The live label beside the pointer, in screen px (not page units: it is UI, not the markup). */
const LIVE_FONT_PX = 12;
const LIVE_OFFSET_PX = { x: 14, y: 22 };
/** Story 4.8: a count marker's radius in points (page units: it scales with the zoom). */
const COUNT_MARKER_PT = 4;
/** Story 4.11: the selection outline's gap around a markup and its widths, in CSS px. */
const SELECTION_GAP_PX = 4;
const SELECTION_PX = 1.5;
const SELECTION_HALO_PX = 4;
/** Line spacing of a two-line caption, in caption sizes. */
const LINE_HEIGHT = 1.15;

const drawing = (): Drawing | null => editorStore.getState().tools.drawing;

function calibrationOf(documentId: string, pageIndex: number): Calibration | null {
  return viewerStore.getState().calibrations[pageIdOf(documentId, pageIndex)] ?? null;
}

function stroke(c: CanvasRenderingContext2D, style: MarkupStyle, view: LayerView): void {
  c.lineWidth = Math.max(1, style.width * view.devicePerPt);
  c.lineCap = "butt";
  c.lineJoin = "miter";
  c.strokeStyle = style.color;
  c.stroke();
}

/** Story 4.11: the selection outline (UX-DR13: accent with a white halo) around device points, under the markup. */
function strokeSelection(c: CanvasRenderingContext2D, pts: readonly Point[], view: LayerView): void {
  const gap = SELECTION_GAP_PX * view.dpr;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - gap;
  const y = Math.min(...ys) - gap;
  const w = Math.max(...xs) + gap - x;
  const h = Math.max(...ys) + gap - y;
  c.save();
  c.setLineDash([]);
  c.lineJoin = "miter";
  c.strokeStyle = view.colors.halo;
  c.lineWidth = SELECTION_HALO_PX * view.dpr;
  c.strokeRect(x, y, w, h);
  c.strokeStyle = view.colors.selection;
  c.lineWidth = SELECTION_PX * view.dpr;
  c.strokeRect(x, y, w, h);
  c.restore();
}

/** A polyline in page units with short end ticks across its first and last segments (a dimension line). */
function strokeMeasure(c: CanvasRenderingContext2D, pts: readonly Point[], style: MarkupStyle, view: LayerView): void {
  if (pts.length < 2) return;
  const tick = Math.max(3 * view.dpr, 3 * view.devicePerPt);
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  const ends: [Point, Point][] = [
    [pts[0], pts[1]],
    [pts[pts.length - 1], pts[pts.length - 2]],
  ];
  for (const [p, q] of ends) {
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = length > 1e-6 ? -(q.y - p.y) / length : 0;
    const ny = length > 1e-6 ? (q.x - p.x) / length : 0;
    c.moveTo(p.x - nx * tick, p.y - ny * tick);
    c.lineTo(p.x + nx * tick, p.y + ny * tick);
  }
  stroke(c, style, view);
}

/** Story 4.8: closed rings (an area's outline and its holes), no fill (founder default D6). */
function strokeRings(c: CanvasRenderingContext2D, rings: readonly (readonly Point[])[], style: MarkupStyle, view: LayerView): void {
  c.beginPath();
  for (const ring of rings) {
    if (ring.length < 2) continue;
    c.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) c.lineTo(ring[i].x, ring[i].y);
    c.closePath();
  }
  stroke(c, style, view);
}

/** Story 4.8: a count's markers, circles in page units. */
function drawMarkers(c: CanvasRenderingContext2D, pts: readonly Point[], style: MarkupStyle, view: LayerView): void {
  const r = markerRadius(view);
  c.beginPath();
  for (const p of pts) {
    c.moveTo(p.x + r, p.y);
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
  }
  stroke(c, style, view);
}

const markerRadius = (view: LayerView) => Math.max(2 * view.dpr, COUNT_MARKER_PT * view.devicePerPt);

/** Story 4.9: the arc's radius at an angle's vertex (device px). */
function angleArcRadius(pts: readonly Point[], view: LayerView): number {
  const shorter = Math.min(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y));
  return Math.min(ANGLE_ARC_PX * view.dpr, 0.4 * shorter);
}

/** Story 4.9: an angle's legs (device points: start, vertex, end) and the arc between them at the vertex. */
function strokeAngle(c: CanvasRenderingContext2D, pts: readonly Point[], style: MarkupStyle, view: LayerView): void {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  if (pts.length >= 3) {
    const [a, v, b] = pts;
    const r = angleArcRadius(pts, view);
    if (r > 0) {
      const from = Math.atan2(a.y - v.y, a.x - v.x);
      let sweep = Math.atan2(b.y - v.y, b.x - v.x) - from;
      // The short way round (the angle measured, at most 180°).
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      else if (sweep < -Math.PI) sweep += 2 * Math.PI;
      c.moveTo(v.x + r * Math.cos(from), v.y + r * Math.sin(from));
      c.arc(v.x, v.y, r, from, from + sweep, sweep < 0);
    }
  }
  stroke(c, style, view);
}

/** Story 4.9: the circle through three user space points, in device px (null in a line). */
function deviceCircle(points: readonly Point[], view: LayerView): { centre: Point; radius: number } | null {
  const circle = points.length >= 3 ? circleThrough(points[0], points[1], points[2]) : null;
  if (!circle) return null;
  const centre = view.toDevice(circle.centre);
  const p = view.toDevice(points[0]);
  return { centre, radius: Math.hypot(p.x - centre.x, p.y - centre.y) };
}

/** Story 4.9: the line a radius or diameter caption sits along (device px): centre to the first point, or across. */
function circleLine(kind: "radius" | "diameter", first: Point, circle: { centre: Point }): [Point, Point] {
  return kind === "radius" ? [circle.centre, first] : [first, { x: 2 * circle.centre.x - first.x, y: 2 * circle.centre.y - first.y }];
}

/** Story 4.9: a radius or diameter: the circle and its line; while fewer than three points, the line so far. */
function strokeCircle(
  c: CanvasRenderingContext2D,
  kind: "radius" | "diameter",
  pts: readonly Point[],
  circle: { centre: Point; radius: number } | null,
  style: MarkupStyle,
  view: LayerView,
): void {
  c.beginPath();
  if (circle) {
    c.moveTo(circle.centre.x + circle.radius, circle.centre.y);
    c.arc(circle.centre.x, circle.centre.y, circle.radius, 0, Math.PI * 2);
    const [a, b] = circleLine(kind, pts[0], circle);
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
  } else {
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  }
  stroke(c, style, view);
}

/**
 * Review R6 (4.5): whether a measurement (with its ticks and caption) can
 * touch the canvas. Zoomed in, most markups are off screen and their captions
 * are huge: they are skipped, not drawn and clipped.
 */
export function onCanvas(pts: readonly Point[], style: MarkupStyle, view: LayerView, extra: readonly Point[] = []): boolean {
  if (!(view.width > 0 && view.height > 0)) return true; // size unknown: draw
  const caption = style.fontSize * view.devicePerPt;
  // The caption is centred on its anchor and at most half the text width long either way; a
  // generous margin (text up to 12 em) keeps a long caption on a short line drawn.
  const margin = Math.max(3 * view.dpr, 3 * view.devicePerPt) + caption * 12;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of [...pts, ...extra]) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return x1 >= -margin && x0 <= view.width + margin && y1 >= -margin && y0 <= view.height + margin;
}

/** Where a caption is drawn (device px): its first line's baseline centre, turned by `angle`. */
export type CaptionFrame = { x: number; y: number; angle: number; size: number };

/**
 * Where a measurement's caption is drawn, moved by its offset: a length's and
 * a polylength's along their (longest) segment, above it; an area's at its
 * centroid, horizontal, the first line above the centre; a count's above its
 * first marker; an angle's inside it at the vertex; a radius's and a
 * diameter's along their line.
 */
export function captionFrame(m: MeasureMarkup, view: LayerView): CaptionFrame {
  const size = m.style.fontSize * view.devicePerPt;
  let at: { x: number; y: number; angle: number };
  if (m.type === "area") {
    const c = view.toDevice(polygonCentroid(m.points));
    at = { x: c.x, y: c.y, angle: 0 };
  } else if (m.type === "count") {
    const p = view.toDevice(m.points[0]);
    at = { x: p.x, y: p.y - markerRadius(view) - size * 0.2, angle: 0 };
  } else if (m.type === "angle") {
    // Inside the angle along its bisector, past the arc; horizontal, the text roughly centred there.
    const pts = devicePoints(m.points, view);
    const v = pts[1];
    const u = bisector(m.points[0], m.points[1], m.points[2]);
    const tip = view.toDevice({ x: m.points[1].x + u.x, y: m.points[1].y + u.y });
    const d = Math.hypot(tip.x - v.x, tip.y - v.y) || 1;
    const reach = angleArcRadius(pts, view) + size * 0.9;
    at = { x: v.x + ((tip.x - v.x) / d) * reach, y: v.y + ((tip.y - v.y) / d) * reach + size * 0.4, angle: 0 };
  } else if (m.type === "radius" || m.type === "diameter") {
    const gap = Math.max(1, m.style.width * view.devicePerPt) / 2 + size * 0.2;
    const circle = deviceCircle(m.points, view);
    const first = view.toDevice(m.points[0]);
    const [a, b] = circle ? circleLine(m.type, first, circle) : [first, view.toDevice(m.points[1])];
    at = captionPlacement(a, b, gap);
  } else {
    const [ua, ub] = m.type === "length" ? m.points : polylineCaptionAnchor(m.points);
    at = captionPlacement(view.toDevice(ua), view.toDevice(ub), Math.max(1, m.style.width * view.devicePerPt) / 2 + size * 0.2);
  }
  if (m.captionOffset) {
    const o = view.toDevice(m.captionOffset);
    const z = view.toDevice({ x: 0, y: 0 });
    at.x += o.x - z.x;
    at.y += o.y - z.y;
  }
  return { ...at, size };
}

/** The caption's lines from its frame down, never upside down; "Scale not set" in the warning colour. */
function drawCaption(c: CanvasRenderingContext2D, at: CaptionFrame, lines: readonly string[], scaled: boolean, style: MarkupStyle, view: LayerView): void {
  if (at.size < 1) return;
  c.save();
  c.translate(at.x, at.y);
  c.rotate(at.angle);
  c.font = `${at.size}px ${view.colors.fontFamily}`;
  c.textAlign = "center";
  c.textBaseline = "bottom";
  c.fillStyle = scaled ? style.color : view.colors.warning;
  lines.forEach((line, i) => c.fillText(line, 0, i * at.size * LINE_HEIGHT));
  c.restore();
}

function liveLabel(c: CanvasRenderingContext2D, at: Point, text: string, scaled: boolean, view: LayerView): void {
  const k = view.dpr;
  c.save();
  c.font = `${Math.round(LIVE_FONT_PX * k)}px ${view.colors.fontFamily}`;
  c.textAlign = "left";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = Math.max(2, Math.round(3 * k));
  c.strokeStyle = view.colors.halo;
  c.fillStyle = scaled ? DEFAULT_MEASURE_STYLE.color : view.colors.warning;
  const x = at.x + LIVE_OFFSET_PX.x * k;
  const y = at.y + LIVE_OFFSET_PX.y * k;
  c.strokeText(text, x, y);
  c.fillText(text, x, y);
  c.restore();
}

const devicePoints = (pts: readonly Point[], view: LayerView) => pts.map((p) => view.toDevice(p));

/** A caption as last painted (device px): its frame, half its widest line and its line count, for hits. */
type CaptionBox = { id: string; frame: CaptionFrame; half: number; lines: number };
/** The captions of the page last painted, in drawing order (review R2: that page only, not every page ever painted). */
let captionBoxes: { pageId: string; boxes: CaptionBox[] } | null = null;
/** CSS px around a caption that still hit it. */
const CAPTION_SLOP_PX = 3;

const addOffset = (a: Point | undefined, b: Point): Point => ({ x: (a?.x ?? 0) + b.x, y: (a?.y ?? 0) + b.y });

let moving: { drag: MoveDrag; ids: ReadonlySet<string> } | null = null;

/** The markup as painted: a caption being moved, or markups being moved (Story 5.1), show where they go. */
function shown(m: MeasureMarkup): MeasureMarkup {
  const { captionDrag: drag, moveDrag, preview } = editorStore.getState().tools;
  // Story 5.2: a resize, rotation or vertex drag in progress.
  const changed = preview && m.pageId.startsWith(`${preview.documentId}:`) ? (preview.changed[m.id] as MeasureMarkup | undefined) : undefined;
  let out = changed ?? m;
  out = drag && drag.id === m.id ? { ...out, captionOffset: addOffset(out.captionOffset, drag.delta) } : out;
  if (moveDrag) {
    if (moving?.drag !== moveDrag) moving = { drag: moveDrag, ids: new Set(moveDrag.ids) };
    if (moving.ids.has(m.id) && m.pageId.startsWith(`${moveDrag.documentId}:`)) out = translateMarkup(out, moveDrag.delta);
  }
  return out;
}

const MEASURE_TYPES: ReadonlySet<string> = new Set(["length", "polylength", "area", "count", "angle", "radius", "diameter"]);
const isMeasure = (m: { type: string }): m is MeasureMarkup => MEASURE_TYPES.has(m.type);

/** A measurement's caption: its lines on the canvas, its one-line text (layer 2's list) and whether it is scaled. */
function captionOf(m: MeasureMarkup, calibration: Calibration | null, userUnit: number): { lines: string[]; text: string; scaled: boolean } {
  if (m.type === "count") return { lines: [String(m.points.length)], text: String(m.points.length), scaled: true };
  if (m.type === "angle" || m.type === "radius" || m.type === "diameter") {
    const a = m.type === "angle" ? angleCaption(m.points, calibration) : circleCaption(m.type, m.points, calibration, userUnit);
    return { lines: [a.text], text: a.text, scaled: a.scaled };
  }
  if (m.type === "area") {
    const a = areaCaption(m.points, m.holes, calibration, userUnit);
    return { lines: a.perimeter ? [a.area, `P ${a.perimeter}`] : [a.area], text: areaCaptionText(a), scaled: a.scaled };
  }
  const l = lengthCaption(m.points, calibration, userUnit);
  return { lines: [l.text], text: l.text, scaled: l.scaled };
}

/** The live value of a drawing with the tool point added (or null when there is none to show). */
function liveValue(tool: MeasureTool, points: readonly Point[], calibration: Calibration | null, userUnit: number): { text: string; scaled: boolean } | null {
  if (tool === "count") return { text: String(points.length - 1), scaled: true };
  // Story 4.9: an angle or a circle has a value from its third point on.
  if (tool === "angle") return points.length >= 3 ? angleCaption(points, calibration) : null;
  if (tool === "radius" || tool === "diameter") return points.length >= 3 ? circleCaption(tool, points, calibration, userUnit) : null;
  if (tool === "area") {
    // Review R1: the tool point on the last vertex (just clicked) or on the first (about to
    // close it) adds no vertex; it must not read as a crossing.
    const p = points[points.length - 1];
    const same = (q: Point) => q.x === p.x && q.y === p.y;
    const ring = points.length > 1 && (same(points[0]) || same(points[points.length - 2])) ? points.slice(0, -1) : points;
    if (ring.length >= 3 && selfIntersects(ring)) return { text: CROSSES_ITSELF, scaled: false };
    const a = areaCaption(ring, undefined, calibration, userUnit);
    return { text: a.area, scaled: a.scaled };
  }
  return lengthCaption(points, calibration, userUnit);
}

export const measurePainter: MarkupPainter = {
  paintStatic(c, view) {
    const stored = pageMarkups(editorStore.getState(), view.documentId, pageIdOf(view.documentId, view.pageIndex));
    // Story 5.2: copies being dragged are painted on top.
    const preview = editorStore.getState().tools.preview;
    const added = preview && preview.documentId === view.documentId ? preview.added.filter((m) => m.pageId === pageIdOf(view.documentId, view.pageIndex)) : [];
    const markups = added.length > 0 ? [...stored, ...added] : stored;
    if (markups.length === 0) {
      captionBoxes = null;
      return [];
    }
    const pageId = pageIdOf(view.documentId, view.pageIndex);
    const calibration = calibrationOf(view.documentId, view.pageIndex);
    const captions: string[] = [];
    const boxes: CaptionBox[] = [];
    const selected = new Set(editorStore.getState().selection.ids);
    const selectedShown: MeasureMarkup[] = [];
    c.save();
    for (const one of markups) {
      if (!isMeasure(one)) continue;
      const m = shown(one);
      if (selected.has(m.id)) selectedShown.push(m);
      const caption = captionOf(m, calibration, view.userUnit);
      captions.push(caption.text);
      const pts = devicePoints(m.points, view);
      const frame = captionFrame(m, view);
      const circle = m.type === "radius" || m.type === "diameter" ? deviceCircle(m.points, view) : null;
      const extent = circle
        ? [
            { x: circle.centre.x - circle.radius, y: circle.centre.y - circle.radius },
            { x: circle.centre.x + circle.radius, y: circle.centre.y + circle.radius },
          ]
        : [];
      if (!onCanvas(pts, m.style, view, [frame, ...extent])) continue;
      if (selected.has(m.id)) strokeSelection(c, circle ? extent : pts, view);
      if (m.type === "area") strokeRings(c, [pts, ...(m.holes ?? []).map((h) => devicePoints(h, view))], m.style, view);
      else if (m.type === "count") drawMarkers(c, pts, m.style, view);
      else if (m.type === "angle") strokeAngle(c, pts, m.style, view);
      else if (m.type === "radius" || m.type === "diameter") strokeCircle(c, m.type, pts, circle, m.style, view);
      else strokeMeasure(c, pts, m.style, view);
      drawCaption(c, frame, caption.lines, caption.scaled, m.style, view);
      if (frame.size >= 1) {
        c.font = `${frame.size}px ${view.colors.fontFamily}`;
        const half = Math.max(...caption.lines.map((line) => c.measureText(line).width || 0)) / 2;
        boxes.push({ id: m.id, frame, half, lines: caption.lines.length });
      }
    }
    c.restore();
    // Story 5.2: the selection's handles, over everything.
    const handles = handlesOf(selectedShown.filter((m) => !m.locked), view);
    if (handles) paintHandles(c, handles, view);
    captionBoxes = { pageId, boxes };
    return captions;
  },

  paintActive(c, view, pointer) {
    // Story 5.1: the marquee or lasso in progress.
    if (viewerStore.getState().tool === "select") paintSelectGesture(c, view);
    const d = drawing();
    if (d?.tool === "fill") return paintFillActive(c, view, pointer);
    if (!d || d.pageId !== pageIdOf(view.documentId, view.pageIndex) || !pointer || d.points.length === 0) return null;
    const points = [...d.points, pointer];
    const pts = devicePoints(points, view);
    const live = liveValue(d.tool, points, calibrationOf(view.documentId, view.pageIndex), view.userUnit);
    c.save();
    if (d.tool === "area") strokeRings(c, [pts], DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "count") drawMarkers(c, pts.slice(0, -1), DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "angle") strokeAngle(c, pts, DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "radius" || d.tool === "diameter") strokeCircle(c, d.tool, pts, deviceCircle(points, view), DEFAULT_MEASURE_STYLE, view);
    else strokeMeasure(c, pts, DEFAULT_MEASURE_STYLE, view);
    c.restore();
    if (!live) return null;
    liveLabel(c, pts[pts.length - 1], live.text, live.scaled, view);
    return live.text;
  },

  get tracking() {
    return drawing() !== null;
  },

  get lastPoint() {
    return drawing()?.points.at(-1) ?? null;
  },

  place(point, at) {
    const tool = viewerStore.getState().tool;
    // Dynamic fill is pressed, not clicked (press below).
    if (!isMeasureTool(tool) || tool === "fill") return "ignored";
    const pageId = pageIdOf(at.documentId, at.pageIndex);
    const d = drawing();
    if (!d || d.pageId !== pageId || d.tool !== tool) {
      setDrawing({ tool, pageId, pageIndex: at.pageIndex, points: [point] });
      return "continue";
    }
    // A click on the last point adds nothing (a double-click's second click): keep drawing.
    const last = d.points[d.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) <= at.tolerance) return "continue";
    // Story 4.8 (D2): a click on an area's first vertex closes it.
    const first = d.points[0];
    if (tool === "area" && d.points.length >= MIN_POINTS.area && Math.hypot(point.x - first.x, point.y - first.y) <= at.tolerance) {
      return finishDrawing(at.documentId);
    }
    const points = [...d.points, point];
    const fixed = FIXED_POINTS[tool];
    if (fixed !== undefined && points.length >= fixed) {
      // Story 4.9: three points in a line make no circle; the click adds nothing.
      if ((tool === "radius" || tool === "diameter") && !circleThrough(points[0], points[1], points[2])) return "continue";
      setDrawing({ ...d, points: points.slice(0, fixed) });
      return commit(at.documentId);
    }
    setDrawing({ ...d, points });
    // At the cap the drawing is finished (it cannot take another point).
    return points.length >= MAX_POLYLINE_POINTS ? finishDrawing(at.documentId) : "continue";
  },

  finish() {
    const d = drawing();
    if (d?.tool === "fill") return addFilledArea();
    const documentId = viewerStore.getState().documentId;
    // Fixed-point tools (Length, Angle, Radius, Diameter) finish on their last click only.
    if (!d || FIXED_POINTS[d.tool] !== undefined || !documentId || !d.pageId.startsWith(`${documentId}:`)) return "ignored";
    return finishDrawing(documentId);
  },

  removeLastPoint() {
    return undoDrawingPoint();
  },

  escape() {
    const d = drawing();
    // Story 4.11: with nothing being drawn, Esc clears the selection.
    if (!d) return setSelection([]);
    // D4: Esc finishes a count (its markers are kept); it cancels the other drawings.
    const documentId = viewerStore.getState().documentId;
    if (d.tool === "count" && documentId && d.pageId.startsWith(`${documentId}:`)) commit(documentId);
    else if (d.tool === "fill") discardFill();
    else setDrawing(null);
    return true;
  },

  captionAt(view, at) {
    const boxes = captionBoxes?.pageId === pageIdOf(view.documentId, view.pageIndex) ? captionBoxes.boxes : [];
    const slop = CAPTION_SLOP_PX * view.dpr;
    // The topmost (last drawn) first.
    for (let i = boxes.length - 1; i >= 0; i--) {
      const { id, frame, half, lines } = boxes[i];
      const dx = at.x - frame.x;
      const dy = at.y - frame.y;
      const cos = Math.cos(frame.angle);
      const sin = Math.sin(frame.angle);
      // Into the caption's frame: centred on x, the first line above its baseline (y from -size), further lines below.
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const bottom = (lines - 1) * frame.size * LINE_HEIGHT;
      if (Math.abs(lx) <= half + slop && ly >= -frame.size - slop && ly <= bottom + slop) return id;
    }
    return null;
  },

  dragCaption(id, documentId, delta) {
    const m = pageMarkupById(documentId, id);
    if (!m) return;
    // Story 5.3 review R1: a locked markup's caption stays (Shift + click still selects it).
    if (m.locked) {
      if (delta.x !== 0 || delta.y !== 0) lockedNote();
      const drag = editorStore.getState().tools.captionDrag;
      if (drag?.id !== id) setCaptionDrag({ id, documentId, delta: { x: 0, y: 0 } });
      return;
    }
    setCaptionDrag({ id, documentId, delta: { x: delta.x, y: delta.y } });
  },

  endCaptionDrag(commit) {
    const drag = editorStore.getState().tools.captionDrag;
    setCaptionDrag(null);
    // Story 5.1: Shift + click on a caption (it did not move) adds its markup to the selection or takes it out.
    if (drag && commit && drag.delta.x === 0 && drag.delta.y === 0) toggleSelected(drag.id);
    if (!drag || !commit || (drag.delta.x === 0 && drag.delta.y === 0)) return false;
    const before = pageMarkupById(drag.documentId, drag.id);
    if (!before) return false;
    const after: MeasureMarkup = { ...before, captionOffset: addOffset(before.captionOffset, drag.delta) };
    executeOp({ kind: "markups.update", documentId: drag.documentId, before: [before], after: [after] }, MOVE_CAPTION);
    return true;
  },

  press(phase, point, at, brush) {
    if (viewerStore.getState().tool === "fill") fillPress(phase, point, at, brush);
  },

  select(phase, point, at) {
    selectGesture(phase, point, at, (view, device) => measurePainter.captionAt(view, device));
  },

  cursorAt(point, at) {
    return selectCursorAt(point, at, (view, device) => measurePainter.captionAt(view, device));
  },

  selectionKey(key, at) {
    return selectionKey(key, at);
  },

  contextMenu(point, at, client, keyboard) {
    return openMarkupMenu(point, at, client, keyboard, (view, device) => measurePainter.captionAt(view, device));
  },
};

/** Story 4.10: layer 3 while filling: the fill and its area so far beside the pointer. */
function paintFillActive(c: CanvasRenderingContext2D, view: LayerView, pointer: Point | null): string | null {
  const pageId = pageIdOf(view.documentId, view.pageIndex);
  const user2 = fillAreaUser(pageId);
  if (user2 === null) return null;
  paintFill(c, view);
  const calibration = calibrationOf(view.documentId, view.pageIndex);
  const u = view.userUnit > 0 ? view.userUnit : 1;
  const live = calibration
    ? { text: formatArea(user2 * u * u * calibration.xFactor * calibration.yFactor, calibration.unit), scaled: true }
    : { text: SCALE_NOT_SET, scaled: false };
  if (pointer) liveLabel(c, view.toDevice(pointer), live.text, live.scaled, view);
  return live.text;
}

/** Story 4.10: Enter while filling adds the fill as an area markup ("Add area"). */
function addFilledArea(): "done" | "ignored" {
  const documentId = viewerStore.getState().documentId;
  const d = drawing();
  if (!d || !documentId || !d.pageId.startsWith(`${documentId}:`)) return "ignored";
  const rings = takeFillRings();
  if (!rings) return "ignored";
  const markup: MeasureMarkup = {
    id: uuidv7(),
    pageId: rings.pageId,
    createdAt: new Date().toISOString(),
    style: DEFAULT_MEASURE_STYLE,
    type: "area",
    points: rings.outer,
    ...(rings.holes.length > 0 ? { holes: rings.holes } : {}),
  };
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD_AREA);
  return "done";
}

/** A document's measurement by id, if it has it. */
function pageMarkupById(documentId: string, id: string): MeasureMarkup | null {
  const m = (editorStore.getState().doc.markups[documentId] ?? []).find((x) => x.id === id);
  return m && isMeasure(m) ? m : null;
}

/** Finishes a polylength, area or count when it can be: enough points, an area that does not cross itself (D3). */
function finishDrawing(documentId: string): "done" | "ignored" {
  const d = drawing();
  if (!d || d.points.length < MIN_POINTS[d.tool]) return "ignored";
  if (d.tool === "area" && selfIntersects(d.points)) return "ignored";
  return commit(documentId);
}

/** Adds the drawing as its markup (one undo step, in `tabId`'s history: the active tab by default) and ends it. */
function commit(documentId: string, tabId?: string): "done" {
  const d = drawing()!;
  const base = { id: uuidv7(), pageId: d.pageId, createdAt: new Date().toISOString(), style: DEFAULT_MEASURE_STYLE };
  const points = [...d.points];
  const [a, b, c] = points;
  const markup: MeasureMarkup =
    d.tool === "length"
      ? { ...base, type: "length", points: [a, b] }
      : d.tool === "angle" || d.tool === "radius" || d.tool === "diameter"
        ? { ...base, type: d.tool, points: [a, b, c] }
        : d.tool === "fill"
          ? { ...base, type: "area", points }
          : { ...base, type: d.tool, points };
  setDrawing(null);
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD_LABEL[d.tool], tabId);
  return "done";
}

/** Ctrl+Z or Backspace while drawing: removes the last placed point (the last one ends the drawing). */
function undoDrawingPoint(): boolean {
  const d = drawing();
  if (!d) return false;
  // Story 4.10: while filling, the last stroke.
  if (d.tool === "fill") return undoFillStroke();
  const points = d.points.slice(0, -1);
  setDrawing(points.length > 0 ? { ...d, points } : null);
  return true;
}

let installed = 0;
let uninstall: (() => void) | null = null;

/** Registers the measuring tools with the viewer and the undo stack (the workspace shell, once). */
export function installMeasureTools(): () => void {
  installed++;
  if (installed === 1) {
    const offPainter = registerMarkupPainter(measurePainter);
    const offUndo = registerDrawingUndo(undoDrawingPoint);
    // Markups, the drawing or a calibration changed: the viewer paints again (captions follow
    // a recalibration: values are never stored, 4.5 AC 2).
    const offEditor = editorStore.subscribe((s, prev) => {
      if (s.doc === prev.doc && s.tools === prev.tools && s.selection === prev.selection) return;
      // Story 4.11: a selected measurement that goes away (undo) leaves the selection.
      if (s.doc !== prev.doc && s.selection.ids.length > 0) {
        const ids = new Set(markupsOf(s, s.view.documentId).map((m) => m.id));
        if (s.selection.ids.some((id) => !ids.has(id))) return void setSelection(s.selection.ids.filter((id) => ids.has(id)));
      }
      notifyMarkups({ drawingEnded: prev.tools.drawing !== null && s.tools.drawing === null });
    });
    // Another tool, page, tab or document ends the drawing in progress (and a caption move):
    // a count is kept (D4), the others are cancelled.
    const offViewer = viewerStore.subscribe((s, prev) => {
      if (s.calibrations !== prev.calibrations) notifyMarkups({});
      const moved = s.tool !== prev.tool || s.pageIndex !== prev.pageIndex || s.tabId !== prev.tabId || s.openSeq !== prev.openSeq || s.documentId !== prev.documentId;
      if (moved) setCaptionDrag(null);
      // Story 4.11 (D5): arming another tool, another tab or document clears the selection;
      // Story 5.1 (D4): another page too. A move in progress is dropped.
      const otherDocument = s.tabId !== prev.tabId || s.openSeq !== prev.openSeq || s.documentId !== prev.documentId;
      if (otherDocument || s.pageIndex !== prev.pageIndex || (s.tool !== prev.tool && s.tool !== "select")) setSelection([]);
      if (moved) {
        setMoveDrag(null);
        setPreview(null);
        setMarkupMenu(null);
      }
      const d = drawing();
      if (!d) return;
      if (s.tool === d.tool && !moved) return;
      const documentId = d.pageId.slice(0, d.pageId.lastIndexOf(":"));
      // The count's own tab records it (a tab being closed drops that history; the count stays with its document).
      const tabId = prev.tabId;
      const sameTab = s.tabId === prev.tabId && s.openSeq === prev.openSeq && s.documentId === documentId;
      const otherTab = !sameTab && tabId !== null && prev.documentId === documentId;
      if (d.tool === "count" && (sameTab || otherTab)) commit(documentId, tabId ?? undefined);
      else if (d.tool === "fill") discardFill();
      else setDrawing(null);
    });
    uninstall = () => {
      discardFill();
      resetSelectTool();
      setMoveDrag(null);
      setPreview(null);
      setMarkupMenu(null);
      setDrawing(null);
      setCaptionDrag(null);
      captionBoxes = null;
      offViewer();
      offEditor();
      offUndo();
      offPainter();
    };
  }
  return () => {
    installed--;
    if (installed === 0) {
      uninstall?.();
      uninstall = null;
    }
  };
}

/** The workspace shell: the measuring tools work while the workspace is mounted. */
export function useMeasureTools(): void {
  useLayoutEffect(() => installMeasureTools(), []);
}

/** Shift+Alt+L and the ToolRail: arms Length. */
export function armLength(): void {
  setTool("length");
}

/** Shift+Alt+Q and the ToolRail: arms Polylength. */
export function armPolylength(): void {
  setTool("polylength");
}

/** Shift+Alt+A and the ToolRail: arms Area. */
export function armArea(): void {
  setTool("area");
}

/** Shift+Alt+C and the ToolRail: arms Count. */
export function armCount(): void {
  setTool("count");
}
