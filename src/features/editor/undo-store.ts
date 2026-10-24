// Undo per document tab (Story 4.3 AC 7): one history per tab in a zustand
// vanilla store, so undoing in one drawing never touches another. The active
// tab's history drives Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z and Edit > Undo / Redo.
// Commands act on the active tab's state (viewerStore), which is the tab the
// command was recorded in: only the active tab's history is ever used.
// A closed tab's history is dropped. Story 4.5 (editor foundation) builds on
// this (markup commands, serialising to sessionStorage, UX-DR36).

import { createStore } from "zustand/vanilla";

import { EMPTY_HISTORY, execute, nextLabels, redo, undo, type UndoCommand, type UndoHistory } from "@/core/undo/stack";
import { tabsStore, viewerStore } from "@/features/viewer";

export type UndoState = {
  /** Histories by tab id ("" outside tabs). */
  histories: Readonly<Record<string, UndoHistory>>;
};

export const undoStore = createStore<UndoState>(() => ({ histories: {} }));

const activeKey = () => viewerStore.getState().tabId ?? "";
const historyOf = (key: string) => undoStore.getState().histories[key] ?? EMPTY_HISTORY;

function setHistory(key: string, history: UndoHistory): void {
  undoStore.setState((s) => ({ histories: { ...s.histories, [key]: history } }));
}

/** Runs `command` in the active tab and records it as one undo step. */
export function executeCommand(command: UndoCommand): void {
  const key = activeKey();
  setHistory(key, execute(historyOf(key), command));
}

/** Undoes the active tab's last step; false when there was none. */
export function undoActive(): boolean {
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

/** The active tab's next undo / redo labels (React: useStore(undoStore, …) with viewerStore's tabId). */
export function activeUndoLabels(state: UndoState, tabId: string | null): { undo: string | null; redo: string | null } {
  return nextLabels(state.histories[tabId ?? ""] ?? EMPTY_HISTORY);
}

/** Forgets every history (tests, another user's workspace). */
export function clearUndo(): void {
  undoStore.setState({ histories: {} }, true);
}

// A closed tab's history goes with it (its commands hold that document's state).
tabsStore.subscribe((tabs) => {
  const open = new Set(tabs.tabs.map((t) => t.id));
  const histories = undoStore.getState().histories;
  const stale = Object.keys(histories).filter((k) => k !== "" && !open.has(k));
  if (stale.length === 0) return;
  const next = { ...histories };
  for (const k of stale) delete next[k];
  undoStore.setState({ histories: next });
});

// Review R5: a tab that opens its file again (Try again) starts with no calibrations, so its
// history is dropped too (an "Undo Calibrate page 1" would otherwise name a step that is gone).
viewerStore.subscribe((s, prev) => {
  if (!s.tabId || s.tabId !== prev.tabId || s.openSeq === prev.openSeq) return;
  if (!undoStore.getState().histories[s.tabId]) return;
  const next = { ...undoStore.getState().histories };
  delete next[s.tabId];
  undoStore.setState({ histories: next });
});
