// Public surface of the editor feature (Story 4.3: undo; Story 4.5: the editor store, op commands, the session).
export { activeLayerOf, editorStore, gestureMarkups, layersOf, markupsOf, pageMarkups, resetEditor, setDocLayers, setDocMarkups, type CaptionDrag, type Drawing, type EditorState, type MoveDrag } from "./editor-store";
export { activeUndoLabels, clearUndo, executeCommand, executeOp, markTabSaved, markTabUnsaved, recordAppliedOp, redoActive, registerFallbackUndo, tabChangedSinceSaved, undoActive } from "./undo-store";
export { applyOp } from "./commands";
export { subscribeAppliedOps } from "./commands";
export { useEditorSession } from "./session";
export { MEASUREMENTS_HINT, MeasurementsPanel } from "./measurements-panel";
export { MarkupContextMenu, useSelectionState } from "./markup-context-menu";
export { TextEditor } from "./text-editor";
export { PropertiesPanel } from "./properties-panel";
export { LayersPanel } from "./layers-panel";
export { MarkupsListPanel } from "./markups-list-panel";
export { decodeMarkupImage, pickImage, pickImageFile } from "./image-tool";
export { loadMarkupFonts } from "./fonts";
export { setRevisionAuthor } from "./revision-tool";
export { hasClipboard } from "./select-tool";
// Story 9.2: the 4541 panel's zone mode.
export { ADD_ZONE, armZoneDraw, endZoneDraw, zoneDrawStore, type ZoneDrawTool } from "./zone-draw";
export { setSelection } from "./editor-store";
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
  paintMarkupsPreview,
  useMeasureTools,
} from "./measure-tool";
export type { UndoCommand } from "@/core/undo/stack";
export { coverageStore, holdCoverage, revealCoverage, resetCoverage, setCoverageOn, setCoverageRules, setCoverageShape } from "./coverage-overlay";
// Story 9.10: the 4541 panel's Add head.
export { headDimensionsOf, headDimensionsStore, resetHeadDimensions, setHeadDimensionsOn } from "./head-dimensions";
export { ADD_HEAD_LINE, armGuideDraw, endGuideDraw, guideDrawStore } from "./guide-draw";
export { ADD_HEAD, OUTSIDE_ZONES, armHeadPlace, endHeadPlace, headPlaceStore, placeHeadAt } from "./head-place";
// Story 9.11: rule-break markers.
export { revealFlag } from "./rule-markers";
export { TextFormatBar } from "./text-format-bar";
export { TextPrompt, askText } from "./text-prompt";
export { copyFormat, dropFormat, formatPainter, selectedMarkups } from "./properties";
export { downloadMarkupSummary } from "./markups-list-panel";
