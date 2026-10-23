// Searchable page text (Story 3.6): the text items of a page with their boxes,
// and the page's normalised text with a map back to the items. Framework-free;
// built in the render worker, read on the main thread.
//
// Page space is the viewer's: points, origin top-left, y down, /Rotate applied
// (pdf.js viewport at scale 1), like src/core/pdf/sheet-label.ts TextRun.
//
// Normalisation (AC 2): every character goes through NFKC (ligatures such as
// "ﬁ" become "fi", full-width forms become ASCII), runs of whitespace become
// one space, and the text is trimmed. Between two items a space is inserted
// when they are on different lines or there is a visible gap between them, so
// a phrase written as several runs ("LEVEL" + "17") still matches "level 17",
// and a word split into runs without a gap ("SPRINK" + "LER") still matches
// "sprinkler". `folded` is `text` in lower case, with the same length: a
// character whose lower case would change the length is kept as is.

import type { TextRun } from "@/core/pdf/sheet-label";

/**
 * A quadrilateral in page space: bottom-left (on the descent line at the start
 * of the text), bottom-right, top-right, top-left; x, y pairs. Rotated text and
 * rotated pages give non-axis-aligned quads.
 */
export type Quad = readonly [number, number, number, number, number, number, number, number];

/** One text item of a page: a run (baseline start, advance width, font size) and its box. */
export type TextItem = TextRun & {
  quad: Quad;
  /** The PDF ends a line after this item. */
  eol: boolean;
};

/** A page's normalised text; `charItem` / `charOffset` give each UTF-16 unit's source (-1: an inserted space). */
export type PageTextIndex = {
  text: string;
  folded: string;
  /** The item index of each code unit of `text`. */
  charItem: Int32Array;
  /** The code unit offset in that item's `str`. */
  charOffset: Int32Array;
};

/** A gap along the line wider than this share of the font size separates two words. */
const WORD_GAP = 0.15;
/** Baselines further apart than this share of the font size are different lines. */
const LINE_GAP = 0.5;

const WHITESPACE = /\s/u;

/** Ascent and descent (shares of the font size; descent negative) when the font gives none. */
export const DEFAULT_ASCENT = 0.8;
export const DEFAULT_DESCENT = -0.2;

/**
 * A text item of a PDF text extraction in page space. `transform` is the
 * item's text matrix in PDF user space (pdf.js TextItem.transform: the font
 * size is folded in), `width` its advance in user space, `toPage` maps a user
 * space point to page space (pdf.js viewport.convertToViewportPoint). Ascent
 * and descent are shares of the font size. Skewed or rotated text gives the
 * matching quad.
 */
export function textItemOf(
  item: { str: string; transform: readonly number[]; width: number; hasEOL?: boolean },
  metrics: { ascent?: number; descent?: number },
  toPage: (x: number, y: number) => readonly number[],
): TextItem {
  const [a, b, c, d, e, f] = item.transform;
  const advance = Math.hypot(a, b);
  const fontSize = Math.hypot(c, d);
  const ux = advance > 1e-12 ? a / advance : 1;
  const uy = advance > 1e-12 ? b / advance : 0;
  const vx = fontSize > 1e-12 ? c / fontSize : 0;
  const vy = fontSize > 1e-12 ? d / fontSize : 1;
  const ascent = (metrics.ascent && metrics.ascent > 0 ? metrics.ascent : DEFAULT_ASCENT) * fontSize;
  const descent = (metrics.descent && metrics.descent < 0 ? metrics.descent : DEFAULT_DESCENT) * fontSize;
  const w = item.width;
  const point = (along: number, up: number) => {
    const p = toPage(e + ux * along + vx * up, f + uy * along + vy * up);
    return [p[0], p[1]] as const;
  };
  const bl = point(0, descent);
  const br = point(w, descent);
  const tr = point(w, ascent);
  const tl = point(0, ascent);
  const origin = point(0, 0);
  return {
    str: item.str,
    x: origin[0],
    y: origin[1],
    width: w,
    fontSize,
    quad: [bl[0], bl[1], br[0], br[1], tr[0], tr[1], tl[0], tl[1]],
    eol: item.hasEOL === true,
  };
}

/** Lower case of one code point, or the code point itself when that would change its length. */
export function foldChar(c: string): string {
  const lower = c.toLowerCase();
  return lower.length === c.length ? lower : c;
}

/** True when `b` continues the line of `a` without a visible gap (the two runs form one word). */
export function joinsWithoutGap(a: TextItem, b: TextItem): boolean {
  if (a.eol) return false;
  const [ax0, ay0, ax1, ay1] = a.quad;
  let ux = ax1 - ax0;
  let uy = ay1 - ay0;
  const length = Math.hypot(ux, uy);
  if (length > 1e-9) {
    ux /= length;
    uy /= length;
  } else {
    ux = 1;
    uy = 0;
  }
  const size = Math.max(a.fontSize, b.fontSize, 1e-6);
  const gx = b.quad[0] - ax1;
  const gy = b.quad[1] - ay1;
  const along = gx * ux + gy * uy;
  const across = -gx * uy + gy * ux;
  if (Math.abs(across) > LINE_GAP * size) return false;
  return along > -LINE_GAP * size && along < WORD_GAP * size;
}

/** Builds the normalised text of a page's items (see the header). */
export function buildPageText(items: readonly TextItem[]): PageTextIndex {
  let text = "";
  let folded = "";
  const charItem: number[] = [];
  const charOffset: number[] = [];
  let lastWasSpace = true; // nothing yet: a leading space is dropped

  const pushSpace = (item: number, offset: number) => {
    if (lastWasSpace) return;
    text += " ";
    folded += " ";
    charItem.push(item);
    charOffset.push(offset);
    lastWasSpace = true;
  };

  for (let i = 0; i < items.length; i++) {
    const { str } = items[i];
    if (i > 0 && !joinsWithoutGap(items[i - 1], items[i])) pushSpace(-1, -1);
    for (let o = 0; o < str.length; ) {
      const cp = str.codePointAt(o)!;
      const ch = String.fromCodePoint(cp);
      for (const c of ch.normalize("NFKC")) {
        if (WHITESPACE.test(c)) {
          pushSpace(i, o);
          continue;
        }
        text += c;
        folded += foldChar(c);
        for (let u = 0; u < c.length; u++) {
          charItem.push(i);
          charOffset.push(o);
        }
        lastWasSpace = false;
      }
      o += ch.length;
    }
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    folded = folded.slice(0, -1);
    charItem.pop();
    charOffset.pop();
  }
  return { text, folded, charItem: Int32Array.from(charItem), charOffset: Int32Array.from(charOffset) };
}

/** A query normalised like page text: NFKC, whitespace collapsed and trimmed; `folded` in lower case. */
export function normalizeQuery(query: string): { text: string; folded: string } {
  const text = query.normalize("NFKC").replace(/\s+/gu, " ").trim();
  let folded = "";
  for (const c of text) folded += foldChar(c);
  return { text, folded };
}
