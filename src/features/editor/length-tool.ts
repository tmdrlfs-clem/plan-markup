// The Length measurement tool (Story 4.5, FR26). Two clicks place a length:
// the first starts it, the second adds it as one undo step ("Add length").
// While drawing, a rubber band follows the tool point (snapped, Shift-held or
// raw: the viewer's snapping rules) with the live value beside the pointer.
// The tool stays armed after a measurement (Revu). Esc while drawing cancels
// it, Ctrl+Z removes its placed point; another tool, page or tab cancels it.
//
// The editor paints the viewer's layers 2 and 3 through the viewer's markup
// painter interface (AR10): layer 2 the page's markups, layer 3 the drawing.

import { useLayoutEffect } from "react";

import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { captionPlacement, lengthCaption } from "@/core/measure/length";
import { DEFAULT_MEASURE_STYLE, type LengthMarkup, type MarkupStyle } from "@/core/schema/markup";
import { notifyMarkups, registerMarkupPainter, setTool, viewerStore, type LayerView, type MarkupPainter } from "@/features/viewer";

import { editorStore, pageMarkups, setDrawing, type Drawing } from "./editor-store";
import { executeOp, registerDrawingUndo } from "./undo-store";

type Point = { x: number; y: number };

export const ADD_LENGTH = "Add length";
/** The live label beside the pointer, in screen px (not page units: it is UI, not the markup). */
const LIVE_FONT_PX = 12;
const LIVE_OFFSET_PX = { x: 14, y: 22 };

const drawing = (): Drawing | null => editorStore.getState().tools.drawing;

function calibrationOf(documentId: string, pageIndex: number): Calibration | null {
  return viewerStore.getState().calibrations[pageIdOf(documentId, pageIndex)] ?? null;
}

/** A line in page units with short perpendicular end ticks (a dimension line). */
function strokeLength(c: CanvasRenderingContext2D, a: Point, b: Point, style: MarkupStyle, view: LayerView): void {
  const width = Math.max(1, style.width * view.devicePerPt);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const tick = Math.max(3 * view.dpr, 3 * view.devicePerPt);
  const nx = length > 1e-6 ? -(b.y - a.y) / length : 0;
  const ny = length > 1e-6 ? (b.x - a.x) / length : 0;
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.lineTo(b.x, b.y);
  for (const p of [a, b]) {
    c.moveTo(p.x - nx * tick, p.y - ny * tick);
    c.lineTo(p.x + nx * tick, p.y + ny * tick);
  }
  c.lineWidth = width;
  c.lineCap = "butt";
  c.strokeStyle = style.color;
  c.stroke();
}

/** The caption along the line, above it, never upside down; "Scale not set" in the warning colour. */
function drawCaption(c: CanvasRenderingContext2D, a: Point, b: Point, text: string, scaled: boolean, style: MarkupStyle, view: LayerView): void {
  const size = style.fontSize * view.devicePerPt;
  if (size < 1) return;
  const at = captionPlacement(a, b, Math.max(1, style.width * view.devicePerPt) / 2 + size * 0.2);
  c.save();
  c.translate(at.x, at.y);
  c.rotate(at.angle);
  c.font = `${size}px ${view.colors.fontFamily}`;
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

export const lengthPainter: MarkupPainter = {
  paintStatic(c, view) {
    const markups = pageMarkups(editorStore.getState(), view.documentId, pageIdOf(view.documentId, view.pageIndex));
    if (markups.length === 0) return [];
    const calibration = calibrationOf(view.documentId, view.pageIndex);
    const captions: string[] = [];
    c.save();
    for (const m of markups) {
      if (m.type !== "length") continue;
      const a = view.toDevice(m.points[0]);
      const b = view.toDevice(m.points[1]);
      const caption = lengthCaption(m.points, calibration, view.userUnit);
      strokeLength(c, a, b, m.style, view);
      drawCaption(c, a, b, caption.text, caption.scaled, m.style, view);
      captions.push(caption.text);
    }
    c.restore();
    return captions;
  },

  paintActive(c, view, pointer) {
    const d = drawing();
    if (!d || d.pageId !== pageIdOf(view.documentId, view.pageIndex) || !pointer || d.points.length === 0) return null;
    const points = [d.points[0], pointer];
    const a = view.toDevice(points[0]);
    const b = view.toDevice(points[1]);
    const caption = lengthCaption(points, calibrationOf(view.documentId, view.pageIndex), view.userUnit);
    c.save();
    strokeLength(c, a, b, DEFAULT_MEASURE_STYLE, view);
    c.restore();
    liveLabel(c, b, caption.text, caption.scaled, view);
    return caption.text;
  },

  get tracking() {
    return drawing() !== null;
  },

  place(point, at) {
    if (viewerStore.getState().tool !== "length") return "ignored";
    const pageId = pageIdOf(at.documentId, at.pageIndex);
    const d = drawing();
    if (!d || d.pageId !== pageId) {
      setDrawing({ tool: "length", pageId, pageIndex: at.pageIndex, points: [point] });
      return "continue";
    }
    const start = d.points[0];
    // A second click on the first point measures nothing: keep drawing.
    if (start.x === point.x && start.y === point.y) return "continue";
    const markup: LengthMarkup = {
      id: uuidv7(),
      type: "length",
      pageId,
      createdAt: new Date().toISOString(),
      style: DEFAULT_MEASURE_STYLE,
      points: [start, point],
    };
    setDrawing(null);
    executeOp({ kind: "markups.add", documentId: at.documentId, markups: [markup] }, ADD_LENGTH);
    return "done";
  },

  escape() {
    if (!drawing()) return false;
    setDrawing(null);
    return true;
  },
};

/** Ctrl+Z while drawing: removes the last placed point (a length has one before it is added: the drawing ends). */
function undoDrawingPoint(): boolean {
  const d = drawing();
  if (!d) return false;
  const points = d.points.slice(0, -1);
  setDrawing(points.length > 0 ? { ...d, points } : null);
  return true;
}

let installed = 0;
let uninstall: (() => void) | null = null;

/** Registers the Length tool with the viewer and the undo stack (the workspace shell, once). */
export function installLengthTool(): () => void {
  installed++;
  if (installed === 1) {
    const offPainter = registerMarkupPainter(lengthPainter);
    const offUndo = registerDrawingUndo(undoDrawingPoint);
    // Markups, the drawing or a calibration changed: the viewer paints again (captions follow
    // a recalibration: values are never stored, AC 2).
    const offEditor = editorStore.subscribe((s, prev) => {
      if (s.doc === prev.doc && s.tools === prev.tools) return;
      notifyMarkups({ drawingEnded: prev.tools.drawing !== null && s.tools.drawing === null });
    });
    // Another tool, page, tab or document cancels the drawing in progress.
    const offViewer = viewerStore.subscribe((s, prev) => {
      if (s.calibrations !== prev.calibrations) notifyMarkups({});
      if (!drawing()) return;
      if (s.tool !== "length" || s.pageIndex !== prev.pageIndex || s.tabId !== prev.tabId || s.openSeq !== prev.openSeq || s.documentId !== prev.documentId) {
        setDrawing(null);
      }
    });
    uninstall = () => {
      setDrawing(null);
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

/** The workspace shell: the Length tool works while the workspace is mounted. */
export function useLengthTool(): void {
  useLayoutEffect(() => installLengthTool(), []);
}

/** Shift+Alt+L and the ToolRail: arms Length. */
export function armLength(): void {
  setTool("length");
}
