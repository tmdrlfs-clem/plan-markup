// Story 5.3 (FR33): groups, the drawing order and alignment. Framework-free.
//
// A group is the markups sharing a `groupId` (groups do not nest, D1); a
// "unit" is a group or a markup on its own, what align moves as one. The
// drawing order is the document's markup list: a page's markups keep their
// slots in it, and a reorder only shuffles the page's markups among them.

import type { Markup } from "@/core/schema/markup";

import type { Point, Rect } from "./geometry";

export type OrderStep = "front" | "forward" | "backward" | "back";
export type AlignTo = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** `ids` with every other member of their groups among `markups` added (in `markups`' order after the given ones). */
export function withGroups(markups: readonly Markup[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const groups = new Set(markups.filter((m) => wanted.has(m.id) && m.groupId).map((m) => m.groupId));
  if (groups.size === 0) return [...ids];
  return [...ids, ...markups.filter((m) => !wanted.has(m.id) && m.groupId && groups.has(m.groupId)).map((m) => m.id)];
}

/** The units of `markups`: each group as one, each markup without a group on its own, in first-seen order. */
export function unitsOf(markups: readonly Markup[]): Markup[][] {
  const units: Markup[][] = [];
  const byGroup = new Map<string, Markup[]>();
  for (const m of markups) {
    if (!m.groupId) {
      units.push([m]);
      continue;
    }
    const unit = byGroup.get(m.groupId);
    if (unit) unit.push(m);
    else {
      const next = [m];
      byGroup.set(m.groupId, next);
      units.push(next);
    }
  }
  return units;
}

/**
 * The page's order (`order`, bottom first) after `step` for the `selected` ids: to the front or
 * back keeps their order among themselves; forward / backward moves each past the next markup
 * not selected (D3: whether or not they overlap).
 */
export function stepOrder(order: readonly string[], selected: ReadonlySet<string>, step: OrderStep): string[] {
  const on = order.filter((id) => selected.has(id));
  const off = order.filter((id) => !selected.has(id));
  if (step === "front") return [...off, ...on];
  if (step === "back") return [...on, ...off];
  const out = [...order];
  if (step === "forward") {
    for (let i = out.length - 2; i >= 0; i--) {
      if (selected.has(out[i]) && !selected.has(out[i + 1])) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (selected.has(out[i]) && !selected.has(out[i - 1])) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out;
}

/** The document's order (ids) with the page `pageId`'s markups put in `pageOrder`, each in one of the page's slots. */
export function withPageOrder(markups: readonly Markup[], pageId: string, pageOrder: readonly string[]): string[] {
  let next = 0;
  return markups.map((m) => (m.pageId === pageId ? pageOrder[next++] : m.id));
}

/**
 * How far to move each box to align it with the others' joint box, in the boxes' own space with
 * y down (device px: top is the smallest y). `fixed` boxes (locked, D2) count for the joint box
 * but do not move.
 */
export function alignOffsets(boxes: readonly Rect[], to: AlignTo, fixed: readonly boolean[] = []): Point[] {
  if (boxes.length === 0) return [];
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return boxes.map((b, i) => {
    if (fixed[i]) return { x: 0, y: 0 };
    switch (to) {
      case "left":
        return { x: x0 - b.x, y: 0 };
      case "centre":
        return { x: (x0 + x1) / 2 - (b.x + b.width / 2), y: 0 };
      case "right":
        return { x: x1 - (b.x + b.width), y: 0 };
      case "top":
        return { x: 0, y: y0 - b.y };
      case "middle":
        return { x: 0, y: (y0 + y1) / 2 - (b.y + b.height / 2) };
      case "bottom":
        return { x: 0, y: y1 - (b.y + b.height) };
    }
  });
}
