"use client";

// The Layers panel (Story 5.12, FR67, UX-DR23): the document's layers, top
// first. The radio picks the active layer (new markups go to it; "No layer":
// none); each row shows or hides, locks or unlocks, renames (double-click or
// the pencil), moves up or down and deletes its layer; each change is one
// undo step. Deleting a layer with markups asks where they go, with the scope.

import { useId, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Dialog, DialogFooter, DialogPrimary } from "@/components/ui/dialog";
import { fieldControlClasses } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { MAX_LAYER_NAME, MAX_LAYERS, type Layer } from "@/core/schema/layer";
import { viewerStore } from "@/features/viewer";

import { activeLayerOf, editorStore, layersOf, markupsOf, setActiveLayer } from "./editor-store";
import { addLayer, deleteLayer, layerScope, renameLayer, setLayerHidden, setLayerLocked, stepLayer } from "./layers";

export const NO_LAYER = "No layer";
export const LAYERS_HINT = "New markups go to the active layer. A hidden layer's markups are not shown or picked; a locked layer's cannot change.";
const NOT_ACTIVE = "A hidden or locked layer cannot be the active layer";
const NONE = "none";

/** The dialog for a layer with markups: move them (to another layer or none) or delete them. */
function DeleteLayerDialog({ documentId, layer, layers, onClose }: { documentId: string; layer: Layer; layers: readonly Layer[]; onClose: () => void }) {
  const scope = layerScope(documentId, layer.id);
  const [fate, setFate] = useState<"move" | "delete">("move");
  const [to, setTo] = useState(NONE);
  const name = useId();
  const what = `${scope.markups} ${scope.markups === 1 ? "markup" : "markups"} on ${scope.pages} ${scope.pages === 1 ? "page" : "pages"}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Delete layer “${layer.name}”?`}
      description={`It has ${what}.`}
      size="sm"
      footer={
        <DialogFooter
          secondary={
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          }
          primary={
            <DialogPrimary
              variant={fate === "delete" ? "destructive" : "primary"}
              onClick={() => {
                deleteLayer(documentId, layer.id, fate === "delete" ? "delete" : { to: to === NONE ? null : to });
                onClose();
              }}
            >
              {fate === "delete" ? `Delete layer and ${scope.markups === 1 ? "markup" : "markups"}` : "Delete layer"}
            </DialogPrimary>
          }
        />
      }
    >
      <fieldset className="flex flex-col gap-2 text-ws-md">
        <legend className="sr-only">Its markups</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name={name} checked={fate === "move"} onChange={() => setFate("move")} />
          Move them to another layer
        </label>
        {fate === "move" ? (
          <div className="pl-6">
            <Select
              label="Move to"
              value={to}
              onValueChange={setTo}
              options={[{ value: NONE, label: NO_LAYER }, ...layers.filter((l) => l.id !== layer.id).map((l) => ({ value: l.id, label: l.name }))]}
            />
          </div>
        ) : null}
        <label className="flex items-center gap-2">
          <input type="radio" name={name} checked={fate === "delete"} onChange={() => setFate("delete")} />
          Delete them ({what})
        </label>
      </fieldset>
    </Dialog>
  );
}

/** A layer's name being typed: Enter or leaving keeps it, Esc reverts. */
function NameField({ layer, onDone }: { layer: Layer; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(layer.name);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onDone(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone(null);
    }
  };
  return (
    <input
      autoFocus
      aria-label="Layer name"
      value={draft}
      maxLength={MAX_LAYER_NAME}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => onDone(draft)}
      onKeyDown={onKeyDown}
      className={cx(fieldControlClasses("workspace", false), "min-w-0 flex-1")}
    />
  );
}

export function LayersPanel({ emptyText }: { emptyText: string }) {
  const documentId = useStore(viewerStore, (s) => s.documentId);
  const layers = useStore(editorStore, (s) => layersOf(s, documentId));
  const active = useStore(editorStore, (s) => activeLayerOf(s, documentId)?.id ?? null);
  const markups = useStore(editorStore, (s) => markupsOf(s, documentId));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Layer | null>(null);
  const group = useId();

  if (!documentId) {
    return (
      <div className="flex flex-col gap-1 p-3 text-ws-md">
        <p>No drawing open</p>
      </div>
    );
  }
  const counts = new Map<string, number>();
  for (const m of markups) if (m.layerId) counts.set(m.layerId, (counts.get(m.layerId) ?? 0) + 1);
  const remove = (layer: Layer) => {
    if ((counts.get(layer.id) ?? 0) === 0) deleteLayer(documentId, layer.id, { to: null });
    else setDeleting(layer);
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="layers-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-ws-sm text-muted">{layers.length === 0 ? emptyText : `${layers.length} ${layers.length === 1 ? "layer" : "layers"}`}</p>
        <Button size="sm" variant="ghost" disabled={layers.length >= MAX_LAYERS} onClick={() => addLayer(documentId)}>
          <Plus size={14} aria-hidden="true" />
          New layer
        </Button>
      </div>
      <div role="radiogroup" aria-label="Active layer" className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        <label className="flex h-8 items-center gap-2 px-3 text-ws-md">
          <input type="radio" name={group} checked={active === null} onChange={() => setActiveLayer(documentId, null)} />
          <span className="text-muted">{NO_LAYER}</span>
        </label>
        {layers.map((layer, i) => {
          const usable = !layer.hidden && !layer.locked;
          return (
            <div key={layer.id} data-testid="layer-row" className={cx("flex h-8 items-center gap-1 px-3 text-ws-md", active === layer.id && "bg-surface-3")}>
              <input
                type="radio"
                name={group}
                aria-label={`Make ${layer.name} the active layer`}
                title={usable ? undefined : NOT_ACTIVE}
                disabled={!usable}
                checked={active === layer.id}
                onChange={() => setActiveLayer(documentId, layer.id)}
              />
              {renaming === layer.id ? (
                <NameField
                  layer={layer}
                  onDone={(name) => {
                    if (name !== null) renameLayer(documentId, layer.id, name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <span className={cx("min-w-0 flex-1 truncate", layer.hidden && "text-muted")} onDoubleClick={() => setRenaming(layer.id)}>
                  {layer.name}
                  <span className="ml-1 text-ws-sm text-muted">{counts.get(layer.id) ?? 0}</span>
                </span>
              )}
              <IconButton size="xs" label={`${layer.hidden ? "Show" : "Hide"} ${layer.name}`} aria-pressed={!!layer.hidden} icon={layer.hidden ? EyeOff : Eye} onClick={() => setLayerHidden(documentId, layer.id, !layer.hidden)} />
              <IconButton size="xs" label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`} aria-pressed={!!layer.locked} icon={layer.locked ? Lock : LockOpen} onClick={() => setLayerLocked(documentId, layer.id, !layer.locked)} />
              <IconButton size="xs" label={`Rename ${layer.name}`} icon={Pencil} onClick={() => setRenaming(layer.id)} />
              <IconButton size="xs" label={`Move ${layer.name} up`} icon={ArrowUp} disabled={i === 0} onClick={() => stepLayer(documentId, layer.id, -1)} />
              <IconButton size="xs" label={`Move ${layer.name} down`} icon={ArrowDown} disabled={i === layers.length - 1} onClick={() => stepLayer(documentId, layer.id, 1)} />
              <IconButton size="xs" label={`Delete ${layer.name}`} icon={Trash2} onClick={() => remove(layer)} />
            </div>
          );
        })}
      </div>
      <p className="border-t border-border px-3 py-2 text-ws-sm text-muted">{LAYERS_HINT}</p>
      {deleting ? <DeleteLayerDialog documentId={documentId} layer={deleting} layers={layers} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
