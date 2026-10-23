// Telling search hits apart (Story 3.6 review, founder decision 2026-10-24).
// Framework-free.
//
// On a drawing the PDF's text order is the order the text was drawn, so a
// snippet of the neighbouring characters says little ("CH +2700 CH +2700 CH
// +2700"). A hit is described instead by the text nearest to it on the sheet
// (the room name, the ceiling type tag next to it), and the hits of a page are
// listed in reading order of their position: top to bottom, and left to right
// within a line.

import type { TextMatch } from "./match";
import type { PageTextIndex, TextItem } from "./page-text";

type Box = { x: number; y: number; width: number; height: number };

/** What sortByPosition needs of a hit: its page-space box and the text height (points). */
export type Placed = { bounds: Box; textHeight: number };

/**
 * Hits in reading order of their position on the page (page space: y down).
 * Hits whose centres are within half a text height of the line's first hit
 * share a line; a line is ordered left to right. Stable for equal positions.
 */
export function sortByPosition<T extends Placed>(hits: readonly T[]): T[] {
  const byY = hits
    .map((hit, order) => ({ hit, order, cx: hit.bounds.x + hit.bounds.width / 2, cy: hit.bounds.y + hit.bounds.height / 2 }))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx || a.order - b.order);
  const out: T[] = [];
  let i = 0;
  while (i < byY.length) {
    const first = byY[i];
    const tolerance = Math.max(first.hit.textHeight, first.hit.bounds.height, 1e-6) / 2;
    let j = i + 1;
    while (j < byY.length && byY[j].cy - first.cy <= tolerance) j++;
    const line = byY.slice(i, j).sort((a, b) => a.cx - b.cx || a.order - b.order);
    for (const entry of line) out.push(entry.hit);
    i = j;
  }
  return out;
}

/** Labels longer than this are cut with "…". */
export const NEARBY_MAX_LENGTH = 20;
/** Text further than this many text heights from the hit is not "nearby". */
export const NEARBY_RADIUS = 8;

const normalise = (s: string) => s.normalize("NFKC").replace(/\s+/gu, " ").trim();

function boxOfQuad(q: readonly number[]): Box {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The gap between two boxes (0 when they touch or overlap). */
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/**
 * The texts nearest to a match on the page (at most `max`, nearest first),
 * within NEARBY_RADIUS text heights: other text items, not the ones the match
 * covers, not blank, and not the matched text itself (another "CH +2700" says
 * nothing about where this one is). Repeated labels are listed once.
 */
export function nearbyText(
  items: readonly TextItem[],
  page: PageTextIndex,
  match: TextMatch,
  bounds: Box,
  textHeight: number,
  max = 2,
): string[] {
  const covered = new Set<number>();
  for (let k = match.start; k < match.end; k++) if (page.charItem[k] >= 0) covered.add(page.charItem[k]);
  const matched = page.text.slice(match.start, match.end).toLowerCase();
  const radius = NEARBY_RADIUS * Math.max(textHeight, 1e-6);
  const near: { label: string; distance: number; y: number; x: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    if (covered.has(i)) continue;
    const label = normalise(items[i].str);
    if (label === "" || label.toLowerCase() === matched) continue;
    const box = boxOfQuad(items[i].quad);
    const distance = gap(bounds, box);
    if (distance > radius) continue;
    near.push({ label, distance, y: box.y, x: box.x });
  }
  near.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  const out: string[] = [];
  for (const { label } of near) {
    const cut = label.length > NEARBY_MAX_LENGTH ? `${label.slice(0, NEARBY_MAX_LENGTH - 1)}…` : label;
    if (!out.includes(cut)) out.push(cut);
    if (out.length >= max) break;
  }
  return out;
}
