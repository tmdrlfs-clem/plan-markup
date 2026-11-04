// Public surface of the editor feature (Story 4.3: undo; Story 4.5: the editor store, op commands, the session).
export { editorStore, markupsOf, pageMarkups, resetEditor, type CaptionDrag, type Drawing, type EditorState, type MoveDrag } from "./editor-store";
export { activeUndoLabels, clearUndo, executeCommand, executeOp, redoActive, undoActive } from "./undo-store";
export { useEditorSession } from "./session";
export { MEASUREMENTS_HINT, MeasurementsPanel } from "./measurements-panel";
export { MarkupContextMenu, useSelectionState } from "./markup-context-menu";
export { TextEditor } from "./text-editor";
export { pickImageFile } from "./image-tool";
export { hasClipboard } from "./select-tool";
export {
  ADD_ANGLE,
  ADD_AREA,
  ADD_COUNT,
  ADD_DIAMETER,
  ADD_LENGTH,
  ADD_POLYLENGTH,
  ADD_RADIUS,
  MOVE_CAPTION,
  armArea,
  armCount,
  armLength,
  armPolylength,
  useMeasureTools,
} from "./measure-tool";
export type { UndoCommand } from "@/core/undo/stack";
