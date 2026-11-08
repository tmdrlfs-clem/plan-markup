/**
 * Story 9.2: the 4541 panel's Fill zone and Polygon zone. Either arms the
 * fill or area tool in zone mode: what it finishes becomes a zone (no
 * measurement), until another tool is chosen.
 */
import { createStore } from "zustand/vanilla";

import type { Calibration } from "@/core/calibration/calibration";
import type { Point } from "@/core/markup/geometry";
import type { ZoneMarkup } from "@/core/schema/markup";
import { isZone, newZone } from "@/core/sprinkler/zone";
import { useMapStore } from "@/features/sprinkler/use-map-store";
import { setTool, viewerStore } from "@/features/viewer";

import { editorStore, markupsOf } from "./editor-store";

export const ADD_ZONE = "Add zone";

export type ZoneDrawTool = "fill" | "area";

export const zoneDrawStore = createStore<{ tool: ZoneDrawTool | null }>(() => ({
  tool: null,
}));

let unsubscribe: (() => void) | null = null;

/** Arms `tool` to make zones; choosing any other tool ends zone mode. */
export function armZoneDraw(tool: ZoneDrawTool): void {
  zoneDrawStore.setState({ tool });
  setTool(tool);
  unsubscribe ??= viewerStore.subscribe((s) => {
    const armed = zoneDrawStore.getState().tool;
    if (armed && s.tool !== armed) endZoneDraw();
  });
}

export function endZoneDraw(): void {
  if (zoneDrawStore.getState().tool !== null) zoneDrawStore.setState({ tool: null });
  unsubscribe?.();
  unsubscribe = null;
}

/** Whether `tool`'s next area is a zone. */
export function makesZone(tool: string): boolean {
  return zoneDrawStore.getState().tool === tool;
}

/** The document's zones. */
export function zonesOf(documentId: string): ZoneMarkup[] {
  return markupsOf(editorStore.getState(), documentId).filter(isZone);
}

/** The zone a finished ring makes on `documentId`. */
export function zoneOf(
  documentId: string,
  ring: {
    id: string;
    pageId: string;
    createdAt: string;
    outer: readonly Point[];
    holes: readonly (readonly Point[])[];
  },
  calibration: Calibration | null,
  userUnit: number,
): ZoneMarkup {
  // Story 9.3: the use is the mapping's default (the company's, else the platform's).
  return newZone(ring, zonesOf(documentId), calibration, userUnit, useMapStore.getState().map);
}
