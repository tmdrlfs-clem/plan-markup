/**
 * Story 9.10 (FR76): the 4541 panel's Add head. It arms the Stamp tool in head
 * mode: each click inside a zone adds a manual head there (one undo step each),
 * until another tool is chosen or Esc. A click outside every zone says so.
 */
import { toast } from "@/components/ui/toast-store";
import { pageIdOf } from "@/core/calibration/calibration";
import { uuidv7 } from "@/core/ids/uuid";
import type { Point } from "@/core/markup/geometry";
import type { ZoneMarkup } from "@/core/schema/markup";
import { headMarkup, pageScaleOf, toMm, zoneAt, type HeadMarkup } from "@/core/sprinkler/heads";
import { isZone } from "@/core/sprinkler/zone";
import { setStampHeads, stampStore } from "@/features/tool-chest/stamp-store";
import { setTool, viewerStore } from "@/features/viewer";

import { editorStore, pageMarkups } from "./editor-store";
import { executeOp } from "./undo-store";

export const ADD_HEAD = "Add head";
export const OUTSIDE_ZONES = "Click inside a zone to add a head";

/** Whether Add head is armed (the panel's button); the flag lives with the Stamp tool's state. */
export const headPlaceStore = stampStore;

let unsubscribe: (() => void) | null = null;

/** Arms Add head; choosing any other tool (or arming a Tool Chest tool) ends it. */
export function armHeadPlace(): void {
  setStampHeads(true);
  setTool("stamp");
  unsubscribe ??= viewerStore.subscribe((s) => {
    if (s.tool !== "stamp") endHeadPlace();
  });
}

export function endHeadPlace(): void {
  setStampHeads(false);
  unsubscribe?.();
  unsubscribe = null;
}

/** Whether the Stamp tool adds heads now. */
export function placingHeads(): boolean {
  return stampStore.getState().heads && viewerStore.getState().tool === "stamp";
}

/** The head a click at `point` would add (the zone under it), or null outside every zone or on an uncalibrated page. */
export function headAt(point: Point, documentId: string, pageIndex: number, id = "00000000-0000-7000-8000-000000000000"): HeadMarkup | null {
  const viewer = viewerStore.getState();
  const pageId = pageIdOf(documentId, pageIndex);
  const calibration = viewer.calibrations[pageId];
  if (!calibration) return null;
  const zones = pageMarkups(editorStore.getState(), documentId, pageId).filter((m): m is ZoneMarkup => isZone(m));
  const zone = zoneAt(point, zones);
  if (!zone) return null;
  const scale = pageScaleOf(calibration, viewer.pages[pageIndex]?.userUnit ?? 1);
  return headMarkup({ ...toMm(point, scale), kind: "manual" }, zone, scale, id, new Date().toISOString());
}

/** Adds a manual head at `point` (one undo step); false (and a note) outside every zone. */
export function placeHeadAt(point: Point, documentId: string, pageIndex: number): boolean {
  const head = headAt(point, documentId, pageIndex, uuidv7());
  if (!head) {
    toast({ title: OUTSIDE_ZONES, variant: "info" });
    return false;
  }
  executeOp({ kind: "markups.add", documentId, markups: [head] }, ADD_HEAD);
  return true;
}
