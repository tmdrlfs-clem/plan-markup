// Applying document ops to the stores (Story 4.5, AR13). Only commands call
// this (undo-store executeOp / commandOf): markups go to the editor store's
// `doc` slice, calibrations to the active tab's viewer state (Story 4.3 keeps
// them there, per tab).

import { applyCalibrationsOp, applyMarkupsOp, type DocOp } from "@/core/commands/ops";
import { viewerStore } from "@/features/viewer";

import { editorStore, markupsOf, setDocMarkups } from "./editor-store";

/** Applies `op`. A calibrations op for a document that is not the active one changes nothing (undo only runs in the active tab). */
export function applyOp(op: DocOp): void {
  if (op.kind !== "calibrations.set") {
    setDocMarkups(op.documentId, applyMarkupsOp(markupsOf(editorStore.getState(), op.documentId), op));
    return;
  }
  const viewer = viewerStore.getState();
  if (viewer.documentId !== op.documentId) return;
  viewerStore.setState({ calibrations: applyCalibrationsOp(viewer.calibrations, op) });
}
