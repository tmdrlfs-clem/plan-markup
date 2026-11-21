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
import { isTextMarkTool, viewerStore, type LayerView, type TextMarkTool } from "@/features/viewer";

import { editorStore, setDrawing } from "./editor-store";
import { toast } from "@/components/ui/toast-store";

import { askText } from "./text-prompt";
import { executeOp } from "./undo-store";

type Point = { x: number; y: number };

export const ADD_UNDERLINE = "Add underline";
export const ADD_STRIKETHROUGH = "Add strikethrough";
export const ADD_TEXT_HIGHLIGHT = "Add text highlight";
export const ADD_SQUIGGLY = "Add squiggly underline";
export const ADD_REPLACE_TEXT = "Add replace text";
const ADD: Record<Exclude<TextMarkTool, "selecttext">, string> = { underline: ADD_UNDERLINE, strikethrough: ADD_STRIKETHROUGH, texthighlight: ADD_TEXT_HIGHLIGHT, squiggly: ADD_SQUIGGLY, replacetext: ADD_REPLACE_TEXT };
/** The markup a text tool's drag makes (Replace text: a strikethrough with its replacement; Select text: none, it shows as a highlight). */
export function textMarkKind(tool: TextMarkTool): TextMarkMarkup["type"] {
  return tool === "replacetext" ? "strikethrough" : tool === "selecttext" ? "texthighlight" : tool;
}
/** Select text: what the toast says once the text is copied. */
export const TEXT_COPIED = "Text copied";
/** A text highlight's style: yellow at 40 %, multiplied over the sheet (as the Highlight pen). */
const TEXT_HIGHLIGHT_STYLE: MarkupStyle = { ...DEFAULT_MARKUP_STYLE, color: "#ffff00", opacity: 0.4 };
/** The press must be this near text on screen (CSS px). */
const TEXT_SLOP_PX = 4;
/** The selection's fill while dragging. */
const SELECTION_ALPHA = 0.25;
/** Layer 2's list shows this much of the marked text. */
const LABEL_CHARS = 40;

const LABEL: Record<TextMarkMarkup["type"], string> = { underline: "Underline", strikethrough: "Strikethrough", texthighlight: "Text highlight", squiggly: "Squiggly" };

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
  if (tool === "selecttext") {
    // Select text: the words go to the clipboard (nothing is added).
    copyText(selected.text);
    return;
  }
  const style = tool === "texthighlight" ? TEXT_HIGHLIGHT_STYLE : DEFAULT_MARKUP_STYLE;
  const markup: Markup = { id: uuidv7(), pageId, createdAt: new Date().toISOString(), style, type: textMarkKind(tool), points: selected.quads, text: selected.text };
  const documentId = at.documentId;
  const tabId = viewerStore.getState().tabId ?? undefined;
  if (tool === "replacetext") {
    // Replace text: the struck words get their replacement (asked for; Cancel adds nothing).
    const shown = selected.text.length > LABEL_CHARS ? `${selected.text.slice(0, LABEL_CHARS)}…` : selected.text;
    askText({
      title: "Replace text",
      label: `Replace “${shown}” with`,
      onSubmit: (replacement) => executeOp({ kind: "markups.add", documentId, markups: [{ ...markup, replacement } as Markup] }, ADD_REPLACE_TEXT, tabId),
    });
    return;
  }
  executeOp({ kind: "markups.add", documentId, markups: [markup] }, ADD[tool]);
}

/** Writes `text` to the system clipboard and says so (or that it could not). */
function copyText(text: string): void {
  const done = () => toast({ title: TEXT_COPIED, description: text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS)}…` : text, variant: "success" });
  const failed = () => toast({ title: "Could not copy the text", description: "The browser did not allow the clipboard.", variant: "danger" });
  try {
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      failed();
      return;
    }
    write.then(done, failed);
  } catch {
    failed();
  }
}

const clip = (s: string) => (s.length > LABEL_CHARS ? `${s.slice(0, LABEL_CHARS)}…` : s);

/** Layer 2's label: the kind and the start of the marked text. */
export function textMarkLabel(m: TextMarkMarkup): string {
  const text = m.text ?? "";
  if (m.type === "strikethrough" && m.replacement !== undefined) return `Replace: ${clip(text)} → ${clip(m.replacement)}`;
  if (!text) return LABEL[m.type];
  return `${LABEL[m.type]}: ${text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS)}…` : text}`;
}

/** The lines of an underline or a strikethrough along its glyph boxes (device points). */
export function paintTextMark(c: CanvasRenderingContext2D, kind: TextMarkMarkup["type"], points: readonly Point[], style: MarkupStyle, view: LayerView): void {
  c.save();
  if ((style.opacity ?? 1) < 1) c.globalAlpha = style.opacity ?? 1;
  if (kind === "texthighlight") {
    // The glyph boxes filled, multiplied over the sheet.
    c.globalCompositeOperation = "multiply";
    c.fillStyle = style.color;
    c.beginPath();
    for (const q of quadsOf(points)) {
      c.moveTo(q[0].x, q[0].y);
      for (let i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y);
      c.closePath();
    }
    c.fill();
    c.restore();
    return;
  }
  c.beginPath();
  for (const [a, b] of decorationLines(points, kind)) {
    if (kind === "squiggly") {
      squiggle(c, a, b, Math.max(1.5 * view.dpr, style.width * view.devicePerPt * 1.5));
      continue;
    }
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
  }
  c.lineWidth = Math.max(1, style.width * view.devicePerPt);
  c.lineCap = "butt";
  c.strokeStyle = style.color;
  c.stroke();
  c.restore();
}

/** A zigzag from `a` to `b`, `amp` device px either side. */
function squiggle(c: CanvasRenderingContext2D, a: Point, b: Point, amp: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len === 0) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const step = amp * 2;
  c.moveTo(a.x, a.y);
  for (let t = step / 2, i = 0; t < len; t += step, i++) {
    const side = i % 2 === 0 ? -amp : amp;
    c.lineTo(a.x + ux * t - uy * side, a.y + uy * t + ux * side);
  }
  c.lineTo(b.x, b.y);
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
