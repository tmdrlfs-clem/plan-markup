// Selecting PDF text for Underline and Strikethrough (Story 5.9, FR32). Framework-free.
//
// The page's text items (Story 3.6, the render worker) with their quads in
// the markup's user space. A press over a word and a drag to another select
// the words between them in reading order (the page text's order), whole
// words; the markup is the selected characters' glyph boxes, one quad per
// text item (sliced to the selected characters), and the lines drawn are
// along each quad: an underline just below the baseline, a strikethrough
// through the middle of the lower case letters.

import { matchQuads, type TextMatch } from "@/core/search/match";
import type { PageTextIndex, TextItem } from "@/core/search/page-text";

type Point = { x: number; y: number };

/** A page's text, its items' quads in user space. */
export type PageText = { items: readonly TextItem[]; index: PageTextIndex };

/** Where along a quad's height (bottom, the descent line, to top, the ascent line) each line runs. */
export const UNDERLINE_AT = 0.12;
export const STRIKETHROUGH_AT = 0.45;

function corners(q: TextItem["quad"]): [Point, Point, Point, Point] {
  return [
    { x: q[0], y: q[1] },
    { x: q[2], y: q[3] },
    { x: q[4], y: q[5] },
    { x: q[6], y: q[7] },
  ];
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function inside(p: Point, ring: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The distance from `p` to a quad (0 inside it). */
function quadDistance(p: Point, q: TextItem["quad"]): number {
  const c = corners(q);
  if (inside(p, c)) return 0;
  return Math.min(...c.map((a, i) => segmentDistance(p, a, c[(i + 1) % 4])));
}

/**
 * The index (a code unit of the page text) of the character at `p`, or of the nearest one
 * within `tol` user units; null when no text is that near.
 */
export function charNear(text: PageText, p: Point, tol: number): number | null {
  let best = -1;
  let bestDistance = Infinity;
  text.items.forEach((item, i) => {
    const d = quadDistance(p, item.quad);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  if (best < 0 || bestDistance > tol) return null;
  // Along the item's baseline: which of its characters (they share its advance evenly).
  const item = text.items[best];
  const [bl, br] = corners(item.quad);
  const ux = br.x - bl.x;
  const uy = br.y - bl.y;
  const len2 = ux * ux + uy * uy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - bl.x) * ux + (p.y - bl.y) * uy) / len2)) : 0;
  const offset = Math.min(item.str.length - 1, Math.floor(t * item.str.length));
  // The page text's first code unit from that character (normalisation may drop or expand some).
  let nearest = -1;
  for (let k = 0; k < text.index.charItem.length; k++) {
    if (text.index.charItem[k] !== best) continue;
    if (nearest < 0 || Math.abs(text.index.charOffset[k] - offset) < Math.abs(text.index.charOffset[nearest] - offset)) nearest = k;
    if (text.index.charOffset[k] >= offset) break;
  }
  return nearest >= 0 ? nearest : null;
}

/** The whole words from character `a` to character `b` (either order) of the page text. */
export function wordSelection(index: PageTextIndex, a: number, b: number): TextMatch {
  let start = Math.min(a, b);
  let end = Math.max(a, b) + 1;
  // Out to the ends of the words the selection starts and ends in (not past a space it ends on).
  if (index.text[start] !== " ") while (start > 0 && index.text[start - 1] !== " ") start--;
  if (index.text[end - 1] !== " ") while (end < index.text.length && index.text[end] !== " ") end++;
  // A selection starting or ending on a space keeps to the words.
  while (start < end && index.text[start] === " ") start++;
  while (end > start && index.text[end - 1] === " ") end--;
  return { start, end };
}

/** The selection's glyph boxes as points, four a quad (bottom left, bottom right, top right, top left). */
export function selectionQuads(text: PageText, selection: TextMatch): Point[] {
  return matchQuads(text.items, text.index, selection).flatMap((q) => corners(q));
}

/** The selected text, one line of plain text. */
export function selectionText(index: PageTextIndex, selection: TextMatch): string {
  return index.text.slice(selection.start, selection.end);
}

/** The lines an underline or a strikethrough draws: one along each quad of `points`. */
export function decorationLines(points: readonly Point[], kind: "underline" | "strikethrough" | "squiggly"): [Point, Point][] {
  const at = kind === "strikethrough" ? STRIKETHROUGH_AT : UNDERLINE_AT;
  const lerp = (p: Point, q: Point): Point => ({ x: p.x + (q.x - p.x) * at, y: p.y + (q.y - p.y) * at });
  const lines: [Point, Point][] = [];
  for (let i = 0; i + 3 < points.length; i += 4) {
    const [bl, br, tr, tl] = points.slice(i, i + 4);
    lines.push([lerp(bl, tl), lerp(br, tr)]);
  }
  return lines;
}

/** The quads of `points` (four a quad). */
export function quadsOf(points: readonly Point[]): Point[][] {
  const quads: Point[][] = [];
  for (let i = 0; i + 3 < points.length; i += 4) quads.push(points.slice(i, i + 4));
  return quads;
}
