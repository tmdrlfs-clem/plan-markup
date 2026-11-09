/**
 * Story 9.8 (FR73): between zone markups (PDF user space points on a calibrated
 * page) and the 4541 engine (mm), and from placed heads back to head markups.
 * Framework-free.
 *
 * A page point is `x · userUnit · xFactor` mm along x and `y · userUnit · yFactor`
 * along y (core/calibration measureLength), so the engine works in real mm
 * and its heads come back to the page through the inverse.
 */
import type { Calibration } from "@/core/calibration/calibration";
import type { Point } from "@/core/markup/geometry";
import type { HeadMeta, Markup, MarkupDevice, MarkupStyle, ZoneMarkup } from "@/core/schema/markup";

import type { EngineZone } from "./engine/site";
import type { PlacedHead } from "./placer";
import type { Hazard } from "./rules/rules";
import { holeTagOf } from "./zone";

/** What a placed head counts as in the legend and the Markups List. */
export const HEAD_DEVICE: MarkupDevice = { group: "Sprinkler", label: "Sprinkler head" };
export const HEAD_SUBJECT = "Sprinkler head";
/** The head symbol's real diameter (D: a fixed real size, so it scales with the drawing). */
export const HEAD_DIAMETER_MM = 300;
export const HEAD_STYLE: MarkupStyle = { color: "#c62828", width: 1, fontSize: 10, fill: "#ef9a9a" };

/** A page's scale: mm per user space point along x and y (UserUnit applied). */
export type PageScale = { x: number; y: number };

export function pageScaleOf(calibration: Pick<Calibration, "xFactor" | "yFactor">, userUnit = 1): PageScale {
  const u = userUnit > 0 ? userUnit : 1;
  return { x: u * calibration.xFactor, y: u * calibration.yFactor };
}

export const toMm = (p: Point, s: PageScale): Point => ({ x: p.x * s.x, y: p.y * s.y });
export const toPage = (p: Point, s: PageScale): Point => ({ x: p.x / s.x, y: p.y / s.y });

export type HeadMarkup = Extract<Markup, { type: "ellipse" }> & { head: HeadMeta };

export function isHead(m: Markup): m is HeadMarkup {
  return m.type === "ellipse" && m.head !== undefined;
}

/** The head markups placed for `zoneId`. */
export function headsOfZone(markups: readonly Markup[], zoneId: string): HeadMarkup[] {
  return markups.filter((m): m is HeadMarkup => isHead(m) && m.head.zoneId === zoneId);
}

/** A head's centre (page points). */
export function headCentre(h: HeadMarkup): Point {
  const [p0, , p2] = h.points;
  return { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 };
}

/** Placement options stored on the zone (zone.options), as the engine takes them. */
export function zoneOptions(z: ZoneMarkup): Pick<EngineZone, "pattern" | "prefs"> {
  const o = z.zone.options ?? {};
  const num = (k: string) => (typeof o[k] === "number" && (o[k] as number) > 0 ? (o[k] as number) : undefined);
  const spacing = num("spacing");
  const wallDist = num("wallDist");
  return {
    ...(o.pattern === "staggered" ? { pattern: "staggered" as const } : {}),
    ...(spacing || wallDist ? { prefs: { ...(spacing ? { spacing } : {}), ...(wallDist ? { wallDist } : {}) } } : {}),
  };
}

/**
 * The engine's view of a zone: outline and holes in mm (each hole a column or a shaft by its tag),
 * the zone's options, and `locked` heads (kept where they are, e.g. moved by hand).
 */
export function engineZoneOf(
  z: ZoneMarkup,
  hazard: Hazard,
  calibration: Pick<Calibration, "xFactor" | "yFactor">,
  userUnit = 1,
  locked: readonly HeadMarkup[] = [],
): EngineZone {
  const s = pageScaleOf(calibration, userUnit);
  const ring = (r: readonly Point[]) => r.map((p) => toMm(p, s));
  return {
    zoneId: z.id,
    hazard,
    barriers: [
      { kind: "wall", ring: ring(z.points) },
      ...(z.holes ?? []).map((h, i) => ({ kind: holeTagOf(z, i, calibration, userUnit), ring: ring(h) })),
    ],
    ...zoneOptions(z),
    ...(locked.length ? { locked: locked.map((h) => ({ id: h.id, ...toMm(headCentre(h), s) })) } : {}),
  };
}

/**
 * The head markup for an engine head (mm): a circle HEAD_DIAMETER_MM across, a device counted as
 * a sprinkler head, linked to its zone. A locked head keeps its markup (the caller reuses it).
 */
export function headMarkup(
  head: Pick<PlacedHead, "x" | "y"> & { kind: HeadMeta["kind"] },
  zone: Pick<ZoneMarkup, "id" | "pageId">,
  scale: PageScale,
  id: string,
  createdAt: string,
): HeadMarkup {
  const c = toPage(head, scale);
  const rx = HEAD_DIAMETER_MM / 2 / scale.x;
  const ry = HEAD_DIAMETER_MM / 2 / scale.y;
  return {
    id,
    pageId: zone.pageId,
    createdAt,
    type: "ellipse",
    style: HEAD_STYLE,
    subject: HEAD_SUBJECT,
    device: HEAD_DEVICE,
    head: { zoneId: zone.id, kind: head.kind },
    points: [
      { x: c.x - rx, y: c.y - ry },
      { x: c.x + rx, y: c.y - ry },
      { x: c.x + rx, y: c.y + ry },
      { x: c.x - rx, y: c.y + ry },
    ],
  };
}
