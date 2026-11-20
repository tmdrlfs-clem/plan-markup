// Undo per document tab (Story 4.3 AC 7; Story 4.5 moves it into the editor
// store's `history` slice and adds op commands). One history per tab, so
// undoing in one drawing never touches another. The active tab's history
// drives Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z and Edit > Undo / Redo. Commands act on
// the active tab's state, which is the tab the command was recorded in. A
// closed tab's history is dropped; a tab that opens its file again drops its
// history (4.3 review R5) until the session restores it (session.ts).
//
// While a measurement is being drawn, Undo removes its last point instead
// (UX-DR35): the drawing tool registers that step (registerDrawingUndo).

import { invertOp, type DocOp } from "@/core/commands/ops";
import { refineHeadEdits } from "@/core/sprinkler/heads";
import { EMPTY_HISTORY, execute, nextLabels, redo, undo, type UndoCommand, type UndoHistory } from "@/core/undo/stack";
import { tabsStore, viewerStore, type DrawTool } from "@/features/viewer";

import { activeLayerOf, editorStore, markupsOf, type EditorState } from "./editor-store";
import { applyOp } from "./commands";

const activeKey = () => viewerStore.getState().tabId ?? "";
const historyOf = (key: string) => editorStore.getState().history.histories[key] ?? EMPTY_HISTORY;

function setHistory(key: string, history: UndoHistory): void {
  editorStore.setState((s) => ({ history: { histories: { ...s.history.histories, [key]: history } } }));
}

/** Sets a tab's history (the session restore only); what it restores counts as saved. */
export function setTabHistory(tabId: string, history: UndoHistory): void {
  setHistory(tabId, history);
  markTabSaved(tabId);
}

/** Where each tab's history stood at its last PDF save (Save as): its length and last step. */
const savedPoints = new Map<string, { length: number; last: UndoCommand | undefined }>();

/** The tab's drawing was just saved as a PDF (the active tab, or `tabId`). */
export function markTabSaved(tabId: string = activeKey()): void {
  const past = historyOf(tabId).past;
  savedPoints.set(tabId, { length: past.length, last: past.at(-1) });
}

/** Flatten in place / Unflatten: the tab shows a drawing not saved as a PDF yet (the close prompt asks). */
export function markTabUnsaved(tabId: string): void {
  savedPoints.set(tabId, { length: -1, last: undefined });
}

/** Whether the tab's markups changed since its last PDF save (or since it opened); undoing back to it is no change. */
export function tabChangedSinceSaved(tabId: string): boolean {
  const past = historyOf(tabId).past;
  const saved = savedPoints.get(tabId) ?? { length: 0, last: undefined };
  return past.length !== saved.length || past.at(-1) !== saved.last;
}

/** Runs `command` in the active tab (or `tabId`'s) and records it as one undo step. */
export function executeCommand(command: UndoCommand, tabId?: string): void {
  const key = tabId ?? activeKey();
  setHistory(key, execute(historyOf(key), command));
}

/** The undo command of an op: `do` applies it, `undo` applies its inverse; it serialises as the op. */
export function commandOf(op: DocOp, label: string): UndoCommand {
  return { label, op, do: () => applyOp(op), undo: () => applyOp(invertOp(op)) };
}

/**
 * Applies `op` as one undo step named `label` (AR13: every document mutation)
 * in the active tab's history, or `tabId`'s (Story 4.8: a count finished by a
 * tab switch belongs to the tab it was drawn in).
 * Story 9.10: a sprinkler head moved, copied or pasted by hand becomes manual (refineHeadEdits).
 */
export function executeOp(op: DocOp, label: string, tabId?: string): void {
  const refined = refineHeadEdits(withActiveLayer(op), markupsOf(editorStore.getState(), op.documentId));
  executeCommand(commandOf(refined, label), tabId);
}

/**
 * Story 5.12: new markups (an add with no positions: not a restore) with no layer go to the
 * document's active layer; copies keep their markups' layers.
 */
function withActiveLayer(op: DocOp): DocOp {
  if (op.kind !== "markups.add" || op.at) return op;
  const layer = activeLayerOf(editorStore.getState(), op.documentId);
  if (!layer || op.markups.every((m) => m.layerId)) return op;
  return { ...op, markups: op.markups.map((m) => (m.layerId ? m : { ...m, layerId: layer.id })) };
}

/**
 * Story 9.8: records `op`, already applied piece by piece (a Place heads run streams its heads in
 * zone by zone), as one undo step: undo applies its inverse, redo applies it again.
 */
export function recordAppliedOp(op: DocOp, label: string, tabId?: string): void {
  let applied = true;
  executeCommand(
    {
      label,
      op,
      do: () => {
        if (applied) {
          applied = false;
          return;
        }
        applyOp(op);
      },
      undo: () => applyOp(invertOp(op)),
    },
    tabId,
  );
}

let drawingUndo: (() => boolean) | null = null;

/** What Undo does in a tab with no step left (Flatten in place: Unflatten), and its menu label. */
export type FallbackUndo = { label: (tabId: string) => string | null; run: (tabId: string) => boolean };
let fallbackUndo: FallbackUndo | null = null;

/** Registers the fallback undo (one at a time). */
export function registerFallbackUndo(fallback: FallbackUndo): () => void {
  fallbackUndo = fallback;
  return () => {
    if (fallbackUndo === fallback) fallbackUndo = null;
  };
}

/** The drawing tool's undo while drawing (removes the last point; false when nothing is drawn). */
export function registerDrawingUndo(fn: (() => boolean) | null): () => void {
  drawingUndo = fn;
  return () => {
    if (drawingUndo === fn) drawingUndo = null;
  };
}

/** Undoes the active tab's last step (or the last point of a drawing in progress); false when there was none. */
export function undoActive(): boolean {
  if (drawingUndo?.()) return true;
  const key = activeKey();
  const before = historyOf(key);
  if (before.past.length === 0) return fallbackUndo?.run(key) ?? false;
  setHistory(key, undo(before));
  return true;
}

/** Redoes the active tab's last undone step; false when there was none. */
export function redoActive(): boolean {
  const key = activeKey();
  const before = historyOf(key);
  if (before.future.length === 0) return false;
  setHistory(key, redo(before));
  return true;
}

/** 4.5 review R5: what Undo does while a measurement is being drawn (it removes the last placed point). */
export const DRAWING_POINT_LABEL: Readonly<Record<DrawTool, string>> = {
  length: "Length point",
  polylength: "Polylength point",
  area: "Area point",
  count: "Count point",
  angle: "Angle point",
  radius: "Radius point",
  diameter: "Diameter point",
  // Story 4.10: while filling, Undo takes back the last stroke.
  fill: "Fill stroke",
  // Story 5.4.
  line: "Line point",
  arrow: "Arrow point",
  polyline: "Polyline point",
  polygon: "Polygon point",
  // Story 5.5.
  rectangle: "Rectangle corner",
  ellipse: "Ellipse corner",
  cloud: "Cloud point",
  // Story 5.6.
  text: "Text box corner",
  callout: "Callout point",
  typewriter: "Typewriter point",
  note: "Note point",
  cloudplus: "Cloud+ point",
  // Story 5.7 (a stroke is drawn in one press; Undo during it takes it back).
  pen: "Pen stroke",
  highlight: "Highlight stroke",
  // Story 5.11.
  whiteout: "White-out corner",
  whiteoutpolygon: "White-out point",
  eraser: "Eraser stroke",
  // Story 5.8.
  image: "Image point",
  dimension: "Dimension point",
  // Story 5.9 (a drag; Undo during it takes it back).
  underline: "Underline selection",
  strikethrough: "Strikethrough selection",
  // Story 7.3 (a placement is one click).
  stamp: "Tool placement",
  revision: "Revision stamp",
  legend: "Legend",
};

/**
 * The active tab's next undo / redo labels (React: useStore(editorStore, …) with viewerStore's tabId).
 * While drawing, Undo removes the drawing's point (UX-DR35), so the menu says that, not the history's step.
 */
export function activeUndoLabels(state: EditorState, tabId: string | null): { undo: string | null; redo: string | null } {
  const labels = nextLabels(state.history.histories[tabId ?? ""] ?? EMPTY_HISTORY);
  if (state.tools.drawing) return { ...labels, undo: DRAWING_POINT_LABEL[state.tools.drawing.tool] };
  // A tab with no step left: what the fallback undoes (Flatten).
  return labels.undo === null && tabId && fallbackUndo ? { ...labels, undo: fallbackUndo.label(tabId) } : labels;
}

/** Forgets every history (tests, another user's workspace). */
export function clearUndo(): void {
  editorStore.setState({ history: { histories: {} } });
  savedPoints.clear();
}

function dropHistory(tabId: string): void {
  savedPoints.delete(tabId);
  const histories = editorStore.getState().history.histories;
  if (!histories[tabId]) return;
  const next = { ...histories };
  delete next[tabId];
  editorStore.setState({ history: { histories: next } });
}

// A closed tab's history goes with it (its commands hold that document's state).
tabsStore.subscribe((tabs) => {
  const open = new Set(tabs.tabs.map((t) => t.id));
  for (const k of Object.keys(editorStore.getState().history.histories)) if (k !== "" && !open.has(k)) dropHistory(k);
});

// Review R5: a tab that opens its file again (Try again) starts without its document state, so
// its history is dropped too; the session restores both together when the document is back.
viewerStore.subscribe((s, prev) => {
  if (!s.tabId || s.tabId !== prev.tabId || s.openSeq === prev.openSeq) return;
  dropHistory(s.tabId);
});
