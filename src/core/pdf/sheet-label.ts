// Sheet labels for the page pager (Story 3.3, AC 2). Framework-free.
//
// A page's sheet label is, in order:
// 1. its PDF page label (/PageLabels, pdf.js getPageLabels()) when present and
//    different from the page number. A label of the form "<sheet number> -
//    <title>" (e.g. "A1721 - LEVEL 17 REFLECTED CEILING PLAN", common in
//    drawing sets) shows only the sheet number; the full label is the tooltip;
// 2. otherwise a sheet number detected from the page's text near the title
//    block (detectSheetLabel);
// 3. otherwise nothing.

/** Drawing-number shapes: "A1721", "FP-101", "M.201B", "12-AR-001". */
const SHEET_NUMBER = [/^[A-Z]{1,3}[-.]?\d{2,5}[A-Z]?$/, /^\d{2,4}-[A-Z]{1,2}-\d{2,4}$/];

/**
 * Shapes that match SHEET_NUMBER but are not drawing numbers, common in
 * fire-protection title blocks and notes: pipe sizes and pressure ratings
 * ("DN150", "PN16") and standards ("NZS4541", "AS1851", "EN12845", "BS9251").
 */
const NOT_SHEET_NUMBER = [/^(?:DN|NB|PN)\d{2,4}$/, /^(?:NZS|AS|BS|EN|ISO|DIN|IEC)[-.]?\d{4,5}$/];

/** True when `token` looks like a drawing (sheet) number. */
export function isSheetNumber(token: string): boolean {
  return SHEET_NUMBER.some((re) => re.test(token)) && !NOT_SHEET_NUMBER.some((re) => re.test(token));
}

/** Longest page label kept (render-cache.ts validates stored labels against it). */
export const MAX_PAGE_LABEL_LENGTH = 1000;

const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Strips control characters (pdf.js keeps a trailing NUL of some writers) and collapses whitespace. */
export function cleanLabel(label: string): string {
  return label.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

/**
 * The document's page labels, cleaned; null when there are none or every label
 * is just its page number (nothing to show).
 */
export function cleanPageLabels(labels: readonly (string | null | undefined)[] | null | undefined): string[] | null {
  if (!labels || labels.length === 0) return null;
  const out = labels.map((l) => cleanLabel(l ?? "").slice(0, MAX_PAGE_LABEL_LENGTH));
  return out.some((l, i) => l !== "" && l !== String(i + 1)) ? out : null;
}

export type SheetLabel = {
  /** Shown next to "3 / 12". */
  short: string;
  /** Tooltip and announcement text (the full page label, or the detected number). */
  full: string;
};

/** Leading sheet number of a "<number> - <title>" page label, if any. */
function leadingSheetNumber(label: string): string | null {
  const m = /^(\S+)\s*(?:-|–|—|:)\s+\S/.exec(label);
  return m && isSheetNumber(m[1]) ? m[1] : null;
}

/**
 * The sheet label of page `pageNumber` (1-based) from its page label and the
 * detected sheet number; null when neither gives one.
 */
export function sheetLabelOf(pageNumber: number, pageLabel: string | null | undefined, detected: string | null | undefined): SheetLabel | null {
  const label = pageLabel ? cleanLabel(pageLabel) : "";
  if (label !== "" && label !== String(pageNumber)) return { short: leadingSheetNumber(label) ?? label, full: label };
  return detected ? { short: detected, full: detected } : null;
}

/**
 * The 0-based page a typed label names: a match, ignoring case, of a page label
 * (full or its sheet number) or of a detected sheet number; null when none matches.
 */
export function pageForLabel(
  text: string,
  pageLabels: readonly string[] | null,
  detected: Readonly<Record<number, string | null>>,
): number | null {
  const wanted = cleanLabel(text).toUpperCase();
  if (wanted === "") return null;
  if (pageLabels) {
    for (let i = 0; i < pageLabels.length; i++) {
      const label = sheetLabelOf(i + 1, pageLabels[i], null);
      if (label && (label.full.toUpperCase() === wanted || label.short.toUpperCase() === wanted)) return i;
    }
  }
  for (const [index, label] of Object.entries(detected)) if (label?.toUpperCase() === wanted) return Number(index);
  return null;
}

// ---- detection --------------------------------------------------------------

/** A text run of a page in page space (points, origin top-left, y down, /Rotate applied). */
export type TextRun = {
  str: string;
  /** Start of the baseline. */
  x: number;
  y: number;
  /** Advance width of the run (points). */
  width: number;
  fontSize: number;
};

/** Title-block captions next to the drawing number. */
const CAPTION = /\b(?:DRAWING|DWG|SHEET)\.?\s*(?:NO\b|NO\.|NUMBER|NUM\b|#)/i;
/** The runner-up must score this much lower, or the detection is unsure. */
const MARGIN = 0.25;
/** Without a caption nearby the number must be this much larger than the page's typical text. */
const MIN_RELATIVE_SIZE = 1.25;

type Candidate = { token: string; score: number };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The most likely sheet number of a page from its text, or null when unsure.
 * Candidates are tokens shaped like drawing numbers (isSheetNumber) in the
 * page's bottom-right quadrant, where title blocks sit. Each scores its font
 * size relative to the page's median text size, +1 next to a "DRAWING NO." /
 * "SHEET NUMBER" caption, and up to +0.5 for being closer to the corner. The
 * best wins if it is clearly ahead of the next different token and either
 * larger than the body text or captioned.
 */
export function detectSheetLabel(runs: readonly TextRun[], page: { width: number; height: number }): string | null {
  if (!(page.width > 0) || !(page.height > 0)) return null;
  const texts = runs.filter((r) => r.str.trim() !== "" && r.fontSize > 0);
  const typical = median(texts.map((r) => r.fontSize));
  if (!(typical > 0)) return null;
  const captions = texts.filter((r) => CAPTION.test(r.str));
  const best = new Map<string, Candidate>();
  for (const run of texts) {
    const str = run.str;
    let at = 0;
    for (const raw of str.split(/\s+/)) {
      const offset = str.indexOf(raw, at);
      at = offset + raw.length;
      const token = raw.replace(/[,;:)]+$/, "").replace(/^[(]+/, "");
      if (!isSheetNumber(token)) continue;
      const x = run.x + (str.length > 0 ? (run.width * Math.max(0, offset)) / str.length : 0);
      const rx = x / page.width;
      const ry = run.y / page.height;
      if (rx < 0.5 || ry < 0.5 || rx > 1.02 || ry > 1.02) continue;
      const size = run.fontSize / typical;
      const reach = Math.max(60, 4 * run.fontSize);
      const captioned = captions.some(
        (c) => c === run || Math.hypot(c.x - x, c.y - run.y) <= reach || Math.hypot(c.x + c.width - x, c.y - run.y) <= reach,
      );
      const corner = Math.min(1, (rx + ry) / 2) - 0.5;
      const score = size + (captioned ? 1 : 0) + corner;
      if (size < MIN_RELATIVE_SIZE && !captioned) continue;
      const previous = best.get(token);
      if (!previous || previous.score < score) best.set(token, { token, score });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < MARGIN) return null;
  return ranked[0].token;
}
