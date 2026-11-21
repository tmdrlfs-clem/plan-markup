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
//
// Story 5.3: selecting one member of a group selects the group; Ctrl+G groups,
// Ctrl+Shift+G ungroups; the drawing order steps (front, forward, backward,
// back); align lines the units up as the screen shows them; locked markups
// can be selected, copied and reordered but not moved, edited or deleted (the
// cursor and a note say so). A right-click opens the context menu
// (tools.menu, markup-context-menu.tsx).

import { toast } from "@/components/ui/toast-store";
import { invertOp, removeMarkupsOp, reorderMarkupsOp, type DocOp } from "@/core/commands/ops";
import { pageIdOf } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import { rectOf, translateMarkup, type Point, type Rect } from "@/core/markup/geometry";
import { alignOffsets, stepOrder, unitsOf, withGroups, withPageOrder, type OrderStep } from "@/core/markup/arrange";
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
import { LOCKED_CURSOR, notifyMarkups, type LayerView, type SelectContext, type SelectionKey } from "@/features/viewer";

import { revealFlag, ruleMarkerAt } from "./rule-markers";
import { editorStore, isLocked, isShown, markupsOf, setMarkupMenu, setMoveDrag, setPreview, setSelection } from "./editor-store";
import { boxOf, handleAt, handlesOf } from "./handles";
import { executeOp, undoActive } from "./undo-store";
import { paintFormat } from "./properties";

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
export const GROUP_MARKUPS = "Group markups";
export const UNGROUP_MARKUPS = "Ungroup markups";
export const ALIGN_MARKUPS = "Align markups";
export const LOCK_MARKUP = "Lock markup";
export const LOCK_MARKUPS = "Lock markups";
export const UNLOCK_MARKUP = "Unlock markup";
export const UNLOCK_MARKUPS = "Unlock markups";
export const ORDER_LABEL: Readonly<Record<OrderStep, string>> = {
  front: "Bring to front",
  forward: "Bring forward",
  backward: "Send backward",
  back: "Send to back",
};
export const LOCKED_NOTE = "Locked markups can't be moved, edited or deleted. Right-click to unlock.";
/** A note about locked markups shows at most this often (ms; a held key or a drag would repeat it). */
const LOCKED_NOTE_MS = 3000;

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
  /** `locked`: a drag on locked markups only (Story 5.3: nothing moves). */
  kind: "press" | "move" | "marquee" | "lasso" | "edit" | "locked";
  /** The marquee's far corner, or the lasso's loop (user space). */
  points: Point[];
  moved: boolean;
  edit?: Edit;
};

/** Story 5.2: the app's own clipboard (D4: per browser tab), the markups as copied. */
let clipboard: readonly Markup[] = [];

let gesture: Gesture | null = null;
let cached: { markups: readonly Markup[]; layers: unknown; pageId: string; userUnit: number; index: MarkupIndex } | null = null;

/** The page's markups in an R-tree, built again only when the document's markups change. */
function indexOf(documentId: string, pageIndex: number, userUnit: number): MarkupIndex {
  const state = editorStore.getState();
  const all = markupsOf(state, documentId);
  const layers = state.doc.layers[documentId];
  const pageId = pageIdOf(documentId, pageIndex);
  if (!cached || cached.markups !== all || cached.layers !== layers || cached.pageId !== pageId || cached.userUnit !== userUnit) {
    // Story 5.12: a hidden layer's markups are not picked.
    cached = { markups: all, layers, pageId, userUnit, index: new MarkupIndex(all.filter((m) => m.pageId === pageId && isShown(m, state)), userUnit) };
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

/** Story 5.3: the selected markups that may change (not locked). */
function editableOnPage(at: { documentId: string; pageIndex: number }): Markup[] {
  return selectedOnPage(at).filter((m) => !isLocked(m));
}

/** Story 5.3: `ids` with the rest of their groups on the page. */
function grouped(at: { documentId: string; pageIndex: number }, ids: readonly string[]): string[] {
  const pageId = pageIdOf(at.documentId, at.pageIndex);
  return withGroups(
    markupsOf(editorStore.getState(), at.documentId).filter((m) => m.pageId === pageId),
    ids,
  );
}

let lockedNoteAt = -Infinity;

/** Story 5.3 (UX: locked markups never fail silently): says why nothing changed, not too often. */
export function lockedNote(): void {
  const now = Date.now();
  if (now - lockedNoteAt < LOCKED_NOTE_MS) return;
  lockedNoteAt = now;
  toast({ title: LOCKED_NOTE, variant: "info" });
}

/** Story 5.1 / 5.2: the Select cursor at the pointer: a handle's, `move` over a markup (5.3: not-allowed when locked), else null. */
/** Whether a Select press, drag or handle edit is under way. */
export function selectGestureActive(): boolean {
  return gesture !== null;
}

/** The cursor of the selection's handle at the pointer (a placed tool's, while Stamp is armed); null: none there. */
export function handleCursorAt(at: SelectContext): string | null {
  return handleAt(handlesOf(editableOnPage(at), at.view), at.device, at.view.dpr)?.cursor ?? null;
}

export function selectCursorAt(point: Point, at: SelectContext, captionAt: CaptionAt): string | null {
  // Story 9.11: a rule-break marker is a button.
  if (ruleMarkerAt(at.device, at, at.view.dpr)) return "pointer";
  const handle = handleAt(handlesOf(editableOnPage(at), at.view), at.device, at.view.dpr);
  if (handle) return handle.cursor;
  const hit = hitAt(point, at, captionAt);
  if (!hit) return null;
  if (at.ctrl) return "copy";
  return isLocked(hit) ? LOCKED_CURSOR : "move";
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

/** Adds or takes out `ids` (a markup and the rest of its group, Story 5.3) together. */
function toggle(ids: readonly string[]): void {
  const current = editorStore.getState().selection.ids;
  const out = new Set(ids);
  setSelection(current.includes(ids[0]) ? current.filter((x) => !out.has(x)) : [...current, ...ids.filter((x) => !current.includes(x))]);
}

/** Shift + click on a caption (a caption drag that did not move): adds or takes out its markup (5.3: its group). */
export function toggleSelected(id: string): void {
  const state = editorStore.getState();
  const documentId = state.view.documentId;
  const all = markupsOf(state, documentId);
  const m = all.find((x) => x.id === id);
  toggle(m ? withGroups(all.filter((x) => x.pageId === m.pageId), [id]) : [id]);
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
    // Story 9.11: a rule-break marker (drawn over everything) shows its break.
    const marker = ruleMarkerAt(at.device, at, at.view.dpr);
    if (marker) {
      revealFlag(marker);
      return;
    }
    // Story 5.2: a handle of the selection (5.3: of its markups that are not locked).
    const selected = editableOnPage(at);
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
    // Story 5.10: with the format painter out, a press on a markup applies the format (and ends there).
    if (paintFormat(hit, at.documentId)) return;
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
      if (!selected.includes(g.hit.id)) setSelection(grouped(g.at, [g.hit.id]));
      const before = selectedOnPage(g.at);
      g.kind = "edit";
      g.edit = { kind: "copy", before, ids: before.map(() => uuidv7()) };
    } else if (g.kind === "press" && g.hit && !g.at.shift) {
      // A markup not selected is selected first; a selected one moves the whole selection.
      const selected = editorStore.getState().selection.ids;
      const ids = selected.includes(g.hit.id) ? selected : grouped(g.at, [g.hit.id]);
      setSelection(ids);
      // Story 5.3: locked markups stay; a drag from a locked one (its cursor says so, review R2)
      // or with nothing else to move only says so.
      if (isLocked(g.hit) || editableOnPage(g.at).length === 0) {
        lockedNote();
        g.kind = "locked";
      } else g.kind = "move";
    }
    if (g.kind === "move") setMoveDrag({ ids: editableOnPage(g.at).map((m) => m.id), documentId: g.at.documentId, delta: { x: point.x - g.start.x, y: point.y - g.start.y } });
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
    setMoveDrag({ ids: editableOnPage(g.at).map((m) => m.id), documentId: g.at.documentId, delta: { x: point.x - g.start.x, y: point.y - g.start.y } });
    commitMove();
  } else if (g.kind === "edit") {
    // A handle pressed without moving does nothing.
    setPreview(null);
    if (g.moved && g.edit) commitEdit(g.edit, g, point);
  } else if (g.kind === "press" && g.hit) {
    if (g.at.shift) toggle(grouped(g.at, [g.hit.id]));
    else setSelection(grouped(g.at, [g.hit.id]));
  } else if (!g.moved) {
    // A click on empty space (also an Alt + click).
    if (!g.at.shift) setSelection([]);
  } else if (g.kind === "marquee") {
    select(
      grouped(
        g.at,
        index.inRect(rectOf(g.start, point)).map((m) => m.id),
      ),
      g.at.shift,
    );
  } else if (g.kind === "lasso") {
    select(
      grouped(
        g.at,
        index.inLoop([...g.points, point]).map((m) => m.id),
      ),
      g.at.shift,
    );
  }
  notifyMarkups({ activeOnly: true });
}

/** Story 5.1: the selection keys on the shown page; true when one acted. */
export function selectionKey(key: SelectionKey, at: { documentId: string; pageIndex: number; view?: LayerView }): boolean {
  const state = editorStore.getState();
  const markups = markupsOf(state, at.documentId);
  const present = new Set(markups.map((m) => m.id));
  const ids = state.selection.ids.filter((id) => present.has(id));
  switch (key.kind) {
    case "all": {
      const pageId = pageIdOf(at.documentId, at.pageIndex);
      setSelection(markups.filter((m) => m.pageId === pageId && isShown(m)).map((m) => m.id));
      return true;
    }
    case "nudge-end":
      return commitMove();
    case "nudge": {
      if (ids.length === 0 || gesture) return false;
      // Story 5.3: locked markups stay.
      const free = editableOnPage(at).map((m) => m.id);
      if (free.length === 0) {
        lockedNote();
        return true;
      }
      const drag = state.tools.moveDrag;
      const delta = drag && drag.documentId === at.documentId ? drag.delta : { x: 0, y: 0 };
      setMoveDrag({ ids: free, documentId: at.documentId, delta: { x: delta.x + key.dx, y: delta.y + key.dy } });
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
      // Story 5.3: locked markups are kept (and the toast says so).
      const locked = new Set(markups.filter((m) => isLocked(m)).map((m) => m.id));
      const free = ids.filter((id) => !locked.has(id));
      const kept = ids.length - free.length;
      if (free.length === 0) {
        lockedNote();
        return true;
      }
      const op = removeMarkupsOp(at.documentId, markupsOf(editorStore.getState(), at.documentId), free);
      if (!op) return false;
      executeOp(op, free.length === 1 ? DELETE_MARKUP : DELETE_MARKUPS);
      // UX-DR32: an undoable delete does not confirm; the toast offers Undo.
      const undo = undoDelete(op);
      const title = `Deleted ${free.length} ${free.length === 1 ? "markup" : "markups"}${kept > 0 ? `, kept ${kept} locked` : ""}`;
      toast({ title, action: { label: "Undo", onAction: undo } });
      return true;
    }
    case "group":
    case "ungroup":
    case "lock":
    case "order":
    case "align":
      if (gesture) return false;
      commitMove();
      return arrange(key, at);
  }
}

type ArrangeKey = Extract<SelectionKey, { kind: "group" | "ungroup" | "lock" | "order" | "align" }>;

/** Story 5.3: group, ungroup, lock / unlock, the drawing order and align, each one undo step; false when nothing changed. */
function arrange(key: ArrangeKey, at: { documentId: string; pageIndex: number; view?: LayerView }): boolean {
  const documentId = at.documentId;
  const selected = selectedOnPage(at);
  const update = (before: Markup[], after: Markup[], label: string) => {
    if (before.length === 0) return false;
    executeOp({ kind: "markups.update", documentId, before, after }, label);
    return true;
  };
  switch (key.kind) {
    case "group": {
      // D1: groups do not nest; one group already: nothing.
      const one = selected.length > 0 && selected.every((m) => m.groupId && m.groupId === selected[0].groupId);
      if (selected.length < 2 || one) return false;
      const groupId = uuidv7();
      return update(
        selected,
        selected.map((m) => ({ ...m, groupId })),
        GROUP_MARKUPS,
      );
    }
    case "ungroup": {
      const before = selected.filter((m) => m.groupId);
      return update(before, before.map(withoutGroup), UNGROUP_MARKUPS);
    }
    case "lock": {
      const before = selected.filter((m) => !!m.locked !== key.locked);
      const after = before.map((m) => (key.locked ? { ...m, locked: true } : withoutLock(m)));
      const many = before.length > 1;
      return update(before, after, key.locked ? (many ? LOCK_MARKUPS : LOCK_MARKUP) : many ? UNLOCK_MARKUPS : UNLOCK_MARKUP);
    }
    case "order": {
      if (selected.length === 0) return false;
      const all = markupsOf(editorStore.getState(), documentId);
      const pageId = pageIdOf(documentId, at.pageIndex);
      const page = all.filter((m) => m.pageId === pageId).map((m) => m.id);
      const order = withPageOrder(all, pageId, stepOrder(page, new Set(selected.map((m) => m.id)), key.step));
      const op = reorderMarkupsOp(documentId, all, order);
      if (!op) return false;
      executeOp(op, ORDER_LABEL[key.step]);
      return true;
    }
    case "align": {
      const units = unitsOf(selected);
      if (units.length < 2) return false;
      const offsets = alignOffsets(
        units.map((u) => screenBox(boxOf(u), at.view)),
        key.to,
        units.map((u) => u.some((m) => isLocked(m))),
      );
      const before: Markup[] = [];
      const after: Markup[] = [];
      units.forEach((u, i) => {
        const d = userVector(offsets[i], at.view);
        if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return;
        for (const m of u) {
          before.push(m);
          after.push(translateMarkup(m, d));
        }
      });
      return update(before, after, ALIGN_MARKUPS);
    }
  }
}

function withoutGroup(m: Markup): Markup {
  const next = { ...m };
  delete next.groupId;
  return next;
}

function withoutLock(m: Markup): Markup {
  const next = { ...m };
  delete next.locked;
  return next;
}

/** Story 5.3: a user-space box as the screen shows it (device px, y down); without a view, user space flipped. */
function screenBox(b: Rect, view?: LayerView): Rect {
  if (!view) return { x: b.x, y: -(b.y + b.height), width: b.width, height: b.height };
  const ps = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height },
  ].map((p) => view.toDevice(p));
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Story 5.3: a screen (device px) move in user space (the inverse of the view's linear part). */
function userVector(d: Point, view?: LayerView): Point {
  if (!view) return { x: d.x, y: -d.y };
  const o = view.toDevice({ x: 0, y: 0 });
  const ex = view.toDevice({ x: 1, y: 0 });
  const ey = view.toDevice({ x: 0, y: 1 });
  const a = ex.x - o.x;
  const b = ey.x - o.x;
  const c = ex.y - o.y;
  const e = ey.y - o.y;
  const det = a * e - b * c;
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
  return { x: (e * d.x - b * d.y) / det, y: (a * d.y - c * d.x) / det };
}

/**
 * Story 5.3: a right-click at `point` with Select: a markup not selected is selected (with its
 * group), empty space clears the selection (D6); the menu key keeps it. Opens the context menu.
 */
export function openMarkupMenu(point: Point, at: SelectContext, client: Point, keyboard: boolean, captionAt: CaptionAt): boolean {
  if (gesture) return false;
  commitMove();
  if (!keyboard) {
    const hit = hitAt(point, at, captionAt);
    if (!hit) setSelection([]);
    else if (!editorStore.getState().selection.ids.includes(hit.id)) setSelection(grouped(at, [hit.id]));
  }
  setMarkupMenu({ documentId: at.documentId, pageIndex: at.pageIndex, view: at.view, point, client });
  notifyMarkups({ activeOnly: true });
  return true;
}

/** Story 5.3: whether the app's clipboard holds markups (the menus' Paste). */
export function hasClipboard(): boolean {
  return clipboard.length > 0;
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
  lockedNoteAt = -Infinity;
  if (clear) clipboard = [];
}
