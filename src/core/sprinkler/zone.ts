/**
 * Story 9.2 (FR70): 4541 zones. A zone is a markup of type "zone" (it saves,
 * undoes and syncs through the markup op path); the database exposes the
 * zones as the `zones` view over `markups`.
 */
import type { Calibration } from "@/core/calibration/calibration";
import { areaMm2 } from "@/core/measure/area";
import type { Point } from "@/core/markup/geometry";
import type { HoleTag, Markup, MarkupStyle, ZoneMarkup } from "@/core/schema/markup";

import { hazardOf, type Hazard, USE_HAZARD_V1, type UseHazardMap } from "./rules/rules";

/** A zone's look: a muted violet outline over a faint fill (UX: zones never shout over the drawing). */
export const ZONE_COLOR = "#7a68b3";
export const ZONE_STYLE: MarkupStyle = {
  color: ZONE_COLOR,
  width: 1,
  fontSize: 10,
};
/** The fill's opacity under the markups. */
export const ZONE_FILL_OPACITY = 0.12;

/** A hole smaller than this (m²) is taken for a column, else a shaft or void (D: user-changeable). */
export const COLUMN_MAX_M2 = 1;

export const HOLE_TAG_LABELS: Record<HoleTag, string> = {
  column: "Column",
  shaft: "Shaft / void",
};

export function isZone(m: Markup): m is ZoneMarkup {
  return m.type === "zone";
}

/** The default tag of a hole of `areaM2` (null: the page is not calibrated, so a shaft). */
export function defaultHoleTag(areaM2: number | null): HoleTag {
  return areaM2 !== null && areaM2 < COLUMN_MAX_M2 ? "column" : "shaft";
}

/** The next free "Zone n" among `zones` (n one more than the highest taken). */
export function nextZoneName(zones: readonly ZoneMarkup[]): string {
  let n = 0;
  for (const z of zones) {
    const match = /^Zone (\d+)$/.exec(z.zone.name);
    if (match) n = Math.max(n, Number(match[1]));
  }
  return `Zone ${Math.min(n + 1, 9999)}`;
}

/** The use a new zone takes: the map's default (the company's once companies exist, FR72). */
export function defaultUse(map: UseHazardMap = USE_HAZARD_V1): string {
  return map.defaultUse;
}

/** The zone's hazard class under `map` (null: a use the map lacks). */
export function zoneHazard(z: ZoneMarkup, map: UseHazardMap = USE_HAZARD_V1): Hazard | null {
  return hazardOf(map, z.zone.use);
}

/** A hole's tag: its own, else the default for its size. */
export function holeTagOf(z: ZoneMarkup, index: number, calibration: Pick<Calibration, "xFactor" | "yFactor"> | null, userUnit = 1): HoleTag {
  const own = z.zone.holeTags?.[index];
  if (own) return own;
  const hole = z.holes?.[index];
  const mm2 = hole ? areaMm2(hole, undefined, calibration, userUnit) : null;
  return defaultHoleTag(mm2 === null ? null : mm2 / 1e6);
}

/** The zone's area in m² (null on an uncalibrated page). */
export function zoneAreaM2(z: ZoneMarkup, calibration: Pick<Calibration, "xFactor" | "yFactor"> | null, userUnit = 1): number | null {
  const mm2 = areaMm2(z.points, z.holes, calibration, userUnit);
  return mm2 === null ? null : mm2 / 1e6;
}

/** "42.5 m²" (one decimal); "—" without a calibration. */
export function formatZoneArea(m2: number | null): string {
  return m2 === null ? "—" : `${m2.toFixed(1)} m²`;
}

export type ZoneInput = {
  id: string;
  pageId: string;
  createdAt: string;
  outer: readonly Point[];
  holes: readonly (readonly Point[])[];
};

/** A new zone from a filled or drawn ring: the next name, the default use, each hole tagged by its size. */
export function newZone(
  input: ZoneInput,
  existing: readonly ZoneMarkup[],
  calibration: Pick<Calibration, "xFactor" | "yFactor"> | null,
  userUnit = 1,
  map: UseHazardMap = USE_HAZARD_V1,
): ZoneMarkup {
  const holes = input.holes.map((h) => [...h]);
  const holeTags = holes.map((h) => {
    const mm2 = areaMm2(h, undefined, calibration, userUnit);
    return defaultHoleTag(mm2 === null ? null : mm2 / 1e6);
  });
  return {
    id: input.id,
    pageId: input.pageId,
    createdAt: input.createdAt,
    style: ZONE_STYLE,
    type: "zone",
    points: [...input.outer],
    ...(holes.length > 0 ? { holes } : {}),
    zone: {
      name: nextZoneName(existing),
      use: defaultUse(map),
      ...(holes.length > 0 ? { holeTags } : {}),
    },
  };
}

/** The 4541 panel's checklist (UX-DR24): zones drawn, every zone's use mapped, heads placed (Story 9.4). */
export type ZoneChecklist = { zones: boolean; uses: boolean; heads: boolean };

export function zoneChecklist(zones: readonly ZoneMarkup[], map: UseHazardMap = USE_HAZARD_V1, headsPlaced = false): ZoneChecklist {
  return {
    zones: zones.length > 0,
    uses: zones.length > 0 && zones.every((z) => zoneHazard(z, map) !== null),
    heads: zones.length > 0 && headsPlaced,
  };
}

/** The zone with hole `index` tagged `tag` (the other holes keep their tags as shown). */
export function withHoleTag(
  z: ZoneMarkup,
  index: number,
  tag: HoleTag,
  calibration: Pick<Calibration, "xFactor" | "yFactor"> | null,
  userUnit = 1,
): ZoneMarkup {
  const holes = z.holes ?? [];
  if (index < 0 || index >= holes.length) return z;
  const holeTags = holes.map((_, i) => (i === index ? tag : holeTagOf(z, i, calibration, userUnit)));
  return { ...z, zone: { ...z.zone, holeTags } };
}
