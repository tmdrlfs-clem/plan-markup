// Story 5.12: markup layers (FR67). A document has an ordered list of layers
// (the Layers panel's order, top first); a markup names its layer by id
// (absent: no layer). A hidden layer's markups are not shown or picked; a
// locked layer's cannot be moved, edited or deleted (as a locked markup).

import { z } from "zod";

import { UUID_PATTERN } from "@/core/ids/uuid";

export const MAX_LAYERS = 100;
export const MAX_LAYER_NAME = 100;

export const layerSchema = z.object({
  id: z.string().regex(UUID_PATTERN),
  name: z.string().trim().min(1).max(MAX_LAYER_NAME),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
});
export type Layer = z.infer<typeof layerSchema>;

export const layerListSchema = z.array(layerSchema).max(MAX_LAYERS);

/** The layer `layerId` names in `layers`, if any. */
export function layerById(layers: readonly Layer[], layerId: string | undefined): Layer | null {
  return layerId === undefined ? null : (layers.find((l) => l.id === layerId) ?? null);
}

/** Whether a markup on `layerId` is shown (no layer, or a layer that is not hidden; a layer no longer there: shown). */
export function layerShown(layers: readonly Layer[], layerId: string | undefined): boolean {
  return !layerById(layers, layerId)?.hidden;
}

/** Whether a markup on `layerId` is locked by its layer. */
export function layerLocked(layers: readonly Layer[], layerId: string | undefined): boolean {
  return !!layerById(layers, layerId)?.locked;
}

/** The name a new layer gets: "Layer n", the first n not taken. */
export function nextLayerName(layers: readonly Layer[]): string {
  const taken = new Set(layers.map((l) => l.name.toLowerCase()));
  for (let n = layers.length + 1; ; n++) if (!taken.has(`layer ${n}`)) return `Layer ${n}`;
}

/** `layers` with `id` moved one place up (-1) or down (+1); the same list when it cannot move. */
export function moveLayer(layers: readonly Layer[], id: string, step: -1 | 1): readonly Layer[] {
  const i = layers.findIndex((l) => l.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= layers.length) return layers;
  const out = [...layers];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
