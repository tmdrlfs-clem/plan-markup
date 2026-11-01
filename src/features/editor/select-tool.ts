// The Select tool's markup editing (Story 5.1, FR33, FR35): a click selects
// the topmost markup under the pointer (or clears the selection on empty page
// space), Shift + click adds or takes out one, a drag from empty space draws a
// marquee and Alt + drag a lasso (markups wholly inside are selected; Shift
// adds them), a drag on a markup moves it or the whole selection (one undo
// step), arrow keys nudge the selection (one undo step per hold), Delete /
// Backspace delete it (one undo step, a toast with Undo), Ctrl+A selects the
// page's markups. The measure painter delegates its Select calls here and
// paints the move preview (tools.moveDrag) and the marquee / lasso.
//
// Story 5.2: the selection's handles resize it (Shift proportional, Alt from
// the centre), rotate it (15° steps, Shift 1°) or move one vertex; Ctrl + drag
// on a markup copies the selection (Ctrl + Shift: along 0° / 45° / 90°);
// Ctrl+C copies, Ctrl+V pastes at the pointer, Ctrl+Shift+V in place. Each is
// one undo step, previewed in place (tools.preview) while dragging.

import { toast } from "@/components/ui/toast-store";
import { invertOp, removeMarkupsOp, type DocOp } from "@/core/commands/ops";
import { pageIdOf } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { rectOf, translateMarkup, type Point, type Rect } from "@/core/markup/geometry";
import { MarkupIndex } from "@/core/markup/markup-index";
import {
  constrain45,
  copiesOf,
  resizeOf,
  rotateAbout,
  rotateVector,
  rotationOf,
  scaleAbout,
  setVertex,
  transformMarkup,
  type HandleAt,
} from "@/core/markup/transform";
import { selfIntersects } from "@/core/measure/area";
import type { Markup } from "@/core/schema/markup";
import { notifyMarkups, type LayerView, type SelectContext, type SelectionKey } from "@/features/viewer";

import { editorStore, markupsOf, setMoveDrag, setPreview, setSelection } from "./editor-store";
import { boxOf, handleAt, handlesOf } from "./handles";
import { executeOp, undoActive } from "./undo-store";

/** A press that moves less than this (CSS px) is a click. */
export const CLICK_PX = 3;
/** A lasso adds a point once the pointer has moved this far (CSS px). */
const LASSO_STEP_PX = 2;

export const MOVE_MARKUP = "Move markup";
export const MOVE_MARKUPS = "Move markups";
export const DELETE_MARKUP = "Delete markup";
export const DELETE_MARKUPS = "Delete markups";
export const RESTORE_MARKUPS = "Restore markups";
export const RESIZE_MARKUP = "Resize markup";
export const RESIZE_MARKUPS = "Resize markups";
export const ROTATE_MARKUP = "Rotate markup";
export const ROTATE_MARKUPS = "Rotate markups";
export const MOVE_VERTEX = "Move vertex";
export const COPY_MARKUP = "Copy markup";
export const COPY_MARKUPS = "Copy markups";
export const PASTE_MARKUP = "Paste markup";
export const PASTE_MARKUPS = "Paste markups";
export const CROSSING_AREA = "The area would cross itself, so the vertex went back.";

/** Story 5.2: rotation steps in degrees (Shift: fine). */
const ROTATE_STEP = 15;
const ROTATE_FINE_STEP = 1;

/** Story 5.2: what a handle drag or a copy works on: the markups as they were, their box, and the copies' ids. */
type Edit =
  | { kind: "resize"; at: HandleAt; box: Rect; before: Markup[] }
  | { kind: "rotate"; box: Rect; before: Markup[] }
  | { kind: "vertex"; index: number; before: Markup[] }
  | { kind: "copy"; before: Markup[]; ids: string[] };

type Gesture = {
  at: SelectContext;
  start: Point;
  /** The markup pressed on (geometry or caption); null on empty space. */
  hit: Markup | null;
  kind: "press" | "move" | "marquee" | "lasso" | "edit";
  /** The marquee's far corner, or the lasso's loop (user space). */
  points: Point[];
  moved: boolean;
  edit?: Edit;
};

/** Story 5.2: the app's own clipboard (D4: per browser tab), the markups as copied. */
let clipboard: readonly Markup[] = [];

let gesture: Gesture | null = null;
let cached: { markups: readonly Markup[]; pageId: string; userUnit: number; index: MarkupIndex } | null = null;

/** The page's markups in an R-tree, built again only when the document's markups change. */
function indexOf(documentId: string, pageIndex: number, userUnit: number): MarkupIndex {
  const all = markupsOf(editorStore.getState(), documentId);
  const pageId = pageIdOf(documentId, pageIndex);
  if (!cached || cached.markups !== all || cached.pageId !== pageId || cached.userUnit !== userUnit) {
    cached = { markups: all, pageId, userUnit, index: new MarkupIndex(all.filter((m) => m.pageId === pageId), userUnit) };
  }
  return cached.index;
}

type CaptionAt = (view: LayerView, device: Point) => string | null;

/** The markup at the pointer: a caption first (it sits over its markup), then the geometry. */
function hitAt(point: Point, at: SelectContext, captionAt: CaptionAt): Markup | null {
  const index = indexOf(at.documentId, at.pageIndex, at.view.userUnit);
  const caption = captionAt(at.view, at.device);
  return (caption ? index.markups.find((m) => m.id === caption) : undefined) ?? index.hit(point, at.tolerance);
}

/** The selected markups on the context's page, as stored, in drawing order. */
function selectedOnPage(at: { documentId: string; pageIndex: number }): Markup[] {
  const ids = new Set(editorStore.getState().selection.ids);
  const pageId = pageIdOf(at.documentId, at.pageIndex);
  return markupsOf(editorStore.getState(), at.documentId).filter((m) => ids.has(m.id) && m.pageId === pageId);
}

/** Story 5.1 / 5.2: the Select cursor at the pointer: a handle's, `move` over a markup, else null. */
export function selectCursorAt(point: Point, at: SelectContext, captionAt: CaptionAt): string | null {
  const handle = handleAt(handlesOf(selectedOnPage(at), at.view), at.device, at.view.dpr);
  if (handle) return handle.cursor;
  return hitAt(point, at, captionAt) ? (at.ctrl ? "copy" : "move") : null;
}

/** Story 5.2: the markups of an edit as they would be with the pointer at `point`. */
function edited(e: Edit, g: Gesture, point: Point): Markup[] {
  const d = { x: point.x - g.start.x, y: point.y - g.start.y };
  switch (e.kind) {
    case "resize": {
      // The handle follows the pointer from where it was pressed (it sits outside the box).
      const from = { x: e.box.x + e.at.u * e.box.width + d.x, y: e.box.y + e.at.v * e.box.height + d.y };
      const { anchor, sx, sy } = resizeOf(e.box, e.at, from, g.at.shift, g.at.alt);
      return e.before.map((m) => transformMarkup(m, scaleAbout(anchor, sx, sy)));
    }
    case "rotate": {
      const centre = { x: e.box.x + e.box.width / 2, y: e.box.y + e.box.height / 2 };
      const a = rotationOf(centre, g.start, point, g.at.shift ? ROTATE_FINE_STEP : ROTATE_STEP);
      return e.before.map((m) => transformMarkup(m, rotateAbout(centre, a), rotateVector(a)));
    }
    case "vertex": {
      const [m] = e.before;
      const v = m.points[e.index];
      return [setVertex(m, e.index, { x: v.x + d.x, y: v.y + d.y })];
    }
    case "copy": {
      const move = g.at.shift ? constrain45(d) : d;
      let i = 0;
      return copiesOf(e.before, move, pageIdOf(g.at.documentId, g.at.pageIndex), () => e.ids[i++], new Date().toISOString());
    }
  }
}

function showEdit(e: Edit, g: Gesture, point: Point): void {
  const after = edited(e, g, point);
  if (e.kind === "copy") setPreview({ documentId: g.at.documentId, changed: {}, added: after });
  else setPreview({ documentId: g.at.documentId, changed: Object.fromEntries(after.map((m) => [m.id, m])), added: [] });
}

/** Story 5.2: keeps an edit as one undo step (an area edited into a crossing outline goes back, D6). */
function commitEdit(e: Edit, g: Gesture, point: Point): void {
  setPreview(null);
  const after = edited(e, g, point);
  const many = e.before.length > 1;
  const documentId = g.at.documentId;
  if (e.kind === "copy") {
    executeOp({ kind: "markups.add", documentId, markups: after }, many ? COPY_MARKUPS : COPY_MARKUP);
    setSelection(after.map((m) => m.id));
    return;
  }
  if (e.kind === "vertex" && after[0].type === "area" && selfIntersects(after[0].points)) {
    toast({ title: CROSSING_AREA, variant: "info" });
    return;
  }
  const label = e.kind === "vertex" ? MOVE_VERTEX : e.kind === "resize" ? (many ? RESIZE_MARKUPS : RESIZE_MARKUP) : many ? ROTATE_MARKUPS : ROTATE_MARKUP;
  executeOp({ kind: "markups.update", documentId, before: e.before, after }, label);
}

/** The selection with `ids` added (`add`) or replacing it, in selection order. */
function select(ids: readonly string[], add: boolean): void {
  if (!add) return void setSelection(ids);
  const current = editorStore.getState().selection.ids;
  setSelection([...current, ...ids.filter((id) => !current.includes(id))]);
}

function toggle(id: string): void {
  const current = editorStore.getState().selection.ids;
  setSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}

/** Shift + click on a caption (a caption drag that did not move): adds or takes out its markup. */
export function toggleSelected(id: string): void {
  toggle(id);
}

/** Keeps the move in progress as one undo step; nothing when it did not move. */
function commitMove(): boolean {
  const drag = editorStore.getState().tools.moveDrag;
  setMoveDrag(null);
  if (!drag || (drag.delta.x === 0 && drag.delta.y === 0)) return false;
  const ids = new Set(drag.ids);
  const before = markupsOf(editorStore.getState(), drag.documentId).filter((m) => ids.has(m.id));
  if (before.length === 0) return false;
  const after = before.map((m) => translateMarkup(m, drag.delta));
  executeOp({ kind: "markups.update", documentId: drag.documentId, before, after }, before.length === 1 ? MOVE_MARKUP : MOVE_MARKUPS);
  return true;
}

/** Story 5.1: a Select press, drag, release or cancel at `point` (user space). */
export function selectGesture(phase: "start" | "move" | "end" | "cancel", point: Point, at: SelectContext, captionAt: CaptionAt): void {
  if (phase === "start") {
    // A nudge still held is kept before anything else.
    commitMove();
    // Story 5.2: a handle of the selection.
    const selected = selectedOnPage(at);
    const handles = handlesOf(selected, at.view);
    const handle = handleAt(handles, at.device, at.view.dpr);
    if (handle && handles) {
      const edit: Edit =
        handle.kind === "resize"
          ? { kind: "resize", at: handle.at, box: handles.box, before: selected }
          : handle.kind === "rotate"
            ? { kind: "rotate", box: handles.box, before: selected }
            : { kind: "vertex", index: handle.index, before: selected };
      gesture = { at, start: point, hit: null, kind: "edit", points: [point], moved: false, edit };
      return;
    }
    const hit = at.alt ? null : hitAt(point, at, captionAt);
    gesture = { at, start: point, hit, kind: at.alt ? "lasso" : hit ? "press" : "marquee", points: [point], moved: false };
    return;
  }
  const g = gesture;
  if (!g) return;
  if (phase === "cancel") {
    gesture = null;
    setMoveDrag(null);
    setPreview(null);
    notifyMarkups({ activeOnly: true });
    return;
  }
  const px = g.at.px;
  if (!g.moved && Math.hypot(point.x - g.start.x, point.y - g.start.y) >= CLICK_PX * px) g.moved = true;
  if (phase === "move") {
    if (!g.moved) return;
    if (g.kind === "press" && g.hit && g.at.ctrl) {
      // Story 5.2: Ctrl + drag copies the selection (a markup not selected is selected first).
      const selected = editorStore.getState().selection.ids;
      if (!selected.includes(g.hit.id)) setSelection([g.hit.id]);
      const before = selectedOnPage(g.at);
      g.kind = "edit";
      g.edit = { kind: "copy", before, ids: before.map(() => uuidv7()) };
    } else if (g.kind === "press" && g.hit && !g.at.shift) {
      // A markup not selected is selected first; a selected one moves the whole selection.
      const selected = editorStore.getState().selection.ids;
      const ids = selected.includes(g.hit.id) ? selected : [g.hit.id];
      setSelection(ids);
      g.kind = "move";
    }
    if (g.kind === "move") setMoveDrag({ ids: editorStore.getState().selection.ids, documentId: g.at.documentId, delta: { x: point.x - g.start.x, y: point.y - g.start.y } });
    else if (g.kind === "edit" && g.edit) showEdit(g.edit, g, point);
    else if (g.kind === "marquee") g.points = [point];
    else if (g.kind === "lasso") {
      const last = g.points[g.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) >= LASSO_STEP_PX * px) g.points.push(point);
    }
    if (g.kind === "marquee" || g.kind === "lasso") notifyMarkups({ activeOnly: true });
    return;
  }
  // End.
  gesture = null;
  const index = indexOf(g.at.documentId, g.at.pageIndex, g.at.view.userUnit);
  if (g.kind === "move") {
    setMoveDrag({ ids: editorStore.getState().selection.ids, documentId: g.at.documentId, delta: { x: point.x - g.start.x, y: point.y - g.start.y } });
    commitMove();
  } else if (g.kind === "edit") {
    // A handle pressed without moving does nothing.
    setPreview(null);
    if (g.moved && g.edit) commitEdit(g.edit, g, point);
  } else if (g.kind === "press" && g.hit) {
    if (g.at.shift) toggle(g.hit.id);
    else setSelection([g.hit.id]);
  } else if (!g.moved) {
    // A click on empty space (also an Alt + click).
    if (!g.at.shift) setSelection([]);
  } else if (g.kind === "marquee") {
    select(
      index.inRect(rectOf(g.start, point)).map((m) => m.id),
      g.at.shift,
    );
  } else if (g.kind === "lasso") {
    select(
      index.inLoop([...g.points, point]).map((m) => m.id),
      g.at.shift,
    );
  }
  notifyMarkups({ activeOnly: true });
}

/** Story 5.1: the selection keys on the shown page; true when one acted. */
export function selectionKey(key: SelectionKey, at: { documentId: string; pageIndex: number }): boolean {
  const state = editorStore.getState();
  const markups = markupsOf(state, at.documentId);
  const present = new Set(markups.map((m) => m.id));
  const ids = state.selection.ids.filter((id) => present.has(id));
  switch (key.kind) {
    case "all": {
      const pageId = pageIdOf(at.documentId, at.pageIndex);
      setSelection(markups.filter((m) => m.pageId === pageId).map((m) => m.id));
      return true;
    }
    case "nudge-end":
      return commitMove();
    case "nudge": {
      if (ids.length === 0 || gesture) return false;
      const drag = state.tools.moveDrag;
      const delta = drag && drag.documentId === at.documentId ? drag.delta : { x: 0, y: 0 };
      setMoveDrag({ ids, documentId: at.documentId, delta: { x: delta.x + key.dx, y: delta.y + key.dy } });
      return true;
    }
    case "copy": {
      if (ids.length === 0) return false;
      const wanted = new Set(ids);
      clipboard = markups.filter((m) => wanted.has(m.id));
      return true;
    }
    case "paste": {
      if (clipboard.length === 0 || gesture) return false;
      commitMove();
      // D5: centred at the pointer; in place: the same coordinates.
      const box = boxOf(clipboard);
      const d = key.inPlace ? { x: 0, y: 0 } : { x: key.at.x - (box.x + box.width / 2), y: key.at.y - (box.y + box.height / 2) };
      const copies = copiesOf(clipboard, d, pageIdOf(at.documentId, at.pageIndex), uuidv7, new Date().toISOString());
      executeOp({ kind: "markups.add", documentId: at.documentId, markups: copies }, copies.length === 1 ? PASTE_MARKUP : PASTE_MARKUPS);
      setSelection(copies.map((m) => m.id));
      return true;
    }
    case "delete": {
      if (ids.length === 0 || gesture) return false;
      commitMove();
      const op = removeMarkupsOp(at.documentId, markupsOf(editorStore.getState(), at.documentId), ids);
      if (!op) return false;
      executeOp(op, ids.length === 1 ? DELETE_MARKUP : DELETE_MARKUPS);
      // UX-DR32: an undoable delete does not confirm; the toast offers Undo.
      const undo = undoDelete(op);
      toast({ title: `Deleted ${ids.length} ${ids.length === 1 ? "markup" : "markups"}`, action: { label: "Undo", onAction: undo } });
      return true;
    }
  }
}

/**
 * The delete toast's Undo (review R1): undoes the delete while it is still the last step of its
 * tab; after other edits (or in another tab) it puts back the markups still missing as a new step.
 */
function undoDelete(op: DocOp): () => void {
  const tabId = editorStore.getState().view.tabId;
  const command = editorStore.getState().history.histories[tabId ?? ""]?.past.at(-1);
  return () => {
    const state = editorStore.getState();
    if (command && state.view.tabId === tabId && state.history.histories[tabId ?? ""]?.past.at(-1) === command) return void undoActive();
    if (op.kind !== "markups.remove") return;
    const present = new Set(markupsOf(state, op.documentId).map((m) => m.id));
    if (op.markups.some((m) => present.has(m.id))) return;
    executeOp(invertOp(op), RESTORE_MARKUPS, tabId ?? undefined);
  };
}

/** Layer 3 with Select: the marquee or the lasso in progress (the accent, dashed, over a white halo). */
export function paintSelectGesture(c: CanvasRenderingContext2D, view: LayerView): void {
  const g = gesture;
  if (!g || !g.moved || (g.kind !== "marquee" && g.kind !== "lasso")) return;
  if (g.at.documentId !== view.documentId || g.at.pageIndex !== view.pageIndex) return;
  const pts = (g.kind === "marquee" ? [g.start, { x: g.points[0].x, y: g.start.y }, g.points[0], { x: g.start.x, y: g.points[0].y }] : g.points).map((p) =>
    view.toDevice(p),
  );
  if (pts.length < 2) return;
  c.save();
  c.beginPath();
  pts.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
  c.closePath();
  c.lineJoin = "miter";
  c.setLineDash([]);
  c.strokeStyle = view.colors.halo;
  c.lineWidth = 3 * view.dpr;
  c.stroke();
  c.setLineDash([4 * view.dpr, 3 * view.dpr]);
  c.strokeStyle = view.colors.selection;
  c.lineWidth = 1 * view.dpr;
  c.stroke();
  c.restore();
}

/** Forgets the gesture in progress (the tools are uninstalled, tests); `clipboard` too. */
export function resetSelectTool({ clipboard: clear = false } = {}): void {
  gesture = null;
  cached = null;
  if (clear) clipboard = [];
}
