// Public surface of the editor feature (Story 4.3: undo; Story 4.5: the editor store, op commands, the session).
export { editorStore, markupsOf, pageMarkups, resetEditor, type Drawing, type EditorState } from "./editor-store";
export { activeUndoLabels, clearUndo, executeCommand, executeOp, redoActive, undoActive } from "./undo-store";
export { useEditorSession } from "./session";
export type { UndoCommand } from "@/core/undo/stack";
