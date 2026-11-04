// Story 5.9: Underline and Strikethrough (FR32). The tool selects PDF text as
// it is dragged: the press must be on (or within a few px of) text, the
// release anywhere; the words between, whole words in reading order, are
// shown selected and the release adds the markup over their glyph boxes, as
// one undo step ("Add underline", "Add strikethrough"); the tool stays armed.
// A drag that selects no text adds nothing. The page's text comes from the
// viewer (it reads it once a page, when the tool is armed); on an image-only
// page the rail disables the tools.

import { pageIdOf } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { charNear, decorationLines, quadsOf, selectionQuads, selectionText, wordSelection, type PageText } from "@/core/markup/text-select";
import { DEFAULT_MARKUP_STYLE, type Markup, type MarkupStyle, type TextMarkMarkup } from "@/core/schema/markup";
import { isTextMarkTool, viewerStore, type LayerView } from "@/features/viewer";

import { editorStore, setDrawing } from "./editor-store";
import { executeOp } from "./undo-store";

type Point = { x: number; y: number };

export const ADD_UNDERLINE = "Add underline";
export const ADD_STRIKETHROUGH = "Add strikethrough";
/** The press must be this near text on screen (CSS px). */
const TEXT_SLOP_PX = 4;
/** The selection's fill while dragging. */
const SELECTION_ALPHA = 0.25;
/** Layer 2's list shows this much of the marked text. */
const LABEL_CHARS = 40;

const LABEL: Record<TextMarkMarkup["type"], string> = { underline: "Underline", strikethrough: "Strikethrough" };

/** The words from the text at `from` to the text nearest `to`; null when `from` is on no text. */
function selectWords(text: PageText, from: Point, to: Point, tol: number): { quads: Point[]; text: string } | null {
  const a = charNear(text, from, tol);
  if (a === null) return null;
  const b = charNear(text, to, Infinity) ?? a;
  const selection = wordSelection(text.index, a, b);
  if (selection.end <= selection.start) return null;
  const quads = selectionQuads(text, selection);
  return quads.length > 0 ? { quads, text: selectionText(text.index, selection) } : null;
}

/** An Underline or Strikethrough drag (user space); `at.text` is the page's text, null while it is read. */
export function textMarkDrag(
  phase: "start" | "move" | "end" | "cancel",
  point: Point,
  at: { documentId: string; pageIndex: number; view: LayerView; text: PageText | null },
): void {
  const tool = viewerStore.getState().tool;
  if (!isTextMarkTool(tool)) return;
  const pageId = pageIdOf(at.documentId, at.pageIndex);
  if (phase === "start") setDrawing({ tool, pageId, pageIndex: at.pageIndex, points: [point] });
  const d = editorStore.getState().tools.drawing;
  if (!d || d.tool !== tool || d.pageId !== pageId) return;
  if (phase === "cancel") return setDrawing(null);
  const px = (at.view.dpr || 1) / (at.view.devicePerPt * (at.view.userUnit > 0 ? at.view.userUnit : 1) || 1);
  const selected = at.text ? selectWords(at.text, d.points[0], point, TEXT_SLOP_PX * px) : null;
  if (phase !== "end") {
    setDrawing({ ...d, points: [d.points[0], point], quads: selected?.quads, selected: selected?.text });
    return;
  }
  setDrawing(null);
  if (!selected) return;
  const markup: Markup = { id: uuidv7(), pageId, createdAt: new Date().toISOString(), style: DEFAULT_MARKUP_STYLE, type: tool, points: selected.quads, text: selected.text };
  executeOp({ kind: "markups.add", documentId: at.documentId, markups: [markup] }, tool === "underline" ? ADD_UNDERLINE : ADD_STRIKETHROUGH);
}

/** Layer 2's label: the kind and the start of the marked text. */
export function textMarkLabel(m: TextMarkMarkup): string {
  const text = m.text ?? "";
  if (!text) return LABEL[m.type];
  return `${LABEL[m.type]}: ${text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS)}…` : text}`;
}

/** The lines of an underline or a strikethrough along its glyph boxes (device points). */
export function paintTextMark(c: CanvasRenderingContext2D, kind: TextMarkMarkup["type"], points: readonly Point[], style: MarkupStyle, view: LayerView): void {
  c.save();
  if ((style.opacity ?? 1) < 1) c.globalAlpha = style.opacity ?? 1;
  c.beginPath();
  for (const [a, b] of decorationLines(points, kind)) {
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
  }
  c.lineWidth = Math.max(1, style.width * view.devicePerPt);
  c.lineCap = "butt";
  c.strokeStyle = style.color;
  c.stroke();
  c.restore();
}

/** Layer 3 while dragging: the selected words (the selection colour) and the line they will get. */
export function paintTextMarkActive(c: CanvasRenderingContext2D, kind: TextMarkMarkup["type"], quads: readonly Point[], view: LayerView): void {
  c.save();
  c.globalAlpha = SELECTION_ALPHA;
  c.fillStyle = view.colors.selection;
  c.beginPath();
  for (const q of quadsOf(quads)) {
    c.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y);
    c.closePath();
  }
  c.fill();
  c.restore();
  paintTextMark(c, kind, quads, DEFAULT_MARKUP_STYLE, view);
}
