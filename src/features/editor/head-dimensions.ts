// The 4541 panel's Dimensions toggle (founder request 2026-11-12): head-to-head and head-to-wall
// distances on the drawing, for setting heads out on site. Off by default. The dimensions are made
// on the fly from the zones and their heads (core/sprinkler/dimensions), cached per zone, painted
// over the markups and added to an export or print while the toggle is on.

import { createStore } from "zustand/vanilla";

import type { Calibration } from "@/core/calibration/calibration";
import type { DimensionMarkup, Markup, ZoneMarkup } from "@/core/schema/markup";
import { headDimensions } from "@/core/sprinkler/dimensions";
import { isHead, type HeadMarkup } from "@/core/sprinkler/heads";
import { isZone } from "@/core/sprinkler/zone";
import { notifyMarkups } from "@/features/viewer";

export const headDimensionsStore = createStore<{ on: boolean }>(() => ({ on: false }));

export function setHeadDimensionsOn(on: boolean): void {
  headDimensionsStore.setState({ on });
  notifyMarkups({});
}

export function resetHeadDimensions(): void {
  headDimensionsStore.setState({ on: false }, true);
  cache.clear();
}

type Entry = { zone: ZoneMarkup; key: string; dims: DimensionMarkup[] };
const cache = new Map<string, Entry>();

/**
 * The head dimensions of the zones among `markups` (one page's, or a document's), when the toggle
 * is on. `scaleOf`: a page's calibration and UserUnit (null: not calibrated, no dimensions).
 */
export function headDimensionsOf(
  markups: readonly Markup[],
  scaleOf: (pageId: string) => { calibration: Pick<Calibration, "xFactor" | "yFactor"> | null; userUnit: number } | null,
): DimensionMarkup[] {
  if (!headDimensionsStore.getState().on) return [];
  const byZone = new Map<string, HeadMarkup[]>();
  for (const m of markups) {
    if (!isHead(m)) continue;
    const list = byZone.get(m.head.zoneId);
    if (list) list.push(m);
    else byZone.set(m.head.zoneId, [m]);
  }
  const out: DimensionMarkup[] = [];
  let zi = 0;
  for (const z of markups) {
    if (!isZone(z)) continue;
    zi++;
    const heads = byZone.get(z.id);
    const scale = heads ? scaleOf(z.pageId) : null;
    if (!heads || !scale?.calibration) continue;
    const key = `${scale.calibration.xFactor}|${scale.calibration.yFactor}|${scale.userUnit}|${heads.map((h) => `${h.points[0].x},${h.points[0].y},${h.points[2].x},${h.points[2].y}`).join(";")}`;
    let e = cache.get(z.id);
    if (!e || e.zone !== z || e.key !== key) {
      // Ids are unique across the zones of a document (a zone has far fewer than 100 000 dimensions).
      e = { zone: z, key, dims: headDimensions(z, heads, scale.calibration, scale.userUnit, zi * 100_000) };
      cache.set(z.id, e);
    }
    out.push(...e.dims);
  }
  return out;
}
