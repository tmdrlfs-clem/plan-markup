// Story 7.3 (FR41): placing a tool. Framework-free.
//
// A tool's markups are centred on the origin in its source page's user space.
// placedMarkups centres them on a point; held at the pointer (anchorTopLeft),
// the pointer holds the placement's top-left corner as the screen shows it. A tool drawn on a calibrated page is
// placed at real size: scaled by the source's real millimetres per user unit
// over the target's (so it needs the target calibrated too); an unscaled tool
// keeps its paper size. Several markups become one group; a device-typed
// tool's placement counts once, by its first markup.

import { markupBounds, type Point } from "@/core/markup/geometry";
import { transformMarkup } from "@/core/markup/transform";
import type { Calibration } from "@/core/calibration/calibration";
import type { Markup, MarkupDevice } from "@/core/schema/markup";

import { toolMarkups, type Device, type ToolContent } from "./tool";

export const NEEDS_SCALE = "Set this page's scale to place it at real size";

export type PlaceTarget = { pageId: string; calibration: Calibration | null; userUnit: number };

/** Whether the tool can only be placed on a calibrated page. */
export function needsScale(content: ToolContent): boolean {
  return content.calibration !== null;
}

/** The scale from the tool's user space to the target page's; null when the target needs a scale it has not. */
export function toolScale(content: ToolContent, target: Pick<PlaceTarget, "calibration" | "userUnit">): { sx: number; sy: number } | null {
  const from = content.userUnit > 0 ? content.userUnit : 1;
  const to = target.userUnit > 0 ? target.userUnit : 1;
  if (!content.calibration) return { sx: from / to, sy: from / to };
  if (!target.calibration) return null;
  return {
    sx: (from * content.calibration.xFactor) / (to * target.calibration.xFactor),
    sy: (from * content.calibration.yFactor) / (to * target.calibration.yFactor),
  };
}

export type PlacedTool = { content: ToolContent; imageSrc: string | null; device: Device | null };

/**
 * The markups a placement of `tool` centred at `at` makes on `target` (new ids from `newId`,
 * `createdAt`); null when the page needs a scale, or the tool's image is not loaded.
 */
export function placedMarkups(tool: PlacedTool, at: { x: number; y: number }, target: PlaceTarget, newId: () => string, createdAt: string): Markup[] | null {
  const scale = toolScale(tool.content, target);
  if (!scale) return null;
  const source = toolMarkups(tool.content, tool.imageSrc);
  if (source.length !== tool.content.markups.length) return null;
  const { sx, sy } = scale;
  const place = (p: { x: number; y: number }) => ({ x: at.x + p.x * sx, y: at.y + p.y * sy });
  const stretch = (p: { x: number; y: number }) => ({ x: p.x * sx, y: p.y * sy });
  const ids = source.map(() => newId());
  const device: MarkupDevice | null = tool.device ? { group: tool.device.group, label: tool.device.label } : null;
  return source.map((m, i) => {
    const moved = transformMarkup(m, place, stretch);
    return {
      ...moved,
      id: ids[i],
      pageId: target.pageId,
      createdAt,
      ...(source.length > 1 ? { groupId: ids[0] } : {}),
      ...(device && i === 0 ? { device } : {}),
    } as Markup;
  });
}

/**
 * `markups` moved so that their box's top-left corner on screen (`toScreen`:
 * user space → screen, y down, any view rotation) is at `at` (user space):
 * the pointer holds a held tool by that corner. Unchanged when empty.
 */
export function anchorTopLeft(markups: Markup[], at: Point, toScreen: (p: Point) => Point): Markup[] {
  if (markups.length === 0) return markups;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of markups) {
    const b = markupBounds(m);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return markups;
  // The view turns in quarter turns: one corner of the user-space box is the screen box's top-left.
  let corner: Point = { x: x0, y: y0 };
  let best = Infinity;
  for (const c of [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) {
    const s = toScreen(c);
    if (s.x + s.y < best) {
      best = s.x + s.y;
      corner = c;
    }
  }
  const dx = at.x - corner.x;
  const dy = at.y - corner.y;
  if (dx === 0 && dy === 0) return markups;
  return markups.map((m) => transformMarkup(m, (p) => ({ x: p.x + dx, y: p.y + dy })));
}

/** Story 7.3: device placements counted per device type (group, label), in name order. */
export function deviceCounts(markups: readonly Markup[]): { group: string; label: string; count: number }[] {
  const counts = new Map<string, { group: string; label: string; count: number }>();
  for (const m of markups) {
    if (!m.device) continue;
    const key = `${m.device.group}\u0000${m.device.label}`;
    const known = counts.get(key);
    if (known) known.count++;
    else counts.set(key, { group: m.device.group, label: m.device.label, count: 1 });
  }
  return [...counts.values()].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/** A device type as the Markups List shows it. */
export function deviceText(device: MarkupDevice | undefined): string {
  return device ? `${device.group} · ${device.label}` : "";
}
