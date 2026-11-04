// Applying document ops to the stores (Story 4.5, AR13). Only commands call
// this (undo-store executeOp / commandOf): markups go to the editor store's
// `doc` slice, calibrations to the active tab's viewer state (Story 4.3 keeps
// them there, per tab).

import { applyCalibrationsOp, applyLayersOp, applyMarkupsOp, opParts, type DocOp, type SimpleDocOp } from "@/core/commands/ops";
import { viewerStore } from "@/features/viewer";

import { editorStore, layersOf, markupsOf, setDocLayers, setDocMarkups } from "./editor-store";

/** Applies `op` (Story 5.12: a compound op's parts in order). A calibrations op for a document that is not the active one changes nothing (undo only runs in the active tab). */
export function applyOp(op: DocOp): void {
  for (const part of opParts(op)) applySimple(part);
}

function applySimple(op: SimpleDocOp): void {
  if (op.kind === "layers.set") {
    setDocLayers(op.documentId, applyLayersOp(layersOf(editorStore.getState(), op.documentId), op));
    return;
  }
  if (op.kind !== "calibrations.set") {
    setDocMarkups(op.documentId, applyMarkupsOp(markupsOf(editorStore.getState(), op.documentId), op));
    return;
  }
  const viewer = viewerStore.getState();
  if (viewer.documentId !== op.documentId) return;
  viewerStore.setState({ calibrations: applyCalibrationsOp(viewer.calibrations, op) });
}
