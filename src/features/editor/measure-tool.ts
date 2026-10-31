// The measuring tools (FR26): Length (Story 4.5) and Polylength (Story 4.6).
// Length: two clicks, the second adds it as one undo step ("Add length").
// Polylength: each click adds a vertex; a double-click or Enter finishes it
// ("Add polylength"), Backspace removes the last vertex. While drawing, a
// rubber band follows the tool point (snapped, Shift-held or raw: the viewer's
// snapping rules) with the live total beside the pointer. The tool stays armed
// after a measurement (Revu). Esc while drawing cancels it, Ctrl+Z removes its
// last point; another tool, page or tab cancels it.
//
// With Select, Shift + drag on a caption moves the caption only ("Move
// caption", a markups.update op); the offset is stored in user space.
//
// The editor paints the viewer's layers 2 and 3 through the viewer's markup
// painter interface (AR10): layer 2 the page's markups, layer 3 the drawing.

import { useLayoutEffect } from "react";

import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { captionPlacement, lengthCaption, polylineCaptionAnchor } from "@/core/measure/length";
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

import { editorStore, pageMarkups, setCaptionDrag, setDrawing, type Drawing } from "./editor-store";
import { executeOp, registerDrawingUndo } from "./undo-store";

type Point = { x: number; y: number };

export const ADD_LENGTH = "Add length";
export const ADD_POLYLENGTH = "Add polylength";
export const MOVE_CAPTION = "Move caption";
const ADD_LABEL: Record<MeasureTool, string> = { length: ADD_LENGTH, polylength: ADD_POLYLENGTH };
/** The live label beside the pointer, in screen px (not page units: it is UI, not the markup). */
const LIVE_FONT_PX = 12;
const LIVE_OFFSET_PX = { x: 14, y: 22 };

const drawing = (): Drawing | null => editorStore.getState().tools.drawing;

function calibrationOf(documentId: string, pageIndex: number): Calibration | null {
  return viewerStore.getState().calibrations[pageIdOf(documentId, pageIndex)] ?? null;
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
  c.lineWidth = Math.max(1, style.width * view.devicePerPt);
  c.lineCap = "butt";
  c.lineJoin = "miter";
  c.strokeStyle = style.color;
  c.stroke();
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

export type CaptionFrame = { x: number; y: number; angle: number; size: number };

/** Where a measurement's caption is drawn (device px): along its anchor segment, moved by its offset. */
export function captionFrame(m: MeasureMarkup, view: LayerView): CaptionFrame {
  const [ua, ub] = m.type === "length" ? m.points : polylineCaptionAnchor(m.points);
  const size = m.style.fontSize * view.devicePerPt;
  const at = captionPlacement(view.toDevice(ua), view.toDevice(ub), Math.max(1, m.style.width * view.devicePerPt) / 2 + size * 0.2);
  if (m.captionOffset) {
    const o = view.toDevice(m.captionOffset);
    const z = view.toDevice({ x: 0, y: 0 });
    at.x += o.x - z.x;
    at.y += o.y - z.y;
  }
  return { ...at, size };
}

/** The caption above its anchor, never upside down; "Scale not set" in the warning colour. */
function drawCaption(c: CanvasRenderingContext2D, at: CaptionFrame, text: string, scaled: boolean, style: MarkupStyle, view: LayerView): void {
  if (at.size < 1) return;
  c.save();
  c.translate(at.x, at.y);
  c.rotate(at.angle);
  c.font = `${at.size}px ${view.colors.fontFamily}`;
  c.textAlign = "center";
  c.textBaseline = "bottom";
  c.fillStyle = scaled ? style.color : view.colors.warning;
  c.fillText(text, 0, 0);
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

/** A caption as last painted (device px): its frame and half its text width, for hits. */
type CaptionBox = { id: string; frame: CaptionFrame; half: number };
/** The captions of the page last painted, in drawing order (review R2: that page only, not every page ever painted). */
let captionBoxes: { pageId: string; boxes: CaptionBox[] } | null = null;
/** CSS px around a caption that still hit it. */
const CAPTION_SLOP_PX = 3;

const addOffset = (a: Point | undefined, b: Point): Point => ({ x: (a?.x ?? 0) + b.x, y: (a?.y ?? 0) + b.y });

/** The markup as painted: a caption being moved shows where it goes. */
function shown(m: MeasureMarkup): MeasureMarkup {
  const drag = editorStore.getState().tools.captionDrag;
  return drag && drag.id === m.id ? { ...m, captionOffset: addOffset(m.captionOffset, drag.delta) } : m;
}

const isMeasure = (m: { type: string }): m is MeasureMarkup => m.type === "length" || m.type === "polylength";

export const measurePainter: MarkupPainter = {
  paintStatic(c, view) {
    const markups = pageMarkups(editorStore.getState(), view.documentId, pageIdOf(view.documentId, view.pageIndex));
    if (markups.length === 0) {
      captionBoxes = null;
      return [];
    }
    const pageId = pageIdOf(view.documentId, view.pageIndex);
    const calibration = calibrationOf(view.documentId, view.pageIndex);
    const captions: string[] = [];
    const boxes: CaptionBox[] = [];
    c.save();
    for (const stored of markups) {
      if (!isMeasure(stored)) continue;
      const m = shown(stored);
      const caption = lengthCaption(m.points, calibration, view.userUnit);
      captions.push(caption.text);
      const pts = devicePoints(m.points, view);
      const frame = captionFrame(m, view);
      if (!onCanvas(pts, m.style, view, [frame])) continue;
      strokeMeasure(c, pts, m.style, view);
      drawCaption(c, frame, caption.text, caption.scaled, m.style, view);
      if (frame.size >= 1) {
        c.font = `${frame.size}px ${view.colors.fontFamily}`;
        boxes.push({ id: m.id, frame, half: (c.measureText(caption.text).width || 0) / 2 });
      }
    }
    c.restore();
    captionBoxes = { pageId, boxes };
    return captions;
  },

  paintActive(c, view, pointer) {
    const d = drawing();
    if (!d || d.pageId !== pageIdOf(view.documentId, view.pageIndex) || !pointer || d.points.length === 0) return null;
    const points = [...d.points, pointer];
    const pts = devicePoints(points, view);
    const caption = lengthCaption(points, calibrationOf(view.documentId, view.pageIndex), view.userUnit);
    c.save();
    strokeMeasure(c, pts, DEFAULT_MEASURE_STYLE, view);
    c.restore();
    liveLabel(c, pts[pts.length - 1], caption.text, caption.scaled, view);
    return caption.text;
  },

  get tracking() {
    return drawing() !== null;
  },

  get lastPoint() {
    return drawing()?.points.at(-1) ?? null;
  },

  place(point, at) {
    const tool = viewerStore.getState().tool;
    if (!isMeasureTool(tool)) return "ignored";
    const pageId = pageIdOf(at.documentId, at.pageIndex);
    const d = drawing();
    if (!d || d.pageId !== pageId || d.tool !== tool) {
      setDrawing({ tool, pageId, pageIndex: at.pageIndex, points: [point] });
      return "continue";
    }
    // A click on the last point adds nothing (a double-click's second click): keep drawing.
    const last = d.points[d.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) <= at.tolerance) return "continue";
    if (tool === "polylength") {
      const points = [...d.points, point];
      setDrawing({ ...d, points });
      // At the cap the polylength is finished (it cannot take another vertex).
      return points.length >= MAX_POLYLINE_POINTS ? commit(at.documentId) : "continue";
    }
    setDrawing({ ...d, points: [d.points[0], point] });
    return commit(at.documentId);
  },

  finish() {
    const d = drawing();
    const documentId = viewerStore.getState().documentId;
    if (!d || d.tool !== "polylength" || d.points.length < 2 || !documentId || !d.pageId.startsWith(`${documentId}:`)) return "ignored";
    return commit(documentId);
  },

  removeLastPoint() {
    return undoDrawingPoint();
  },

  escape() {
    if (!drawing()) return false;
    setDrawing(null);
    return true;
  },

  captionAt(view, at) {
    const boxes = captionBoxes?.pageId === pageIdOf(view.documentId, view.pageIndex) ? captionBoxes.boxes : [];
    const slop = CAPTION_SLOP_PX * view.dpr;
    // The topmost (last drawn) first.
    for (let i = boxes.length - 1; i >= 0; i--) {
      const { id, frame, half } = boxes[i];
      const dx = at.x - frame.x;
      const dy = at.y - frame.y;
      const cos = Math.cos(frame.angle);
      const sin = Math.sin(frame.angle);
      // Into the caption's frame: centred on x, text above its baseline (y from -size to 0).
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) <= half + slop && ly >= -frame.size - slop && ly <= slop) return id;
    }
    return null;
  },

  dragCaption(id, documentId, delta) {
    if (!pageMarkupById(documentId, id)) return;
    setCaptionDrag({ id, documentId, delta: { x: delta.x, y: delta.y } });
  },

  endCaptionDrag(commit) {
    const drag = editorStore.getState().tools.captionDrag;
    setCaptionDrag(null);
    if (!drag || !commit || (drag.delta.x === 0 && drag.delta.y === 0)) return false;
    const before = pageMarkupById(drag.documentId, drag.id);
    if (!before) return false;
    const after: MeasureMarkup = { ...before, captionOffset: addOffset(before.captionOffset, drag.delta) };
    executeOp({ kind: "markups.update", documentId: drag.documentId, before: [before], after: [after] }, MOVE_CAPTION);
    return true;
  },
};

/** A document's measurement by id, if it has it. */
function pageMarkupById(documentId: string, id: string): MeasureMarkup | null {
  const m = (editorStore.getState().doc.markups[documentId] ?? []).find((x) => x.id === id);
  return m && isMeasure(m) ? m : null;
}

/** Adds the drawing as its markup (one undo step) and ends it. */
function commit(documentId: string): "done" {
  const d = drawing()!;
  const base = { id: uuidv7(), pageId: d.pageId, createdAt: new Date().toISOString(), style: DEFAULT_MEASURE_STYLE };
  const markup: MeasureMarkup =
    d.tool === "length" ? { ...base, type: "length", points: [d.points[0], d.points[1]] } : { ...base, type: "polylength", points: [...d.points] };
  setDrawing(null);
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD_LABEL[d.tool]);
  return "done";
}

/** Ctrl+Z or Backspace while drawing: removes the last placed point (the last one ends the drawing). */
function undoDrawingPoint(): boolean {
  const d = drawing();
  if (!d) return false;
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
      if (s.doc === prev.doc && s.tools === prev.tools) return;
      notifyMarkups({ drawingEnded: prev.tools.drawing !== null && s.tools.drawing === null });
    });
    // Another tool, page, tab or document cancels the drawing in progress (and a caption move).
    const offViewer = viewerStore.subscribe((s, prev) => {
      if (s.calibrations !== prev.calibrations) notifyMarkups({});
      const moved = s.tool !== prev.tool || s.pageIndex !== prev.pageIndex || s.tabId !== prev.tabId || s.openSeq !== prev.openSeq || s.documentId !== prev.documentId;
      if (moved) setCaptionDrag(null);
      const d = drawing();
      if (!d) return;
      if (s.tool !== d.tool || s.pageIndex !== prev.pageIndex || s.tabId !== prev.tabId || s.openSeq !== prev.openSeq || s.documentId !== prev.documentId) {
        setDrawing(null);
      }
    });
    uninstall = () => {
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
