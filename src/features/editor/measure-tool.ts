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
// Story 5.4: Line and Arrow (two clicks), Polyline and Polygon (a polygon
// closes on its first vertex, D3: it may cross itself) draw the same way,
// with no live value (D6) and no caption; an arrow has a filled head at its
// end point (D1).
//
// Story 5.5: Rectangle and Ellipse take two opposite corners (clicked, or
// pressed and dragged: the viewer places the second on release) and store the
// box's four corners; a box of no width or height adds nothing. Cloud draws as
// Polygon and paints arcs of a fixed size in page units along its edges. A
// style's fill fills a closed shape under its stroke; its opacity applies to
// the whole markup.
//
// Story 5.6: the text tools place as the others do (Text box as Rectangle,
// Callout by its tip then its text, Typewriter and Note by one click, Cloud+
// as Cloud then its text's click); placed, the markup is typed in the text
// editor (text-tool.ts) and added when the typing ends. A click on the canvas
// while typing only ends the typing.
//
// Story 5.7: Pen and Highlight are pressed and dragged (the viewer sends the
// stroke, never snapped; Shift holds a part of it horizontal or vertical); the
// release adds the stroke, simplified, as one undo step ("Add pen", "Add
// highlight"); a click that drew nothing adds nothing, Esc or a lost pointer
// drops it. A highlight is painted under the other markups, multiplied over
// the sheet (paintUnder), at its style's opacity.
//
// Story 5.8: Image places the picked image (image-tool.ts) with one click,
// then Select has it; Dimension takes its two measured points and a third
// for its line's offset, and shows the calibrated length ("Scale not set"
// without a calibration) on its line between extension lines.
//
// Story 5.9: Underline and Strikethrough select PDF text as they are dragged
// and mark the words selected (text-mark-tool.ts).
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

import { arcFromClicks, arcPoints } from "@/core/markup/arc";
import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { angleCaption, bisector } from "@/core/measure/angle";
import { areaCaption, areaCaptionText, formatArea, polygonCentroid, selfIntersects } from "@/core/measure/area";
import { circleCaption, circleThrough } from "@/core/measure/circle";
import { SCALE_NOT_SET, captionPlacement, lengthCaption, polylineCaptionAnchor } from "@/core/measure/length";
import { outlinePoints, translateMarkup } from "@/core/markup/geometry";
import { dimensionLine, dimensionOutline } from "@/core/markup/dimension";
import { simplifyStroke, smoothPath, strokeHasLength } from "@/core/markup/ink";
import { CLOUD_CHORD_PT, boxCorners, cloudArcs, ellipseFrame } from "@/core/markup/shapes";
import { NOTE_PT, TEXT_LINE_HEIGHT, TEXT_PAD_PT, cloudRingOf, leaderOf, leaderTo, leaderToRing, textBoxOf, wrapText } from "@/core/markup/text";
import {
  COVER_COLOR,
  DEFAULT_COVER_STYLE,
  DEFAULT_HIGHLIGHT_STYLE,
  DEFAULT_MARKUP_STYLE,
  DEFAULT_MEASURE_STYLE,
  MAX_POLYLINE_POINTS,
  isInkMarkup,
  isMeasureMarkup,
  isTextMarkup,
  type DimensionMarkup,
  type InkMarkup,
  type LegendMarkup,
  type Markup,
  type MarkupStyle,
  type MeasureMarkup,
  type RevisionMarkup,
  type ShapeMarkup,
  type TextMarkup,
  isTextMarkMarkup,
} from "@/core/schema/markup";
import {
  isBoxTool,
  isCoverTool,
  isDrawTool,
  isInkTool,
  isMarkupTool,
  isTextTool,
  isTextMarkTool,
  notifyMarkups,
  registerMarkupPainter,
  setTool,
  viewerStore,
  type LayerView,
  type DrawTool,
  type InkTool,
  type MarkupPainter,
} from "@/features/viewer";

import { editorStore, gestureMarkups, isLocked, markupsOf, pageMarkups, setCaptionDrag, type EditorState, setDrawing, setMarkupMenu, setMoveDrag, setPreview, setSelection, type Drawing, type MoveDrag } from "./editor-store";
import { discardFill, fillAreaUser, fillPress, paintFill, takeFillRings, undoFillStroke } from "./fill-tool";
import { handlesOf, paintHandles } from "./handles";
import { ADD_IMAGE, ADD_SIGNATURE, clearPickedImage, forgetDecodedImages, imageMarkupAt, paintImage, pickedImage } from "./image-tool";
import { dropFormat } from "./properties";
import { lockedNote, openMarkupMenu, paintSelectGesture, resetSelectTool, selectCursorAt, selectGesture, selectionKey, toggleSelected } from "./select-tool";
import {
  ADD_CALLOUT,
  ADD_CLOUD_PLUS,
  ADD_NOTE,
  ADD_TEXT,
  ADD_TYPEWRITER,
  NOTE_FIELD_PX,
  beginTextEdit,
  draftOf,
  endTextEdit,
  forgetViews,
  lastViewOf,
  noteView,
  setTextFrame,
  textEditing,
  textLabel,
  type TextFrame,
} from "./text-tool";
import { ADD_REPLACE_TEXT, ADD_SQUIGGLY, ADD_STRIKETHROUGH, ADD_TEXT_HIGHLIGHT, ADD_UNDERLINE, textMarkKind, paintTextMark, paintTextMarkActive, textMarkDrag, textMarkLabel } from "./text-mark-tool";
import { executeOp, registerDrawingUndo } from "./undo-store";
import { askText } from "./text-prompt";
import { cssFontOf, fontFamilyOf } from "./fonts";
import { revisionLabel, revisionText } from "@/core/markup/revision";
import { ZONE_FILL_OPACITY, isZone } from "@/core/sprinkler/zone";
import { ADD_HEAD_LINE, guideOf, makesGuide } from "./guide-draw";
import { ADD_ZONE, makesZone, zoneOf } from "./zone-draw";
import { paintCoverage } from "./coverage-overlay";
import { headDimensionsOf } from "./head-dimensions";
import { headAt, placeHeadAt, placingHeads } from "./head-place";
import { paintRuleMarkers } from "./rule-markers";
import { ADD_REVISION, placeRevision, revisionAt } from "./revision-tool";
import { LEGEND_EMPTY, LEGEND_QTY, LEGEND_TEXT, LEGEND_TOTAL, fitSymbol, legendLabel, legendLayout, legendRows, legendScopeMarkups, legendTotal, type LegendRow, type MeasureText } from "@/core/markup/legend";
import { ADD_LEGEND, legendAt, placeLegend } from "./legend-tool";
import { toast } from "@/components/ui/toast-store";
import { NEEDS_SCALE, anchorTopLeft, placedMarkups, toolScale } from "@/core/tools/place";
import { stampStore, type StampTool } from "@/features/tool-chest/stamp-store";

type Point = { x: number; y: number };

export const ADD_LENGTH = "Add length";
export const ADD_POLYLENGTH = "Add polylength";
export const ADD_AREA = "Add area";
export const ADD_COUNT = "Add count";
export const ADD_ANGLE = "Add angle";
export const ADD_RADIUS = "Add radius";
export const ADD_DIAMETER = "Add diameter";
export const MOVE_CAPTION = "Move caption";
export const ADD_LINE = "Add line";
export const ADD_ARROW = "Add arrow";
export const ADD_POLYLINE = "Add polyline";
export const ADD_POLYGON = "Add polygon";
export const ADD_ARC = "Add arc";
export const ADD_INSERT_TEXT = "Add insert text";
/** Insert text's caret, in points (page units), drawn upright with its tip at its point. */
const CARET_PT = 8;
export const ADD_RECTANGLE = "Add rectangle";
export const ADD_ELLIPSE = "Add ellipse";
export const ADD_CLOUD = "Add cloud";
export const ADD_PEN = "Add pen";
export const ADD_HIGHLIGHT = "Add highlight";
export const ADD_DIMENSION = "Add dimension";
export const ADD_WHITEOUT = "Add white-out";
export const ADD_ERASER = "Add eraser stroke";
/** Story 7.3: a Tool Chest tool placed. */
export const PLACE_TOOL = "Place tool";
/** Story 7.3: S (or Stamp) with no tool chosen yet. */
export const NO_STAMP = "Choose a tool in the Tool Chest first";
const ADD_LABEL: Record<DrawTool, string> = {
  length: ADD_LENGTH,
  polylength: ADD_POLYLENGTH,
  area: ADD_AREA,
  count: ADD_COUNT,
  angle: ADD_ANGLE,
  radius: ADD_RADIUS,
  diameter: ADD_DIAMETER,
  fill: ADD_AREA,
  line: ADD_LINE,
  arrow: ADD_ARROW,
  polyline: ADD_POLYLINE,
  polygon: ADD_POLYGON,
  arc: ADD_ARC,
  rectangle: ADD_RECTANGLE,
  ellipse: ADD_ELLIPSE,
  cloud: ADD_CLOUD,
  text: ADD_TEXT,
  callout: ADD_CALLOUT,
  typewriter: ADD_TYPEWRITER,
  note: ADD_NOTE,
  cloudplus: ADD_CLOUD_PLUS,
  pen: ADD_PEN,
  highlight: ADD_HIGHLIGHT,
  image: ADD_IMAGE,
  dimension: ADD_DIMENSION,
  underline: ADD_UNDERLINE,
  strikethrough: ADD_STRIKETHROUGH,
  texthighlight: ADD_TEXT_HIGHLIGHT,
  squiggly: ADD_SQUIGGLY,
  replacetext: ADD_REPLACE_TEXT,
  inserttext: ADD_INSERT_TEXT,
  whiteout: ADD_WHITEOUT,
  whiteoutpolygon: ADD_WHITEOUT,
  eraser: ADD_ERASER,
  stamp: PLACE_TOOL,
  revision: ADD_REVISION,
  legend: ADD_LEGEND,
};
/** Story 4.8: what the live value says while an area crosses itself (it cannot be added). */
export const CROSSES_ITSELF = "Crosses itself";
/** Vertices a drawing needs before it can be finished. */
const MIN_POINTS: Record<DrawTool, number> = {
  length: 2,
  polylength: 2,
  area: 3,
  count: 1,
  angle: 3,
  radius: 3,
  diameter: 3,
  fill: 0,
  line: 2,
  arrow: 2,
  polyline: 2,
  polygon: 3,
  arc: 3,
  rectangle: 2,
  ellipse: 2,
  cloud: 3,
  text: 2,
  callout: 2,
  typewriter: 1,
  note: 1,
  cloudplus: 3,
  pen: 2,
  highlight: 2,
  image: 1,
  dimension: 3,
  underline: 1,
  strikethrough: 1,
  texthighlight: 1,
  squiggly: 1,
  replacetext: 1,
  inserttext: 1,
  whiteout: 2,
  whiteoutpolygon: 3,
  eraser: 2,
  stamp: 1,
  revision: 1,
  legend: 1,
};
/** Tools with a fixed number of points: the click that places the last one adds the measurement. */
const FIXED_POINTS: Partial<Record<DrawTool, number>> = { arc: 3, length: 2, angle: 3, radius: 3, diameter: 3, line: 2, arrow: 2, rectangle: 2, ellipse: 2, text: 2, callout: 2, typewriter: 1, note: 1, dimension: 3, whiteout: 2 };
/** Tools whose outline is closed: a click on the first vertex closes it. */
const CLOSED: ReadonlySet<DrawTool> = new Set<DrawTool>(["area", "polygon", "cloud", "cloudplus", "whiteoutpolygon"]);
/** Story 5.4 (D1): an arrow head's length in line widths, and its least length, in points (page units). */
const ARROW_HEAD_WIDTHS = 6;
const ARROW_HEAD_MIN_PT = 6;
/** Review R1: zoomed out, the head stays at least this long on screen (CSS px), as the ticks do. */
const ARROW_HEAD_MIN_PX = 8;
/** The head's half-angle. */
const ARROW_HEAD_ANGLE = Math.PI / 7;
/** Story 5.4: what a shape adds to layer 2's list (it has no caption). */
const SHAPE_LABEL: Record<ShapeMarkup["type"], string> = {
  line: "Line",
  arrow: "Arrow",
  polyline: "Polyline",
  polygon: "Polygon",
  arc: "Arc",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  cloud: "Cloud",
};
/** Story 5.7: the layer 2 list's label of a stroke. */
const INK_LABEL: Record<InkMarkup["type"], string> = { pen: "Pen", highlight: "Highlight", eraser: "Eraser" };
/** Story 5.7: a stroke is captured at points this far apart on screen, and kept within this of its path when simplified (CSS px). */
const INK_STEP_PX = 1;
const INK_SIMPLIFY_PX = 0.35;
/** Story 5.8: an extension line starts this far from its measured point and runs this far past the dimension line, in points. */
const DIMENSION_GAP_PT = 2;
const DIMENSION_OVERSHOOT_PT = 3;
/** Story 5.5: zoomed out, cloud arcs smaller than this on screen (CSS px) are drawn as their chords. */
const CLOUD_MIN_CHORD_PX = 3;
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

/** The page's user unit (1 when it has none). */
function userUnitOf(pageIndex: number): number {
  const u = viewerStore.getState().pages[pageIndex]?.userUnit;
  return u && u > 0 ? u : 1;
}

/** Story 9.2: a zone from a finished ring, selected so the 4541 panel shows it. */
function addZone(documentId: string, ring: { pageId: string; outer: readonly Point[]; holes: readonly (readonly Point[])[] }, tabId?: string): void {
  const pageIndex = Number(ring.pageId.slice(ring.pageId.lastIndexOf(":") + 1));
  const zone = zoneOf(documentId, { id: uuidv7(), createdAt: new Date().toISOString(), ...ring }, calibrationOf(documentId, pageIndex), userUnitOf(pageIndex));
  executeOp({ kind: "markups.add", documentId, markups: [zone] }, ADD_ZONE, tabId);
  setSelection([zone.id]);
}

function stroke(c: CanvasRenderingContext2D, style: MarkupStyle, view: LayerView): void {
  c.lineWidth = Math.max(1, style.width * view.devicePerPt);
  c.lineCap = "butt";
  c.lineJoin = "miter";
  c.strokeStyle = style.color;
  // Story 7.5: an imported dash pattern, in page units.
  if (style.dash) c.setLineDash(style.dash.map((d) => d * view.devicePerPt));
  c.stroke();
  if (style.dash) c.setLineDash([]);
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

/**
 * Story 5.4: a line, arrow, polyline or polygon (device points): its stroke; a polygon closed; an
 * arrow's line stops at its head, a filled triangle at the end point (D1). Story 5.5: a rectangle
 * (its corners), an ellipse (in its box) or a cloud (arcs along its edges, D1); a closed shape is
 * filled under its stroke when the style has a fill; the style's opacity applies to it all.
 */
function strokeShape(c: CanvasRenderingContext2D, type: ShapeMarkup["type"], pts: readonly Point[], style: MarkupStyle, view: LayerView): void {
  if (pts.length < 2) return;
  const n = pts.length;
  let end = pts[n - 1];
  let head: Point[] | null = null;
  if (type === "arrow") {
    const from = pts[n - 2];
    const tip = pts[n - 1];
    const d = Math.hypot(tip.x - from.x, tip.y - from.y);
    if (d > 1e-6) {
      const length = Math.min(d, Math.max(ARROW_HEAD_MIN_PX * view.dpr, Math.max(ARROW_HEAD_MIN_PT, ARROW_HEAD_WIDTHS * style.width) * view.devicePerPt));
      const ux = (tip.x - from.x) / d;
      const uy = (tip.y - from.y) / d;
      const half = length * Math.tan(ARROW_HEAD_ANGLE);
      const base = { x: tip.x - ux * length, y: tip.y - uy * length };
      head = [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }];
      end = base;
    }
  }
  const opacity = style.opacity ?? 1;
  c.save();
  if (opacity < 1) c.globalAlpha = opacity;
  c.beginPath();
  if (type === "ellipse") {
    // The unit circle mapped into the box (the path keeps the mapping; the stroke does not).
    const f = ellipseFrame(pts);
    c.save();
    c.transform(f.u.x, f.u.y, f.v.x, f.v.y, f.centre.x, f.centre.y);
    c.moveTo(1, 0);
    c.arc(0, 0, 1, 0, 2 * Math.PI);
    c.restore();
  } else if (type === "cloud" && CLOUD_CHORD_PT * view.devicePerPt >= CLOUD_MIN_CHORD_PX * view.dpr) {
    for (const a of cloudArcs(pts, CLOUD_CHORD_PT * view.devicePerPt)) c.arc(a.centre.x, a.centre.y, a.radius, a.start, a.end, a.anticlockwise);
    c.closePath();
  } else {
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) c.lineTo(pts[i].x, pts[i].y);
    c.lineTo(end.x, end.y);
    if (type === "polygon" || type === "rectangle" || type === "cloud") c.closePath();
  }
  if (style.fill && type !== "line" && type !== "arrow" && type !== "polyline") {
    c.fillStyle = style.fill;
    c.fill();
  }
  stroke(c, style, view);
  if (head) {
    c.beginPath();
    c.moveTo(head[0].x, head[0].y);
    c.lineTo(head[1].x, head[1].y);
    c.lineTo(head[2].x, head[2].y);
    c.closePath();
    c.fillStyle = style.color;
    c.fill();
  }
  c.restore();
}

/** Story 5.7: a stroke (device points), smoothed through its points, round ends; a highlight at its style's opacity. */
function strokeInk(c: CanvasRenderingContext2D, pts: readonly Point[], style: MarkupStyle, view: LayerView): void {
  const path = smoothPath(pts);
  if (!path) return;
  c.save();
  if ((style.opacity ?? 1) < 1) c.globalAlpha = style.opacity ?? 1;
  c.beginPath();
  c.moveTo(path.start.x, path.start.y);
  for (const q of path.curves) c.quadraticCurveTo(q.control.x, q.control.y, q.to.x, q.to.y);
  c.lineWidth = Math.max(1, style.width * view.devicePerPt);
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = style.color;
  c.stroke();
  c.restore();
}

/**
 * Story 5.8: a dimension (user points: the measured two, then the line's): extension lines from
 * near the measured points to a little past its line, the line with an arrow head at each end and
 * its caption above the line's middle, readable.
 */
function paintDimension(c: CanvasRenderingContext2D, points: readonly Point[], style: MarkupStyle, view: LayerView, caption: { text: string; scaled: boolean }): void {
  const [a, b, at] = points;
  const line = dimensionLine(a, b, at);
  if (!line) return;
  const u = view.userUnit > 0 ? view.userUnit : 1;
  const gap = Math.min(DIMENSION_GAP_PT / u, line.offset);
  const past = DIMENSION_OVERSHOOT_PT / u;
  const n = line.normal;
  const ext = [
    [a, line.from],
    [b, line.to],
  ].map(([p, q]) => devicePoints([{ x: p.x + n.x * gap, y: p.y + n.y * gap }, { x: q.x + n.x * past, y: q.y + n.y * past }], view));
  c.beginPath();
  for (const [p, q] of ext) {
    c.moveTo(p.x, p.y);
    c.lineTo(q.x, q.y);
  }
  stroke(c, style, view);
  const [from, to] = devicePoints([line.from, line.to], view);
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  strokeShape(c, "arrow", [mid, from], style, view);
  strokeShape(c, "arrow", [mid, to], style, view);
  const size = style.fontSize * view.devicePerPt;
  const frame = captionPlacement(from, to, Math.max(1, style.width * view.devicePerPt) / 2 + size * 0.2);
  drawCaption(c, { ...frame, size }, [caption.text], caption.scaled, style, view);
}

/** Story 5.6: a text's lines in its box (device corners, p0→p1 along the lines), plain text (NFR27). */
function drawText(c: CanvasRenderingContext2D, box: readonly Point[], text: string, wrap: boolean, style: MarkupStyle, view: LayerView): void {
  const size = style.fontSize * view.devicePerPt;
  if (size < 1 || text === "") return;
  const [d0, d1] = box;
  const width = Math.hypot(d1.x - d0.x, d1.y - d0.y);
  const pad = wrap ? TEXT_PAD_PT * view.devicePerPt : 0;
  c.save();
  if ((style.opacity ?? 1) < 1) c.globalAlpha = style.opacity ?? 1;
  c.translate(d0.x, d0.y);
  c.rotate(Math.atan2(d1.y - d0.y, d1.x - d0.x));
  c.font = cssFontOf(style, size, view.colors.fontFamily);
  c.textAlign = "left";
  c.textBaseline = "top";
  c.fillStyle = style.color;
  const lines = wrapText(text, wrap ? Math.max(size, width - 2 * pad) : null, (s) => c.measureText(s).width);
  // Text format bar: alignment in the box (a typewriter's box is its widest line), underline, strikethrough.
  const widths = lines.map((line) => c.measureText(line).width);
  const room = wrap ? width - 2 * pad : Math.max(0, ...widths);
  const thick = Math.max(1, size / 18);
  lines.forEach((line, i) => {
    const x = pad + (style.align === "center" ? (room - widths[i]) / 2 : style.align === "right" ? room - widths[i] : 0);
    const y = pad + i * size * TEXT_LINE_HEIGHT;
    c.fillText(line, x, y);
    if (style.underline && widths[i] > 0) c.fillRect(x, y + size * 0.95, widths[i], thick);
    if (style.strike && widths[i] > 0) c.fillRect(x, y + size * 0.52, widths[i], thick);
  });
  c.restore();
}

/**
 * Story 7.7: a revision stamp (device corners p0 top left, p1 top right, p3 bottom left): its box,
 * a header row with the revision on the left and the date on the right, a rule under it, then the
 * description and the author, clipped to the box.
 */
function paintRevision(c: CanvasRenderingContext2D, m: RevisionMarkup, box: readonly Point[], view: LayerView): void {
  strokeShape(c, "rectangle", box, m.style, view);
  const size = m.style.fontSize * view.devicePerPt;
  if (size < 1) return;
  const [d0, d1, , d3] = box;
  const width = Math.hypot(d1.x - d0.x, d1.y - d0.y);
  const height = Math.hypot(d3.x - d0.x, d3.y - d0.y);
  const pad = TEXT_PAD_PT * view.devicePerPt;
  const line = size * TEXT_LINE_HEIGHT;
  const header = Math.min(height, line + 2 * pad);
  const { left, right, lines } = revisionText(m.revision);
  c.save();
  if ((m.style.opacity ?? 1) < 1) c.globalAlpha = m.style.opacity ?? 1;
  c.translate(d0.x, d0.y);
  c.rotate(Math.atan2(d1.y - d0.y, d1.x - d0.x));
  c.beginPath();
  c.rect(0, 0, width, height);
  c.clip();
  c.beginPath();
  c.moveTo(0, header);
  c.lineTo(width, header);
  stroke(c, m.style, view);
  c.fillStyle = m.style.color;
  c.textBaseline = "top";
  const family = fontFamilyOf(m.style, view.colors.fontFamily);
  c.font = `bold ${size}px ${family}`;
  c.textAlign = "left";
  c.fillText(left, pad, pad);
  c.font = `${size}px ${family}`;
  c.textAlign = "right";
  c.fillText(right, width - pad, pad);
  c.textAlign = "left";
  lines.forEach((text, i) => c.fillText(text, pad, header + pad + i * line));
  c.restore();
}

/** Story 7.8: the rows a legend shows now (its page's or its document's device placements). */
function legendRowsOf(m: LegendMarkup, documentId: string): LegendRow[] {
  return legendRows(legendScopeMarkups(markupsOf(editorStore.getState(), documentId), m.legend.scope, m.pageId));
}

/**
 * Story 7.8 (FR38, UX-DR27): a legend (device corners p0 top left, p1 top right, p3 bottom left):
 * its box, a title row ("QTY" on the right), a row per device type (its symbol, its label, its
 * count) and a total row, laid out in legend units and scaled to fit the box, clipped to it.
 */
function paintLegend(c: CanvasRenderingContext2D, m: LegendMarkup, rows: readonly LegendRow[], box: readonly Point[], view: LayerView): void {
  strokeShape(c, "rectangle", box, m.style, view);
  const [d0, d1, , d3] = box;
  const width = Math.hypot(d1.x - d0.x, d1.y - d0.y);
  const height = Math.hypot(d3.x - d0.x, d3.y - d0.y);
  const family = fontFamilyOf(m.style, view.colors.fontFamily);
  const font = (bold: boolean) => `${bold ? "bold " : ""}${LEGEND_TEXT}px ${family}`;
  c.save();
  const measure: MeasureText = (text, bold) => {
    c.font = font(bold);
    return c.measureText(text).width || 0;
  };
  const layout = legendLayout(rows, m.legend.title, measure);
  const s = Math.min(width / layout.width, height / layout.height);
  if (!(s > 0) || LEGEND_TEXT * s < 1) return void c.restore();
  if ((m.style.opacity ?? 1) < 1) c.globalAlpha = m.style.opacity ?? 1;
  c.translate(d0.x, d0.y);
  c.rotate(Math.atan2(d1.y - d0.y, d1.x - d0.x));
  c.beginPath();
  c.rect(0, 0, width, height);
  c.clip();
  c.scale(s, s);
  // Rules: in legend units, at the markup's width on screen.
  const inner: LayerView = { ...view, devicePerPt: view.devicePerPt / s, dpr: view.dpr / s };
  const rule = (x0: number, y0: number, x1: number, y1: number) => {
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    stroke(c, m.style, inner);
  };
  const { pad, header, row, symbol, qty, textX, countX, rowsY, totalY } = layout;
  const end = header + rowsY.length * row;
  rule(0, header, layout.width, header);
  for (const y of rowsY.slice(1)) rule(0, y, layout.width, y);
  rule(symbol, header, symbol, end);
  rule(layout.width - qty, header, layout.width - qty, end);
  if (totalY !== null) rule(0, totalY, layout.width, totalY);
  c.fillStyle = m.style.color;
  c.textBaseline = "middle";
  const text = (t: string, x: number, y: number, bold: boolean, align: CanvasTextAlign) => {
    c.font = font(bold);
    c.textAlign = align;
    c.fillText(t, x, y);
  };
  text(m.legend.title, pad, header / 2, true, "left");
  text(LEGEND_QTY, countX, header / 2, true, "right");
  if (rows.length === 0) text(LEGEND_EMPTY, textX, rowsY[0] + row / 2, false, "left");
  rows.forEach((r, i) => {
    const mid = rowsY[i] + row / 2;
    text(r.text, textX, mid, false, "left");
    text(String(r.count), countX, mid, true, "right");
    paintLegendSymbol(c, r.symbol, { x: symbol / 2, y: mid }, Math.min(symbol, row) - 2 * pad, view);
  });
  if (totalY !== null) {
    text(LEGEND_TOTAL, textX, totalY + header / 2, true, "left");
    text(String(legendTotal(rows)), countX, totalY + header / 2, true, "right");
  }
  c.restore();
}

/** Story 7.8: a device placement drawn as a legend row's symbol, fitted in a `size` square at `centre` (legend units). */
function paintLegendSymbol(c: CanvasRenderingContext2D, symbol: readonly Markup[], centre: Point, size: number, view: LayerView): void {
  const fit = fitSymbol(symbol.flatMap((m) => devicePoints(m.points, view)), centre, size);
  if (!fit) return;
  const sub: LayerView = { ...view, toDevice: (p) => fit.map(view.toDevice(p)), devicePerPt: view.devicePerPt * fit.scale, dpr: view.dpr * fit.scale, width: 0, height: 0 };
  paintList(c, symbol, sub, null, { selected: new Set(), captions: [], boxes: [], selectedShown: [] });
}

/** A caret (^) in `style`'s colour, its tip at `at` (device), upright on screen. */
function drawCaret(c: CanvasRenderingContext2D, at: Point, style: MarkupStyle, view: LayerView): void {
  const h = Math.max(6 * view.dpr, CARET_PT * view.devicePerPt);
  c.save();
  if ((style.opacity ?? 1) < 1) c.globalAlpha = style.opacity ?? 1;
  c.beginPath();
  c.moveTo(at.x - h / 2, at.y + h);
  c.lineTo(at.x, at.y);
  c.lineTo(at.x + h / 2, at.y + h);
  c.lineWidth = Math.max(1, h / 6);
  c.lineJoin = "round";
  c.strokeStyle = style.color;
  c.stroke();
  c.restore();
}

/** Story 5.6 (D7): a note's icon, a page (folded corner) in page units, upright, centred on its point. */
function drawNote(c: CanvasRenderingContext2D, at: Point, style: MarkupStyle, view: LayerView): void {
  const side = Math.max(8 * view.dpr, NOTE_PT * view.devicePerPt);
  const x = at.x - side / 2;
  const y = at.y - side / 2;
  const fold = side / 4;
  c.save();
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + side - fold, y);
  c.lineTo(x + side, y + fold);
  c.lineTo(x + side, y + side);
  c.lineTo(x, y + side);
  c.closePath();
  c.fillStyle = view.colors.halo;
  c.fill();
  stroke(c, style, view);
  c.beginPath();
  for (let i = 1; i <= 3; i++) {
    const ly = y + (side * (i + 0.5)) / 5;
    c.moveTo(x + side / 5, ly);
    c.lineTo(x + side - side / 5, ly);
  }
  c.lineWidth = Math.max(1, view.dpr);
  c.strokeStyle = style.color;
  c.stroke();
  c.restore();
}

/** Story 5.6: a text markup: its cloud and leader, its box's border (a typewriter has none) and, `withText`, its text. */
function paintTextMarkup(c: CanvasRenderingContext2D, m: TextMarkup, view: LayerView, withText: boolean): void {
  if (m.type === "note") return drawNote(c, view.toDevice(m.points[0]), m.style, view);
  const box = devicePoints(textBoxOf(m)!, view);
  if (m.type === "cloudplus") strokeShape(c, "cloud", devicePoints(cloudRingOf(m), view), m.style, view);
  const leader = leaderOf(m);
  if (leader) strokeShape(c, m.type === "callout" ? "arrow" : "line", devicePoints(leader, view), m.style, view);
  if (m.type !== "typewriter") strokeShape(c, "rectangle", box, m.style, view);
  if (withText) drawText(c, box, m.text, m.type !== "typewriter", m.style, view);
}

/** Story 5.6: the text editor's frame over a draft as painted (viewport CSS px). */
function textFrameOf(m: TextMarkup, view: LayerView): TextFrame {
  const k = view.dpr || 1;
  const fontPx = (m.style.fontSize * view.devicePerPt) / k;
  if (m.type === "note") {
    const at = view.toDevice(m.points[0]);
    const half = Math.max(8 * view.dpr, NOTE_PT * view.devicePerPt) / 2;
    return { x: (at.x + half) / k + 4, y: (at.y - half) / k, width: NOTE_FIELD_PX, height: 0, angle: 0, fontPx: Math.max(12, fontPx), padPx: 4, color: m.style.color, kind: m.type };
  }
  const [d0, d1, , d3] = devicePoints(textBoxOf(m)!, view);
  const pad = m.type === "typewriter" ? 0 : (TEXT_PAD_PT * view.devicePerPt) / k;
  return {
    x: d0.x / k,
    y: d0.y / k,
    width: Math.hypot(d1.x - d0.x, d1.y - d0.y) / k,
    height: Math.hypot(d3.x - d0.x, d3.y - d0.y) / k,
    angle: Math.atan2(d1.y - d0.y, d1.x - d0.x),
    fontPx,
    padPx: pad,
    color: m.style.color,
    kind: m.type,
    font: fontFamilyOf(m.style, view.colors.fontFamily),
    bold: !!m.style.bold,
    italic: !!m.style.italic,
    underline: !!m.style.underline,
    strike: !!m.style.strike,
    align: m.style.align ?? "left",
  };
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
function shown(m: Markup): Markup {
  const { captionDrag: drag, moveDrag, preview } = editorStore.getState().tools;
  // Story 5.2: a resize, rotation or vertex drag in progress.
  const changed = preview && m.pageId.startsWith(`${preview.documentId}:`) ? preview.changed[m.id] : undefined;
  let out = changed ?? m;
  out = drag && drag.id === m.id && isMeasureMarkup(out) ? { ...out, captionOffset: addOffset(out.captionOffset, drag.delta) } : out;
  if (moveDrag) {
    if (moving?.drag !== moveDrag) moving = { drag: moveDrag, ids: new Set(moveDrag.ids) };
    if (moving.ids.has(m.id) && m.pageId.startsWith(`${moveDrag.documentId}:`)) out = translateMarkup(out, moveDrag.delta);
  }
  return out;
}

const isMeasure = isMeasureMarkup;

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
function liveValue(tool: DrawTool, points: readonly Point[], calibration: Calibration | null, userUnit: number): { text: string; scaled: boolean } | null {
  // Story 5.4 (D6): a markup has no value.
  if (isMarkupTool(tool)) return null;
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

/** What painting a list of markups collects (layer 2's captions, caption boxes, the selection painted). */
type PaintSink = { selected: ReadonlySet<string>; captions: string[]; boxes: CaptionBox[]; selectedShown: Markup[] };

/** Paints `markups` in order (the page's static layer, and Story 7.2's tool previews). */
function paintList(c: CanvasRenderingContext2D, markups: readonly Markup[], view: LayerView, calibration: Calibration | null, sink: PaintSink): void {
  const { selected, captions, boxes, selectedShown } = sink;
  c.save();
  for (const one of markups) {
    const any = shown(one);
    if (selected.has(any.id)) selectedShown.push(any);
    if (isTextMarkup(any)) {
      // Story 5.6: a text markup, its label and text in layer 2's list.
      captions.push(textLabel(any));
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) {
        const half = any.type === "note" ? Math.max(8 * view.dpr, NOTE_PT * view.devicePerPt) / 2 : 0;
        const around = half > 0 ? [{ x: pts[0].x - half, y: pts[0].y - half }, { x: pts[0].x + half, y: pts[0].y + half }] : pts;
        strokeSelection(c, around, view);
      }
      paintTextMarkup(c, any, view, true);
      continue;
    }
    if (isInkMarkup(any)) {
      // Story 5.7: a stroke; a highlight's is painted under the markups (paintUnder).
      captions.push(INK_LABEL[any.type]);
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      if (any.type !== "highlight") strokeInk(c, pts, any.style, view);
      continue;
    }
    if (any.type === "image") {
      // Story 5.8: an image, upright in its box (5.13: a signature stamp says whose).
      captions.push(any.signature ? `Signature: ${any.signature.signer}` : "Image");
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      paintImage(c, any, pts, view);
      continue;
    }
    if (isTextMarkMarkup(any)) {
      // Story 5.9: marked PDF text.
      captions.push(textMarkLabel(any));
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      paintTextMark(c, any.type, pts, any.style, view);
      // Replace text: a caret at the end of the struck words (their last box's bottom right).
      if (any.type === "strikethrough" && any.replacement !== undefined) drawCaret(c, pts[pts.length - 3], any.style, view);
      continue;
    }
    if (any.type === "caret") {
      // Insert text: a caret where the text goes.
      captions.push(`Insert: ${any.text.length > 40 ? `${any.text.slice(0, 40)}…` : any.text}`);
      const at = view.toDevice(any.points[0]);
      const half = Math.max(6 * view.dpr, CARET_PT * view.devicePerPt);
      const box = [
        { x: at.x - half, y: at.y - half / 4 },
        { x: at.x + half, y: at.y + half },
      ];
      if (!onCanvas(box, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, [box[0], { x: box[1].x, y: box[0].y }, box[1], { x: box[0].x, y: box[1].y }], view);
      drawCaret(c, at, any.style, view);
      continue;
    }
    if (any.type === "dimension") {
      // Story 5.8: a dimension and its calibrated length (never stored).
      const caption = dimensionCaption(any, calibration, view.userUnit);
      captions.push(`Dimension: ${caption.text}`);
      const pts = devicePoints(dimensionOutline(any.points), view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      paintDimension(c, any.points, any.style, view, caption);
      continue;
    }
    if (any.type === "whiteout") {
      // Story 5.11: a cover, the sheet's white over what it hides.
      captions.push("White-out");
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      paintCover(c, pts);
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      continue;
    }
    if (any.type === "revision") {
      // Story 7.7: a revision stamp, its fields drawn in its box.
      captions.push(revisionLabel(any.revision));
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      paintRevision(c, any, pts, view);
      continue;
    }
    if (any.type === "legend") {
      // Story 7.8: a legend, its rows counted from the markups now.
      const rows = legendRowsOf(any, view.documentId);
      captions.push(legendLabel(any.legend, legendTotal(rows)));
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, pts, view);
      paintLegend(c, any, rows, pts, view);
      continue;
    }
    if (any.type === "zone") {
      // Story 9.2: a zone's outline (its fill is under the markups) and its name.
      captions.push(any.zone.name);
      const rings = [any.points, ...(any.holes ?? [])].map((r) => devicePoints(r, view));
      if (!onCanvas(rings[0], any.style, view)) continue;
      if (selected.has(any.id)) strokeSelection(c, rings[0], view);
      strokeRings(c, rings, any.style, view);
      paintZoneName(c, any.zone.name, devicePoints([polygonCentroid(any.points)], view)[0], any.style, view);
      continue;
    }
    if (!isMeasure(any)) {
      // Story 5.4: a shape, no caption (its label stands in layer 2's list).
      captions.push(SHAPE_LABEL[any.type]);
      const pts = devicePoints(any.points, view);
      if (!onCanvas(pts, any.style, view)) continue;
      // Story 5.5: an ellipse's outline lies inside its box's corners.
      const outline = any.type === "ellipse" || any.type === "arc" ? devicePoints(outlinePoints(any), view) : pts;
      if (selected.has(any.id)) strokeSelection(c, outline, view);
      if (any.type === "arc") strokeShape(c, "polyline", outline, any.style, view);
      else strokeShape(c, any.type, pts, any.style, view);
      continue;
    }
    const m = any;
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
}

/** Story 7.2: a tool's markups on a preview canvas (no selection, no caption hit boxes). */
export function paintMarkupsPreview(c: CanvasRenderingContext2D, markups: readonly Markup[], view: LayerView, calibration: Calibration | null): void {
  paintList(c, markups, view, calibration, { selected: new Set(), captions: [], boxes: [], selectedShown: [] });
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
      noteView(view);
      return [];
    }
    const pageId = pageIdOf(view.documentId, view.pageIndex);
    const calibration = calibrationOf(view.documentId, view.pageIndex);
    noteView(view);
    const captions: string[] = [];
    const boxes: CaptionBox[] = [];
    const selected = new Set(editorStore.getState().selection.ids);
    const selectedShown: Markup[] = [];
    // Story 9.9: the coverage overlay, under the markups (the heads are drawn over it).
    // Story 9.10: heads being dragged carry their coverage with them.
    paintCoverage(c, view, gestureMarkups(editorStore.getState(), view.documentId, stored), calibration);
    paintList(c, markups, view, calibration, { selected, captions, boxes, selectedShown });
    // Head dimensions (the 4541 panel's toggle), over the markups; they are not picked or listed.
    const dims = headDimensionsOf(gestureMarkups(editorStore.getState(), view.documentId, stored), () => ({ calibration, userUnit: view.userUnit }));
    if (dims.length > 0) paintList(c, dims, view, calibration, { selected: new Set(), captions: [], boxes: [], selectedShown: [] });
    // Story 5.2: the selection's handles, over everything.
    const handles = handlesOf(selectedShown.filter((m) => !isLocked(m)), view);
    if (handles) paintHandles(c, handles, view);
    // Story 9.11: rule breaks pinned over everything.
    paintRuleMarkers(c, view, calibration);
    captionBoxes = { pageId, boxes };
    return captions;
  },

  paintUnder(c, view) {
    const pageId = pageIdOf(view.documentId, view.pageIndex);
    const preview = editorStore.getState().tools.preview;
    const added = preview && preview.documentId === view.documentId ? preview.added.filter((m) => m.pageId === pageId) : [];
    for (const one of [...pageMarkups(editorStore.getState(), view.documentId, pageId), ...added]) {
      if (isZone(one)) {
        const z = shown(one);
        if (isZone(z)) paintZoneFill(c, [z.points, ...(z.holes ?? [])].map((r) => devicePoints(r, view)), z.style.color);
        continue;
      }
      if (one.type !== "highlight") continue;
      const m = shown(one);
      const pts = devicePoints(m.points, view);
      if (onCanvas(pts, m.style, view)) strokeInk(c, pts, m.style, view);
    }
  },

  paintActive(c, view, pointer) {
    // Story 5.1: the marquee or lasso in progress.
    if (viewerStore.getState().tool === "select") paintSelectGesture(c, view);
    // Story 5.6: the text being typed: its box (the field shows the text) and where the field goes.
    const edit = textEditing();
    if (edit) {
      if (edit.draft.pageId !== pageIdOf(view.documentId, view.pageIndex)) {
        setTextFrame(null);
      } else {
        paintTextMarkup(c, edit.draft, view, false);
        setTextFrame(textFrameOf(edit.draft, view));
      }
    }
    // Story 7.3: the armed tool under the pointer, where a click places it.
    // A Tool Chest tile dragged over the drawing: the ghost of the drop, whatever the tool.
    const dragged = stampStore.getState().dragging;
    if (dragged) {
      if (pointer) paintStampGhost(c, dragged, pointer, view);
      return null;
    }
    if (viewerStore.getState().tool === "stamp") {
      // Story 9.10: the head a click would add, at half strength.
      if (placingHeads()) {
        const ghost = pointer ? headAt(pointer, view.documentId, view.pageIndex) : null;
        if (ghost) {
          c.save();
          c.globalAlpha = 0.5;
          paintMarkupsPreview(c, [ghost], view, calibrationOf(view.documentId, view.pageIndex));
          c.restore();
        }
        return null;
      }
      const armed = stampStore.getState().armed;
      if (armed && pointer) paintStampGhost(c, armed, pointer, view);
      return null;
    }
    // Story 7.7: the stamp under the pointer, at half strength.
    if (viewerStore.getState().tool === "revision") {
      if (pointer) {
        const ghost = revisionAt(pointer, view.documentId, pageIdOf(view.documentId, view.pageIndex));
        c.save();
        c.globalAlpha = 0.5;
        paintRevision(c, ghost, devicePoints(ghost.points, view), view);
        c.restore();
      }
      return null;
    }
    // Story 7.8: the legend under the pointer, at half strength.
    if (viewerStore.getState().tool === "legend") {
      if (pointer) {
        const ghost = legendAt(pointer, view.documentId, pageIdOf(view.documentId, view.pageIndex));
        c.save();
        c.globalAlpha = 0.5;
        paintLegend(c, ghost, legendRowsOf(ghost, view.documentId), devicePoints(ghost.points, view), view);
        c.restore();
      }
      return null;
    }
    const d = drawing();
    if (d?.tool === "fill") return paintFillActive(c, view, pointer);
    // Story 5.9: the words selected so far.
    if (d && isTextMarkTool(d.tool) && d.pageId === pageIdOf(view.documentId, view.pageIndex)) {
      if (d.quads) paintTextMarkActive(c, textMarkKind(d.tool), devicePoints(d.quads, view), view);
      return d.selected ?? null;
    }
    // Story 5.7: the stroke so far (a highlight's at its opacity, not yet multiplied).
    if (d && isInkTool(d.tool) && d.pageId === pageIdOf(view.documentId, view.pageIndex)) {
      strokeInk(c, devicePoints(d.points, view), inkStyle(d.tool), view);
      return null;
    }
    if (!d || d.pageId !== pageIdOf(view.documentId, view.pageIndex) || !pointer) return null;
    // Story 5.6: a Cloud+'s closed cloud and a leader to the pointer (where its text goes).
    if (d.ring) {
      strokeShape(c, "cloud", devicePoints(d.ring, view), DEFAULT_MARKUP_STYLE, view);
      strokeShape(c, "line", devicePoints(leaderToRing([pointer, pointer, pointer, pointer], d.ring), view), DEFAULT_MARKUP_STYLE, view);
      return null;
    }
    if (d.points.length === 0) return null;
    const points = [...d.points, pointer];
    if (d.tool === "callout") {
      // The leader from the pointer (where the text goes) to the tip.
      strokeShape(c, "arrow", devicePoints(leaderTo([pointer, pointer, pointer, pointer], d.points[0]), view), DEFAULT_MARKUP_STYLE, view);
      return null;
    }
    // Story 5.8: a dimension: its measured line, then its offset, with the live length.
    if (d.tool === "dimension") {
      const live = lengthCaption(points.slice(0, 2), calibrationOf(view.documentId, view.pageIndex), view.userUnit);
      c.save();
      if (points.length >= 3) paintDimension(c, points, DEFAULT_MARKUP_STYLE, view, live);
      else strokeShape(c, "line", devicePoints(points, view), DEFAULT_MARKUP_STYLE, view);
      c.restore();
      liveLabel(c, view.toDevice(pointer), live.text, live.scaled, view);
      return live.text;
    }
    // An arc: its chord to the pointer, then the arc from start to end through the pointer.
    if (d.tool === "arc") {
      const arc = points.length >= 3 ? arcPoints(points[0], pointer, points[1]) : points;
      strokeShape(c, "polyline", devicePoints(arc, view), DEFAULT_MARKUP_STYLE, view);
      return null;
    }
    // Story 5.5: a box from its first corner to the pointer (5.6: a text box's too).
    const pts = devicePoints(isBoxTool(d.tool) ? boxCorners(points[0], pointer) : points, view);
    const live = liveValue(d.tool, points, calibrationOf(view.documentId, view.pageIndex), view.userUnit);
    c.save();
    if (d.tool === "area") strokeRings(c, [pts], DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "count") drawMarkers(c, pts.slice(0, -1), DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "angle") strokeAngle(c, pts, DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "radius" || d.tool === "diameter") strokeCircle(c, d.tool, pts, deviceCircle(points, view), DEFAULT_MEASURE_STYLE, view);
    else if (d.tool === "text") strokeShape(c, "rectangle", pts, DEFAULT_MARKUP_STYLE, view);
    else if (d.tool === "cloudplus") strokeShape(c, "cloud", pts, DEFAULT_MARKUP_STYLE, view);
    else if (d.tool === "whiteout" || d.tool === "whiteoutpolygon") {
      // Story 5.11: the cover so far, outlined (the outline is not kept).
      paintCover(c, pts);
      strokeShape(c, d.tool === "whiteout" ? "rectangle" : "polyline", pts, DEFAULT_MARKUP_STYLE, view);
    }
    else if (isMarkupTool(d.tool) && !isTextTool(d.tool) && !isInkTool(d.tool) && !isCoverTool(d.tool) && d.tool !== "image" && d.tool !== "stamp" && d.tool !== "revision" && d.tool !== "legend" && d.tool !== "inserttext" && !isTextMarkTool(d.tool)) strokeShape(c, d.tool, pts, DEFAULT_MARKUP_STYLE, view);
    else strokeMeasure(c, pts, DEFAULT_MEASURE_STYLE, view);
    c.restore();
    if (!live) return null;
    liveLabel(c, pts[pts.length - 1], live.text, live.scaled, view);
    return live.text;
  },

  get tracking() {
    return drawing() !== null;
  },

  // A ghost under the pointer (a held tool, a head, a revision, a legend, a dragged tile) follows every move.
  get followsPointer() {
    const tool = viewerStore.getState().tool;
    return stampStore.getState().dragging !== null || tool === "stamp" || tool === "revision" || tool === "legend";
  },

  get lastPoint() {
    return drawing()?.points.at(-1) ?? null;
  },

  // Story 7.3: a tile dragged from the Tool Chest is placed once, whatever the tool.
  drop(point, at) {
    const dragged = stampStore.getState().dragging;
    return dragged ? placeStamp(dragged, point, at.documentId, at.pageIndex) : false;
  },

  place(point, at) {
    // Story 5.6: a click while typing ends the typing, and only that.
    if (textEditing()) {
      endTextEdit(true);
      return "ignored";
    }
    const tool = viewerStore.getState().tool;
    // Dynamic fill is pressed, not clicked (press below); Pen and Highlight are dragged (ink below).
    if (!isDrawTool(tool) || tool === "fill" || isInkTool(tool) || isTextMarkTool(tool)) return "ignored";
    const pageId = pageIdOf(at.documentId, at.pageIndex);
    // Story 5.8: the picked image, centred on the click; then Select has it (to resize).
    if (tool === "image") return placeImage(point, at.documentId, pageId);
    // Story 7.3: the armed tool, its top-left corner at the click; it stays armed (Esc returns to Select).
    // Story 9.10: in head mode (the 4541 panel's Add head) a click adds a manual head.
    if (tool === "stamp" && placingHeads()) return placeHeadAt(point, at.documentId, at.pageIndex) ? "done" : "ignored";
    if (tool === "stamp") return placeStamp(stampStore.getState().armed, point, at.documentId, at.pageIndex) ? "done" : "ignored";
    // Story 7.7: a revision stamp centred on the click.
    if (tool === "revision") return placeRevision(point, at.documentId, pageId);
    // Story 7.8: a legend centred on the click.
    if (tool === "legend") return placeLegend(point, at.documentId, pageId);
    // Insert text: a caret at the click, with the text asked for.
    if (tool === "inserttext") {
      const documentId = at.documentId;
      const tabId = viewerStore.getState().tabId ?? undefined;
      askText({
        title: "Insert text",
        label: "Text to insert here",
        onSubmit: (text) => {
          const caret: Markup = { id: uuidv7(), pageId, createdAt: new Date().toISOString(), style: DEFAULT_MARKUP_STYLE, type: "caret", points: [point], text };
          executeOp({ kind: "markups.add", documentId, markups: [caret] }, ADD_INSERT_TEXT, tabId);
        },
      });
      return "done";
    }
    const d = drawing();
    if (!d || d.pageId !== pageId || d.tool !== tool) {
      setDrawing({ tool, pageId, pageIndex: at.pageIndex, points: [point] });
      // Story 5.6: Typewriter and Note are placed by one click.
      return FIXED_POINTS[tool] === 1 ? commit(at.documentId) : "continue";
    }
    // Story 5.6: a Cloud+'s closed cloud: this click places its text.
    if (d.ring) {
      setDrawing({ ...d, points: [point] });
      return commit(at.documentId);
    }
    // A click on the last point adds nothing (a double-click's second click): keep drawing.
    const last = d.points[d.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) <= at.tolerance) return "continue";
    // Story 4.8 (D2): a click on an area's first vertex closes it (5.4: a polygon's too).
    const first = d.points[0];
    if (CLOSED.has(tool) && d.points.length >= MIN_POINTS[tool] && Math.hypot(point.x - first.x, point.y - first.y) <= at.tolerance) {
      return finishDrawing(at.documentId);
    }
    const points = [...d.points, point];
    const fixed = FIXED_POINTS[tool];
    if (fixed !== undefined && points.length >= fixed) {
      // Story 4.9: three points in a line make no circle; the click adds nothing.
      if ((tool === "radius" || tool === "diameter") && !circleThrough(points[0], points[1], points[2])) return "continue";
      // Story 5.5: nor do two corners of a box with no width or height.
      if (isBoxTool(tool) && (Math.abs(points[1].x - points[0].x) <= at.tolerance || Math.abs(points[1].y - points[0].y) <= at.tolerance)) return "continue";
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
    if (!d || d.ring || FIXED_POINTS[d.tool] !== undefined || !documentId || !d.pageId.startsWith(`${documentId}:`)) return "ignored";
    return finishDrawing(documentId) === "ignored" ? "ignored" : "done";
  },

  removeLastPoint() {
    return undoDrawingPoint();
  },

  escape() {
    if (textEditing()) return endTextEdit(true) || true;
    const d = drawing();
    // Story 5.10: Esc puts the format painter away first; 4.11: with nothing being drawn, it clears the selection.
    if (!d) return dropFormat() || setSelection([]);
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
    if (isLocked(m)) {
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

  ink(phase, point, at, straight) {
    inkStroke(phase, point, at, straight);
  },

  textMark(phase, point, at) {
    textMarkDrag(phase, point, at);
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
  if (makesZone("fill")) {
    addZone(documentId, rings);
    return "done";
  }
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
function finishDrawing(documentId: string): "done" | "continue" | "ignored" {
  const d = drawing();
  if (!d || d.points.length < MIN_POINTS[d.tool]) return "ignored";
  if (d.tool === "area" && selfIntersects(d.points)) return "ignored";
  return commit(documentId);
}

/** Story 5.7: a stroke's style (D1: a pen as the other markups, a highlight yellow, wide, 40 %). */
function inkStyle(tool: InkTool): MarkupStyle {
  // Story 5.11 (D2): an eraser, the sheet's white, 10 pt.
  return tool === "highlight" ? DEFAULT_HIGHLIGHT_STYLE : tool === "eraser" ? DEFAULT_COVER_STYLE : DEFAULT_MARKUP_STYLE;
}

/** Story 9.2: a zone's faint fill (device rings; its holes left out). */
function paintZoneFill(c: CanvasRenderingContext2D, rings: readonly (readonly Point[])[], color: string): void {
  if (rings[0].length < 3) return;
  c.save();
  c.beginPath();
  for (const ring of rings) {
    c.moveTo(ring[0].x, ring[0].y);
    for (let i = 1; i < ring.length; i++) c.lineTo(ring[i].x, ring[i].y);
    c.closePath();
  }
  c.globalAlpha = ZONE_FILL_OPACITY;
  c.fillStyle = color;
  c.fill("evenodd");
  c.restore();
}

/** Story 9.2: a zone's name at its centroid, in its colour. */
function paintZoneName(c: CanvasRenderingContext2D, name: string, at: Point, style: MarkupStyle, view: LayerView): void {
  const size = style.fontSize * view.devicePerPt;
  if (size < 4) return;
  c.save();
  c.font = `600 ${size}px ${view.colors.fontFamily}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillStyle = style.color;
  c.fillText(name, at.x, at.y);
  c.restore();
}

/** Story 5.11: a white-out's cover (device points): filled with the sheet's white, no stroke. */
function paintCover(c: CanvasRenderingContext2D, pts: readonly Point[]): void {
  if (pts.length < 3) return;
  c.save();
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.closePath();
  c.fillStyle = COVER_COLOR;
  c.fill();
  c.restore();
}

/**
 * Story 5.7: a Pen or Highlight stroke. The press starts it (and ends any typing); each move adds
 * the point once it is a step away on screen, or, `straight` (Shift), replaces what follows the
 * point where Shift began; the release adds it simplified; a cancel drops it.
 */
function inkStroke(phase: "start" | "move" | "end" | "cancel", point: Point, at: { documentId: string; pageIndex: number; view: LayerView }, straight: boolean): void {
  const tool = viewerStore.getState().tool;
  const pageId = pageIdOf(at.documentId, at.pageIndex);
  if (phase === "start") {
    if (textEditing()) endTextEdit(true);
    if (isInkTool(tool)) setDrawing({ tool, pageId, pageIndex: at.pageIndex, points: [point], ...(straight ? { anchor: 0 } : {}) });
    return;
  }
  const d = drawing();
  if (!d || !isInkTool(d.tool) || d.pageId !== pageId) return;
  if (phase === "cancel") return setDrawing(null);
  // One CSS px in user units on this page at this zoom.
  const px = (at.view.dpr || 1) / (at.view.devicePerPt * (at.view.userUnit > 0 ? at.view.userUnit : 1) || 1);
  let points = d.points;
  let anchor = d.anchor;
  if (straight) {
    anchor ??= points.length - 1;
    points = [...points.slice(0, anchor + 1), point];
  } else {
    anchor = undefined;
    const last = points[points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) >= INK_STEP_PX * px && points.length < MAX_POLYLINE_POINTS) points = [...points, point];
  }
  if (phase === "move") {
    if (points !== d.points || anchor !== d.anchor) setDrawing({ ...d, points, anchor });
    return;
  }
  const stroke = simplifyStroke(points, INK_SIMPLIFY_PX * px);
  setDrawing(null);
  // A click, or a press that never moved, draws nothing (D2).
  if (stroke.length < 2 || !strokeHasLength(stroke)) return;
  const markup: Markup = { id: uuidv7(), pageId, createdAt: new Date().toISOString(), style: inkStyle(d.tool), type: d.tool, points: stroke };
  executeOp({ kind: "markups.add", documentId: at.documentId, markups: [markup] }, ADD_LABEL[d.tool]);
}

/** Story 5.8: a dimension's caption, its measured points' calibrated length. */
function dimensionCaption(m: DimensionMarkup, calibration: Calibration | null, userUnit: number): { text: string; scaled: boolean } {
  return lengthCaption(m.points.slice(0, 2), calibration, userUnit);
}

/** Story 5.8: adds the picked image centred at `point` ("Add image"), then selects it with Select. */
/** Story 7.3: where `tool` goes on page `pageIndex` (null: the page needs a scale or its image is loading). */
/** The tool held at `point`: the pointer holds its top-left corner as the screen shows it (the ghost, a click and a drop alike). */
function stampMarkups(tool: StampTool, point: Point, documentId: string, pageIndex: number, view?: LayerView): Markup[] | null {
  const pageId = pageIdOf(documentId, pageIndex);
  const shown = view ?? lastViewOf(pageId);
  const unit = shown?.userUnit ?? 1;
  const placed = placedMarkups(tool, point, { pageId, calibration: calibrationOf(documentId, pageIndex), userUnit: unit }, uuidv7, new Date().toISOString());
  // Without a painted view, the page upright (y up in user space).
  return placed && anchorTopLeft(placed, point, shown ? (p) => shown.toDevice(p) : (p) => ({ x: p.x, y: -p.y }));
}

/** Story 7.3: places `tool` held at `point` (one undo step); false when it cannot go on that page. */
function placeStamp(tool: StampTool | null, point: Point, documentId: string, pageIndex: number): boolean {
  if (!tool) {
    toast({ title: NO_STAMP, variant: "info" });
    return false;
  }
  const markups = stampMarkups(tool, point, documentId, pageIndex);
  if (!markups) {
    if (!toolScale(tool.content, { calibration: calibrationOf(documentId, pageIndex), userUnit: 1 })) {
      toast({ title: `“${tool.name}” needs this page's scale`, description: `${NEEDS_SCALE}.`, variant: "warning" });
    } else toast({ title: `“${tool.name}” is still loading its image`, description: "Try again in a moment.", variant: "info" });
    return false;
  }
  executeOp({ kind: "markups.add", documentId, markups }, PLACE_TOOL);
  return true;
}

function paintStampGhost(c: CanvasRenderingContext2D, tool: StampTool, pointer: Point, view: LayerView): void {
  const markups = stampMarkups(tool, pointer, view.documentId, view.pageIndex, view);
  if (!markups) return;
  c.save();
  c.globalAlpha = 0.5;
  paintMarkupsPreview(c, markups, view, calibrationOf(view.documentId, view.pageIndex));
  c.restore();
}

function placeImage(point: Point, documentId: string, pageId: string): "done" | "ignored" {
  const picked = pickedImage();
  if (!picked) return "ignored";
  const markup = imageMarkupAt(picked, point, pageId);
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, markup.signature ? ADD_SIGNATURE : ADD_IMAGE);
  clearPickedImage();
  setTool("select");
  setSelection([markup.id]);
  return "done";
}

/** The markup a finished drawing makes (Story 5.4: a shape takes the markup style). */
function markupOf(d: Drawing): Markup {
  const base = { id: uuidv7(), pageId: d.pageId, createdAt: new Date().toISOString(), style: isMarkupTool(d.tool) ? DEFAULT_MARKUP_STYLE : DEFAULT_MEASURE_STYLE };
  const points = [...d.points];
  const [a, b, c] = points;
  switch (d.tool) {
    case "length":
    case "line":
    case "arrow":
      return { ...base, type: d.tool, points: [a, b] };
    case "rectangle":
    case "ellipse":
      return { ...base, type: d.tool, points: boxCorners(a, b) };
    case "angle":
    case "radius":
    case "diameter":
      return { ...base, type: d.tool, points: [a, b, c] };
    // Clicked start, end, then a point on the bulge.
    case "arc":
      return { ...base, type: "arc", points: arcFromClicks(a, b, c) };
    case "fill":
      return { ...base, type: "area", points };
    case "pen":
    case "highlight":
    case "eraser":
      return { ...base, style: inkStyle(d.tool), type: d.tool, points };
    // Story 5.11: a white-out from a box's two corners, or a polygon's vertices.
    case "whiteout":
      return { ...base, style: DEFAULT_COVER_STYLE, type: "whiteout", points: boxCorners(a, b) };
    case "whiteoutpolygon":
      return { ...base, style: DEFAULT_COVER_STYLE, type: "whiteout", points };
    case "dimension":
      return { ...base, type: d.tool, points: [a, b, c] };
    case "image":
      throw new Error("an image is placed from its picked file (image-tool.ts)");
    case "stamp":
      throw new Error("a tool is placed from the Tool Chest (placeStamp)");
    case "revision":
      throw new Error("a revision stamp is placed by one click (revision-tool.ts)");
    case "legend":
      throw new Error("a legend is placed by one click (legend-tool.ts)");
    case "underline":
    case "strikethrough":
    case "texthighlight":
    case "squiggly":
    case "replacetext":
      throw new Error("marked text is added by its drag (text-mark-tool.ts)");
    case "inserttext":
      throw new Error("insert text is placed by one click (placeCaret)");
    case "text":
    case "callout":
    case "typewriter":
    case "note":
    case "cloudplus":
      throw new Error("text markups are typed (text-tool.ts)");
    default:
      return { ...base, type: d.tool, points };
  }
}

/**
 * Adds the drawing as its markup (one undo step, in `tabId`'s history: the active tab by default) and ends it.
 * Story 5.6: a text tool's starts its typing; a Cloud+'s closed cloud waits for its text's click ("continue").
 */
function commit(documentId: string, tabId?: string): "done" | "continue" {
  const d = drawing()!;
  if (isTextTool(d.tool)) {
    if (d.tool === "cloudplus" && !d.ring) {
      setDrawing({ ...d, ring: d.points, points: [] });
      return "continue";
    }
    setDrawing(null);
    beginTextEdit(draftOf(d.tool, d.pageId, d.points, d.ring), documentId, tabId ?? viewerStore.getState().tabId);
    return "done";
  }
  if (d.tool === "area" && makesZone("area")) {
    setDrawing(null);
    addZone(documentId, { pageId: d.pageId, outer: [...d.points], holes: [] }, tabId);
    return "done";
  }
  const markup = markupOf(d);
  setDrawing(null);
  // The 4541 panel's Add head line: the Line tool's line is a head line for the engine.
  if (markup.type === "line" && makesGuide()) {
    executeOp({ kind: "markups.add", documentId, markups: [guideOf(markup)] }, ADD_HEAD_LINE, tabId);
    return "done";
  }
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD_LABEL[d.tool], tabId);
  return "done";
}

/** Ctrl+Z or Backspace while drawing: removes the last placed point (the last one ends the drawing). */
function undoDrawingPoint(): boolean {
  const d = drawing();
  if (!d) return false;
  // Story 4.10: while filling, the last stroke.
  if (d.tool === "fill") return undoFillStroke();
  // Story 5.6: a Cloud+ waiting for its text's click goes back to its cloud.
  if (d.ring) {
    setDrawing({ tool: d.tool, pageId: d.pageId, pageIndex: d.pageIndex, points: d.ring });
    return true;
  }
  const points = d.points.slice(0, -1);
  setDrawing(points.length > 0 ? { ...d, points } : null);
  return true;
}

/** Story 5.7: whether the tools differ in their drawing only (layer 2 paints none of it). */
function onlyDrawingChanged(a: EditorState["tools"], b: EditorState["tools"]): boolean {
  const keys = Object.keys(a) as (keyof EditorState["tools"])[];
  return a.drawing !== b.drawing && keys.length === Object.keys(b).length && keys.every((k) => k === "drawing" || a[k] === b[k]);
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
      // Story 5.7: only the drawing changed (a stroke's every move): layer 2 is not painted again.
      const activeOnly = s.doc === prev.doc && s.selection === prev.selection && onlyDrawingChanged(s.tools, prev.tools);
      notifyMarkups({ drawingEnded: prev.tools.drawing !== null && s.tools.drawing === null, ...(activeOnly ? { activeOnly } : {}) });
    });
    // Another tool, page, tab or document ends the drawing in progress (and a caption move):
    // a count is kept (D4), the others are cancelled.
    const offViewer = viewerStore.subscribe((s, prev) => {
      if (s.calibrations !== prev.calibrations) notifyMarkups({});
      const moved = s.tool !== prev.tool || s.pageIndex !== prev.pageIndex || s.tabId !== prev.tabId || s.openSeq !== prev.openSeq || s.documentId !== prev.documentId;
      if (moved) setCaptionDrag(null);
      // Story 5.6: another tool, page, tab or document ends the typing (its text is kept).
      if (moved && textEditing()) endTextEdit(true);
      // Story 5.8: leaving Image drops the image waiting for its click.
      if (prev.tool === "image" && s.tool !== "image") clearPickedImage();
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
      endTextEdit(false);
      forgetViews();
      clearPickedImage();
      forgetDecodedImages();
      discardFill();
      resetSelectTool();
      dropFormat();
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
