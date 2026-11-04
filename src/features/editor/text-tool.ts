// The text tools (Story 5.6, FR31): Text box, Callout, Typewriter, Note and
// Cloud+. measure-tool places them as it places the other markups; once
// placed, the markup is a draft (no text) being typed in a DOM field over the
// canvas (text-editor.tsx) at the frame the painter last drew it (CSS px in
// the viewport, so it follows zoom and pan). Ending the edit (Esc, Ctrl+Enter,
// focus leaving the field, another tool, page or tab) adds the markup with its
// text as one undo step, its box grown down to fit the text (D3), a
// typewriter's box sized to it; with no text nothing is added (D2). The text
// is plain text, never HTML (NFR27).

import { createStore } from "zustand/vanilla";

import { pageIdOf } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import {
  TEXT_BOX_WIDTH_PT,
  TEXT_LINE_HEIGHT,
  TEXT_PAD_PT,
  boxFrom,
  cloudRingOf,
  growBox,
  orientBox,
  screenAxes,
  textBoxOf,
  wrapText,
} from "@/core/markup/text";
import { DEFAULT_MARKUP_STYLE, MAX_TEXT_LENGTH, type TextMarkup } from "@/core/schema/markup";
import type { LayerView, TextTool } from "@/features/viewer";

import { editorStore, setTextEdit, type TextEdit } from "./editor-store";
import { executeOp } from "./undo-store";

type Point = { x: number; y: number };

export const ADD_TEXT = "Add text box";
export const ADD_CALLOUT = "Add callout";
export const ADD_TYPEWRITER = "Add typewriter";
export const ADD_NOTE = "Add note";
export const ADD_CLOUD_PLUS = "Add cloud+";
const ADD_LABEL: Record<TextTool, string> = {
  text: ADD_TEXT,
  callout: ADD_CALLOUT,
  typewriter: ADD_TYPEWRITER,
  note: ADD_NOTE,
  cloudplus: ADD_CLOUD_PLUS,
};
/** What layer 2's list calls each (with the text's start). */
export const TEXT_LABEL: Record<TextTool, string> = { text: "Text box", callout: "Callout", typewriter: "Typewriter", note: "Note", cloudplus: "Cloud+" };
/** The list's text is cut to this many characters. */
const LABEL_CHARS = 40;
/** A note's field width (CSS px): it opens beside the icon. */
export const NOTE_FIELD_PX = 200;

/** The field over the canvas, in the viewport's CSS px: its top left, size and turn, its font size and padding. */
export type TextFrame = { x: number; y: number; width: number; height: number; angle: number; fontPx: number; padPx: number; color: string; kind: TextTool };

/** The field's frame as last painted (its own store: painting it must not repaint the markups). */
export const textFrameStore = createStore<{ frame: TextFrame | null }>(() => ({ frame: null }));

const sameFrame = (a: TextFrame | null, b: TextFrame | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.color === b.color &&
    [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height, a.angle - b.angle, a.fontPx - b.fontPx, a.padPx - b.padPx].every((d) => Math.abs(d) < 0.01));

/** The painter: where the field is now (null: off this page). */
export function setTextFrame(frame: TextFrame | null): void {
  if (!sameFrame(textFrameStore.getState().frame, frame)) textFrameStore.setState({ frame });
}

/** The text being typed, if any. */
export const textEditing = (): TextEdit | null => editorStore.getState().tools.textEdit;

/** The views last painted, by page id: a new markup's text reads upright as that page is shown. */
const views = new Map<string, LayerView>();
const VIEWS_KEPT = 16;
export function noteView(view: LayerView): void {
  const id = pageIdOf(view.documentId, view.pageIndex);
  views.delete(id);
  views.set(id, view);
  if (views.size > VIEWS_KEPT) views.delete(views.keys().next().value!);
}
export function forgetViews(): void {
  views.clear();
}
/** Story 5.8: the view page `pageId` was last painted with, if any. */
export function lastViewOf(pageId: string): LayerView | null {
  return views.get(pageId) ?? null;
}
/** Screen as the page was last painted (y down); without a view, the page upright. */
function toScreenOf(pageId: string): (p: Point) => Point {
  return views.get(pageId)?.toDevice ?? ((p) => ({ x: p.x, y: -p.y }));
}
function userUnitOf(pageId: string): number {
  const u = views.get(pageId)?.userUnit ?? 1;
  return u > 0 ? u : 1;
}

/**
 * The draft a text tool's points make (no text yet): Text box from two corners, Callout from
 * its tip and the text's click, Typewriter and Note from one click, Cloud+ from its cloud and
 * the text's click (`ring`).
 */
export function draftOf(tool: TextTool, pageId: string, points: readonly Point[], ring?: readonly Point[]): TextMarkup {
  const base = { id: uuidv7(), pageId, createdAt: new Date().toISOString(), style: DEFAULT_MARKUP_STYLE, text: "" };
  const toScreen = toScreenOf(pageId);
  const unit = userUnitOf(pageId);
  const font = DEFAULT_MARKUP_STYLE.fontSize / unit;
  const height = font * TEXT_LINE_HEIGHT + (2 * TEXT_PAD_PT) / unit;
  const placed = (origin: Point) => {
    const { right, down } = screenAxes(origin, toScreen);
    return boxFrom(origin, right, down, TEXT_BOX_WIDTH_PT / unit, height);
  };
  switch (tool) {
    case "text":
      return { ...base, type: "text", points: orientBox(points[0], points[1], toScreen) };
    case "typewriter": {
      const { right, down } = screenAxes(points[0], toScreen);
      return { ...base, type: "typewriter", points: boxFrom(points[0], right, down, font, font * TEXT_LINE_HEIGHT) };
    }
    case "note":
      return { ...base, type: "note", points: [{ x: points[0].x, y: points[0].y }] };
    case "callout":
      return { ...base, type: "callout", points: [...placed(points[1]), { x: points[0].x, y: points[0].y }] };
    case "cloudplus":
      return { ...base, type: "cloudplus", points: [...(ring ?? []), ...placed(points[0])] };
  }
}

/** Width of `s` at font size `size` (any unit): a canvas where there is one, else an estimate. */
export type Measure = (s: string, size: number) => number;
let measureContext: OffscreenCanvasRenderingContext2D | null | undefined;
export function measureText(family: string): Measure {
  if (measureContext === undefined) measureContext = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d");
  const ctx = measureContext;
  if (!ctx) return (s, size) => s.length * size * 0.55;
  return (s, size) => {
    ctx.font = `100px ${family}`;
    return (ctx.measureText(s).width * size) / 100;
  };
}

const unitVector = (a: Point, b: Point) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
};

/** The markup with its text: a box grown down to fit the wrapped text (D3), a typewriter's box sized to its lines. */
export function finalizeText(draft: TextMarkup, text: string, userUnit: number, measure: Measure): TextMarkup {
  if (draft.type === "note") return { ...draft, text };
  const unit = userUnit > 0 ? userUnit : 1;
  const font = draft.style.fontSize / unit;
  const width = (s: string) => measure(s, font);
  const lineHeight = font * TEXT_LINE_HEIGHT;
  const box = textBoxOf(draft)!;
  if (draft.type === "typewriter") {
    const lines = wrapText(text, null, width);
    const w = Math.max(font / 2, ...lines.map(width));
    return { ...draft, text, points: boxFrom(box[0], unitVector(box[0], box[1]), unitVector(box[0], box[3]), w, lines.length * lineHeight) };
  }
  const pad = TEXT_PAD_PT / unit;
  const inner = Math.max(font, Math.hypot(box[1].x - box[0].x, box[1].y - box[0].y) - 2 * pad);
  const lines = wrapText(text, inner, width);
  const grown = growBox(box, lines.length * lineHeight + 2 * pad);
  if (draft.type === "text") return { ...draft, text, points: grown };
  if (draft.type === "callout") return { ...draft, text, points: [...grown, draft.points[4]] };
  return { ...draft, text, points: [...cloudRingOf(draft), ...grown] };
}

/** Starts typing a placed draft (its document's tab records it). */
export function beginTextEdit(draft: TextMarkup, documentId: string, tabId: string | null): void {
  typed = "";
  setTextEdit({ draft, documentId, tabId });
}

/** The field's text, as the editor last reported it (the field owns it while typing). */
let typed = "";
export function setTypedText(text: string): void {
  typed = text.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Ends typing: `commit` adds the markup with the typed text (one undo step) unless it is
 * empty (D2); true when it added one. The field closes either way.
 */
export function endTextEdit(commit: boolean): boolean {
  const edit = textEditing();
  if (!edit) return false;
  const text = typed;
  typed = "";
  setTextEdit(null);
  setTextFrame(null);
  if (!commit || text.trim() === "") return false;
  const family = views.get(edit.draft.pageId)?.colors.fontFamily ?? "sans-serif";
  const markup = finalizeText(edit.draft, text, userUnitOf(edit.draft.pageId), measureText(family));
  executeOp({ kind: "markups.add", documentId: edit.documentId, markups: [markup] }, ADD_LABEL[markup.type], edit.tabId ?? undefined);
  return true;
}

/** Layer 2's list entry: the tool's name and the text's start on one line. */
export function textLabel(m: TextMarkup): string {
  const flat = m.text.replace(/\s+/g, " ").trim();
  return `${TEXT_LABEL[m.type]}: ${flat.length > LABEL_CHARS ? `${flat.slice(0, LABEL_CHARS - 1)}…` : flat}`;
}
