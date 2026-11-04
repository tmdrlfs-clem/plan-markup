// Story 5.12: the Layers panel's actions (FR67). Each is one undo step over
// the document's layers (`layers.set`); deleting a layer moves or deletes its
// markups in the same step (a compound op). New markups go to the active
// layer (undo-store); a hidden or locked layer cannot be active (D2).

import { removeMarkupsOp, type SimpleDocOp } from "@/core/commands/ops";
import { uuidv7 } from "@/core/ids/uuid";
import { MAX_LAYER_NAME, MAX_LAYERS, moveLayer, nextLayerName, type Layer } from "@/core/schema/layer";
import type { Markup } from "@/core/schema/markup";

import { editorStore, isLocked, layersOf, markupsOf, setActiveLayer } from "./editor-store";
import { lockedNote } from "./select-tool";
import { executeOp } from "./undo-store";

export const ADD_LAYER = "Add layer";
export const RENAME_LAYER = "Rename layer";
export const DELETE_LAYER = "Delete layer";
export const MOVE_LAYER = "Move layer";
export const MOVE_TO_LAYER = "Move to layer";

const layersNow = (documentId: string) => layersOf(editorStore.getState(), documentId);

function setLayers(documentId: string, after: readonly Layer[], label: string): boolean {
  const before = layersNow(documentId);
  if (after === before) return false;
  executeOp({ kind: "layers.set", documentId, before: [...before], after: [...after] }, label);
  return true;
}

function changed(documentId: string, id: string, change: (l: Layer) => Layer, label: string): boolean {
  const before = layersNow(documentId);
  const i = before.findIndex((l) => l.id === id);
  if (i < 0) return false;
  const next = change(before[i]);
  if (next === before[i]) return false;
  return setLayers(documentId, before.map((l, j) => (j === i ? next : l)), label);
}

/** A new layer on top ("Layer n"), active at once; null at the limit. */
export function addLayer(documentId: string): Layer | null {
  const before = layersNow(documentId);
  if (before.length >= MAX_LAYERS) return null;
  const layer: Layer = { id: uuidv7(), name: nextLayerName(before) };
  setLayers(documentId, [layer, ...before], ADD_LAYER);
  setActiveLayer(documentId, layer.id);
  return layer;
}

/** Renames a layer (trimmed, up to 100 characters); an empty name keeps the old one. */
export function renameLayer(documentId: string, id: string, name: string): boolean {
  const trimmed = name.trim().slice(0, MAX_LAYER_NAME);
  if (!trimmed) return false;
  return changed(documentId, id, (l) => (l.name === trimmed ? l : { ...l, name: trimmed }), RENAME_LAYER);
}

/** Shows or hides a layer's markups. */
export function setLayerHidden(documentId: string, id: string, hidden: boolean): boolean {
  return changed(documentId, id, (l) => (!!l.hidden === hidden ? l : flag(l, "hidden", hidden)), hidden ? "Hide layer" : "Show layer");
}

/** Locks or unlocks a layer's markups. */
export function setLayerLocked(documentId: string, id: string, locked: boolean): boolean {
  return changed(documentId, id, (l) => (!!l.locked === locked ? l : flag(l, "locked", locked)), locked ? "Lock layer" : "Unlock layer");
}

function flag(l: Layer, key: "hidden" | "locked", on: boolean): Layer {
  const next = { ...l };
  if (on) next[key] = true;
  else delete next[key];
  return next;
}

/** Moves a layer one place up (-1) or down (+1) in the list. */
export function stepLayer(documentId: string, id: string, step: -1 | 1): boolean {
  return setLayers(documentId, moveLayer(layersNow(documentId), id, step), MOVE_LAYER);
}

/** A layer's markups: how many, on how many pages (the delete dialog's scope). */
export function layerScope(documentId: string, id: string): { markups: number; pages: number } {
  const on = markupsOf(editorStore.getState(), documentId).filter((m) => m.layerId === id);
  return { markups: on.length, pages: new Set(on.map((m) => m.pageId)).size };
}

function onLayer(m: Markup, layerId: string | null): Markup {
  if (layerId !== null) return { ...m, layerId };
  const next = { ...m };
  delete next.layerId;
  return next;
}

/**
 * Deletes a layer, one undo step: its markups move to `to` (another layer's id, or null: no layer)
 * or, with "delete", are deleted with it.
 */
export function deleteLayer(documentId: string, id: string, fate: { to: string | null } | "delete"): boolean {
  const before = layersNow(documentId);
  if (!before.some((l) => l.id === id)) return false;
  const markups = markupsOf(editorStore.getState(), documentId);
  const on = markups.filter((m) => m.layerId === id);
  const ops: SimpleDocOp[] = [];
  if (on.length > 0) {
    if (fate === "delete") {
      const op = removeMarkupsOp(documentId, markups, on.map((m) => m.id));
      if (op && op.kind !== "compound") ops.push(op);
    } else {
      const to = fate.to !== null && fate.to !== id && before.some((l) => l.id === fate.to) ? fate.to : null;
      ops.push({ kind: "markups.update", documentId, before: on, after: on.map((m) => onLayer(m, to)) });
    }
  }
  ops.push({ kind: "layers.set", documentId, before: [...before], after: before.filter((l) => l.id !== id) });
  executeOp(ops.length === 1 ? ops[0] : { kind: "compound", documentId, ops }, DELETE_LAYER);
  return true;
}

/** Moves `markups` (not locked ones) to a layer (null: none), one undo step; false when nothing moved. */
export function assignLayer(documentId: string, markups: readonly Markup[], layerId: string | null): boolean {
  const free = markups.filter((m) => !isLocked(m));
  if (free.length === 0) {
    if (markups.length > 0) lockedNote();
    return false;
  }
  const before = free.filter((m) => (m.layerId ?? null) !== layerId);
  if (before.length === 0) return false;
  executeOp({ kind: "markups.update", documentId, before, after: before.map((m) => onLayer(m, layerId)) }, MOVE_TO_LAYER);
  return true;
}
