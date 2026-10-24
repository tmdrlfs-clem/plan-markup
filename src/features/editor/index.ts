// Public surface of the editor feature (Story 4.3: undo; Story 4.5 adds the editor foundation).
export { activeUndoLabels, clearUndo, executeCommand, redoActive, undoActive, undoStore, type UndoState } from "./undo-store";
export type { UndoCommand } from "@/core/undo/stack";
