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
import type { DocOp, SimpleDocOp } from "@/core/commands/ops";
import type { Point } from "@/core/markup/geometry";
import type { HeadMeta, Markup, MarkupDevice, MarkupStyle, ZoneMarkup } from "@/core/schema/markup";

import type { EngineZone } from "./engine/site";
import type { PlacedHead } from "./placer";
import { pointInRegion } from "./placer/geometry";
import type { Hazard } from "./rules/rules";
import { holeTagOf, isZone } from "./zone";

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

export type GuideMarkup = Extract<Markup, { type: "line" }> & { guide: true };

/** A head line: a line markup the designer drew for the engine (the 4541 panel's Add head line). */
export function isGuide(m: Markup): m is GuideMarkup {
  return m.type === "line" && m.guide === true;
}

/** A head line's look: a thin dashed green line, so it never reads as part of the drawing. */
export const GUIDE_STYLE: MarkupStyle = { color: "#1a8f3c", width: 0.75, fontSize: 10, dash: [6, 4] };
export const GUIDE_SUBJECT = "Head line";

/** The head lines of `zone`: those on its page whose middle lies in it. */
export function guidesOfZone(markups: readonly Markup[], zone: ZoneMarkup): GuideMarkup[] {
  return markups.filter((m): m is GuideMarkup => {
    if (!isGuide(m) || m.pageId !== zone.pageId) return false;
    const [a, b] = m.points;
    return pointInRegion({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zone.points, zone.holes ?? []);
  });
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
  guides: readonly GuideMarkup[] = [],
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
    ...(guides.length ? { guides: guides.map((g) => ({ a: toMm(g.points[0], s), b: toMm(g.points[1], s) })) } : {}),
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

/** Story 9.10: the zone whose area (holes excluded) holds `p` (page points), the topmost when they overlap. */
export function zoneAt(p: Point, zones: readonly ZoneMarkup[]): ZoneMarkup | null {
  for (let i = zones.length - 1; i >= 0; i--) if (pointInRegion(p, zones[i].points, zones[i].holes ?? [])) return zones[i];
  return null;
}

/**
 * Story 9.10 (FR76, D2): a head the designer edits stops being the engine's. A head moved, resized
 * or rotated (its points changed), or a head copied or pasted (a new head that is not a restore),
 * becomes `manual` (a `locked` head stays locked), and it joins the zone its centre now sits in
 * (it keeps its zone when it sits in none). Re-running placement keeps manual heads where they are.
 * Everything else in `op` is returned as it is. `markups`: the document's markups (for the zones).
 */
export function refineHeadEdits(op: DocOp, markups: readonly Markup[]): DocOp {
  if (op.kind === "compound") {
    const ops = op.ops.map((o) => refineSimple(o, markups));
    return ops.every((o, i) => o === op.ops[i]) ? op : { ...op, ops };
  }
  return refineSimple(op, markups);
}

function refineSimple(op: SimpleDocOp, markups: readonly Markup[]): SimpleDocOp {
  if (op.kind === "markups.update") {
    if (!op.after.some(isHead)) return op;
    const before = new Map(op.before.map((m) => [m.id, m]));
    const zones = zonesByPage(markups);
    const after = op.after.map((m) => {
      const was = before.get(m.id);
      return isHead(m) && (!was || !samePoints(was.points, m.points)) ? edited(m, zones) : m;
    });
    return after.every((m, i) => m === op.after[i]) ? op : { ...op, after };
  }
  // A restore (an undo of a delete) carries its positions: those heads are put back as they were.
  if (op.kind === "markups.add" && !op.at) {
    if (!op.markups.some(isHead)) return op;
    const zones = zonesByPage(markups);
    const added = op.markups.map((m) => (isHead(m) ? edited(m, zones) : m));
    return added.every((m, i) => m === op.markups[i]) ? op : { ...op, markups: added };
  }
  return op;
}

function zonesByPage(markups: readonly Markup[]): Map<string, ZoneMarkup[]> {
  const out = new Map<string, ZoneMarkup[]>();
  for (const m of markups) {
    if (!isZone(m)) continue;
    const list = out.get(m.pageId);
    if (list) list.push(m);
    else out.set(m.pageId, [m]);
  }
  return out;
}

function edited(h: HeadMarkup, zones: ReadonlyMap<string, readonly ZoneMarkup[]>): HeadMarkup {
  const kind = h.head.kind === "locked" ? "locked" : "manual";
  const zoneId = zoneAt(headCentre(h), zones.get(h.pageId) ?? [])?.id ?? h.head.zoneId;
  return kind === h.head.kind && zoneId === h.head.zoneId ? h : { ...h, head: { zoneId, kind } };
}

function samePoints(a: readonly Point[], b: readonly Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}
