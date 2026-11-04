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
import { EMPTY_HISTORY, execute, nextLabels, redo, undo, type UndoCommand, type UndoHistory } from "@/core/undo/stack";
import { tabsStore, viewerStore, type DrawTool } from "@/features/viewer";

import { editorStore, type EditorState } from "./editor-store";
import { applyOp } from "./commands";

const activeKey = () => viewerStore.getState().tabId ?? "";
const historyOf = (key: string) => editorStore.getState().history.histories[key] ?? EMPTY_HISTORY;

function setHistory(key: string, history: UndoHistory): void {
  editorStore.setState((s) => ({ history: { histories: { ...s.history.histories, [key]: history } } }));
}

/** Sets a tab's history (the session restore only). */
export function setTabHistory(tabId: string, history: UndoHistory): void {
  setHistory(tabId, history);
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
 */
export function executeOp(op: DocOp, label: string, tabId?: string): void {
  executeCommand(commandOf(op, label), tabId);
}

let drawingUndo: (() => boolean) | null = null;

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
  if (before.past.length === 0) return false;
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
};

/**
 * The active tab's next undo / redo labels (React: useStore(editorStore, …) with viewerStore's tabId).
 * While drawing, Undo removes the drawing's point (UX-DR35), so the menu says that, not the history's step.
 */
export function activeUndoLabels(state: EditorState, tabId: string | null): { undo: string | null; redo: string | null } {
  const labels = nextLabels(state.history.histories[tabId ?? ""] ?? EMPTY_HISTORY);
  return state.tools.drawing ? { ...labels, undo: DRAWING_POINT_LABEL[state.tools.drawing.tool] } : labels;
}

/** Forgets every history (tests, another user's workspace). */
export function clearUndo(): void {
  editorStore.setState({ history: { histories: {} } });
}

function dropHistory(tabId: string): void {
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
