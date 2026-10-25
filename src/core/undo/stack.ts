// The undo history as command objects (Story 4.3 AC 7, architecture: "undo
// stack as command objects"). Framework-free and immutable: every operation
// returns a new history, so a zustand store can hold it and React can select
// from it. Story 4.5 (editor foundation) extends this (merging, grouping,
// serialising to sessionStorage, UX-DR36) rather than replacing it.

import type { DocOp } from "@/core/commands/ops";

/** One undoable step. `do` applies it (again, on redo); `undo` reverts it. */
export interface UndoCommand {
  /** What the menu names: "Calibrate page 3" → "Undo Calibrate page 3". */
  readonly label: string;
  /** Story 4.5: the document op it applies, when it is one (the history serialises these, UX-DR36). */
  readonly op?: DocOp;
  do(): void;
  undo(): void;
}

export interface UndoHistory {
  /** Applied commands, oldest first. */
  readonly past: readonly UndoCommand[];
  /** Undone commands, the next to redo last. */
  readonly future: readonly UndoCommand[];
}

export const EMPTY_HISTORY: UndoHistory = { past: [], future: [] };

/** How many steps are kept; the oldest are dropped first. */
export const UNDO_LIMIT = 200;

/** Runs `command` and records it; a new step clears the redo steps. */
export function execute(history: UndoHistory, command: UndoCommand, limit = UNDO_LIMIT): UndoHistory {
  command.do();
  const past = [...history.past, command];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

/** Reverts the last step (nothing to undo: the same history). */
export function undo(history: UndoHistory): UndoHistory {
  const command = history.past.at(-1);
  if (!command) return history;
  command.undo();
  return { past: history.past.slice(0, -1), future: [...history.future, command] };
}

/** Applies the last undone step again (nothing to redo: the same history). */
export function redo(history: UndoHistory): UndoHistory {
  const command = history.future.at(-1);
  if (!command) return history;
  command.do();
  return { past: [...history.past, command], future: history.future.slice(0, -1) };
}

/** The labels of the next undo and redo (null: nothing). */
export function nextLabels(history: UndoHistory): { undo: string | null; redo: string | null } {
  return { undo: history.past.at(-1)?.label ?? null, redo: history.future.at(-1)?.label ?? null };
}
