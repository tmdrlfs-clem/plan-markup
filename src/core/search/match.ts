// Text search on a page's normalised text (Story 3.6). Framework-free.
// Matching is case-insensitive unless `matchCase`, whitespace-tolerant (the
// page text and the query are both collapsed, src/core/search/page-text.ts),
// and optionally whole-word. A match maps back to quads of the items it covers,
// for the canvas highlight; positions inside an item are proportional to the
// character index (getTextContent gives no per-glyph widths).

import type { PageTextIndex, Quad, TextItem } from "./page-text";

export type SearchOptions = { matchCase: boolean; wholeWord: boolean };

/** A match in a page's normalised text: [start, end) code units. */
export type TextMatch = { start: number; end: number };

/** Matches beyond this per page are not reported (a one-letter query on a dense sheet). */
export const MAX_MATCHES_PER_PAGE = 5000;

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (c: string | undefined) => c !== undefined && c !== "" && WORD.test(c);

/** The character (code point) before / at a code unit index. */
function before(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const code = text.charCodeAt(index - 1);
  // A low surrogate: take the whole pair.
  if (code >= 0xdc00 && code <= 0xdfff && index >= 2) return text.slice(index - 2, index);
  return text[index - 1];
}

function at(text: string, index: number): string | undefined {
  if (index >= text.length) return undefined;
  return String.fromCodePoint(text.codePointAt(index)!);
}

/** True when [start, end) starts and ends on word boundaries (an edge that is not a word character always does). */
function onWordBoundaries(text: string, start: number, end: number): boolean {
  const first = at(text, start);
  const last = before(text, end);
  const leftOk = !isWord(first) || !isWord(before(text, start));
  const rightOk = !isWord(last) || !isWord(at(text, end));
  return leftOk && rightOk;
}

/**
 * Every non-overlapping match of `query` (already normalised, normalizeQuery)
 * in the page, in reading order; at most MAX_MATCHES_PER_PAGE.
 */
export function findMatches(page: PageTextIndex, query: { text: string; folded: string }, options: SearchOptions): TextMatch[] {
  const needle = options.matchCase ? query.text : query.folded;
  if (needle === "") return [];
  const hay = options.matchCase ? page.text : page.folded;
  const out: TextMatch[] = [];
  let from = 0;
  while (out.length < MAX_MATCHES_PER_PAGE) {
    const start = hay.indexOf(needle, from);
    if (start < 0) break;
    const end = start + needle.length;
    if (options.wholeWord && !onWordBoundaries(page.text, start, end)) {
      from = start + 1;
      continue;
    }
    out.push({ start, end });
    from = end;
  }
  return out;
}

/** A short excerpt around a match: the text before, the match and the text after, with "…" where cut. */
export function snippetOf(page: PageTextIndex, match: TextMatch, context = 32): { before: string; match: string; after: string } {
  const { text } = page;
  let from = Math.max(0, match.start - context);
  let to = Math.min(text.length, match.end + context);
  // Cut at a space where one is near, so words stay whole.
  if (from > 0) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < match.start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(" ", to);
    if (space > match.end) to = space;
  }
  return {
    before: (from > 0 ? "…" : "") + text.slice(from, match.start),
    match: text.slice(match.start, match.end),
    after: text.slice(match.end, to) + (to < text.length ? "…" : ""),
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The part [f0, f1] (shares of the advance) of an item's quad. */
export function sliceQuad(q: Quad, f0: number, f1: number): Quad {
  return [
    lerp(q[0], q[2], f0),
    lerp(q[1], q[3], f0),
    lerp(q[0], q[2], f1),
    lerp(q[1], q[3], f1),
    lerp(q[6], q[4], f1),
    lerp(q[7], q[5], f1),
    lerp(q[6], q[4], f0),
    lerp(q[7], q[5], f0),
  ];
}

/** The quads a match covers: one per item it touches, cut to the matched characters. */
export function matchQuads(items: readonly TextItem[], page: PageTextIndex, match: TextMatch): Quad[] {
  const spans = new Map<number, { lo: number; hi: number }>();
  for (let k = match.start; k < match.end; k++) {
    const item = page.charItem[k];
    if (item < 0) continue;
    const offset = page.charOffset[k];
    const span = spans.get(item);
    if (span) {
      span.lo = Math.min(span.lo, offset);
      span.hi = Math.max(span.hi, offset + 1);
    } else {
      spans.set(item, { lo: offset, hi: offset + 1 });
    }
  }
  const quads: Quad[] = [];
  for (const [index, { lo, hi }] of spans) {
    const item = items[index];
    if (!item) continue;
    const length = Math.max(1, item.str.length);
    quads.push(sliceQuad(item.quad, Math.min(1, lo / length), Math.min(1, hi / length)));
  }
  return quads;
}

/** The axis-aligned page-space box of some quads (null without any). */
export function boundsOf(quads: readonly Quad[]): { x: number; y: number; width: number; height: number } | null {
  if (quads.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of quads) {
    for (let i = 0; i < 8; i += 2) {
      x0 = Math.min(x0, q[i]);
      x1 = Math.max(x1, q[i]);
      y0 = Math.min(y0, q[i + 1]);
      y1 = Math.max(y1, q[i + 1]);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
