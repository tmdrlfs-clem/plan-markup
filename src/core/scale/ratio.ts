// Printed scale ratios in one line of text (Story 4.2, FR23). Framework-free.
//
// From the prototype's detectScales regular expression (tool/src/core/20-scale.js)
// and its SCALE_CANDIDATES, extended: the sheet qualifier in more spellings
// ("@ A1", "AT A3", "(A1)", "FOR A1"), "1/100", imperial architectural and
// engineering scales, and context that rules a ratio out (a slope, a flood
// return period, a time, a date, a note).

export type RatioMatch = {
  /** 1:ratio. */
  ratio: number;
  /** The sheet named with it, as printed then canonicalised by the caller; null without one. */
  sheet: string | null;
  /** Where the match is in the line (code units) and its printed text. */
  start: number;
  end: number;
  text: string;
  imperial: boolean;
};

/** Metric ratios a drawing is set out at (prototype's set, plus 1:75, 1:150, 1:1500 and 1:10000). */
export const METRIC_RATIOS: ReadonlySet<number> = new Set([2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000, 1250, 1500, 2000, 2500, 5000, 10000]);

const SHEET = String.raw`(A[0-5]|B[0-4]|ANSI\s?[A-E]|ARCH\s?(?:E1|[A-E]))`;
const CONNECTOR = String.raw`(?:@|AT\b|ON\b|FOR\b)`;
// "1:100", "1 : 100", "1∶100" (U+2236, which NFKC keeps), "1/100"; "SCALE:1:100" too (review D2 of
// 4.2: a colon after a word is a label, after a digit it is a time). Then an optional sheet:
// "@ A1", "AT A3", "ON A1", "FOR A1", "(A1)", "[@ A1]", or a bare ISO A0-A4 ("1:100 A1", as title
// blocks print it); a bare "B2" or "ANSI D" is more often a grid or detail reference (review D5).
// After the number, punctuation is fine ("1:50, 1:100", "1:100."); a decimal or a time is not (D2).
const METRIC = new RegExp(
  String.raw`(?<![\w.,/])(?<!\d\s?[:∶]\s?)1\s?[:∶/]\s?(\d{1,5})(?![\d:∶/]|[.,]\d)` +
    String.raw`(?:\s?(?:[(\[]\s?(?:${CONNECTOR}\s?)?${SHEET}\s?[)\]]|${CONNECTOR}\s?${SHEET}(?!\w))|\s(A[0-4])(?!\w))?`,
  "gi",
);
// Architectural: 1/8" = 1'-0", 1/4"=1', 3/16" = 1'0", 1 1/2" = 1'-0" and 1-1/2" = 1'-0" (review D3:
// the hyphenated mixed number is not "1/2"). Engineering: 1" = 20'.
// Inch and foot marks as fonts print them: straight, doubled primes, ″ ′ (NFKC keeps them), curly quotes.
const INCH = String.raw`(?:"|''|″|′′|”|in\b)`;
const FOOT = String.raw`(?:'|′|’|ft\b)`;
const IMPERIAL = new RegExp(
  String.raw`(?<![\w./-])(?:(\d{1,2})[\s-])?(\d{1,2})(?:/(\d{1,2}))?\s?${INCH}\s?=\s?(\d{1,4})\s?${FOOT}(?:\s?-?\s?(\d{1,2})\s?${INCH})?`,
  "gi",
);

/**
 * A word right before a ratio that makes it something else (a slope, a mix, a ratio of
 * quantities): only "min", "max", "of", "at", "approx", "typ" or punctuation may stand between
 * (review D4: "RAMP PLAN 1:50" and "GRADE BEAM DETAIL 1:20" are scales).
 */
const BEFORE =
  /\b(?:slope[sd]?|fall(?:s|ing)?|gradient|grade[sd]?|pitch(?:ed)?|ramp(?:s|ed)?|incline[sd]?|batter|mix|ratio|aep|ari|chance|odds|risk)\b\W*(?:(?:min(?:imum)?|max(?:imum)?|of|at|approx(?:imately)?|typ(?:ical)?)\b\W*){0,2}$/i;
/** "SCALE" right before a ratio (one word may stand between: "SCALE RATIO 1:100") wins over BEFORE and the note rule. */
const SCALE_BEFORE = /\bscale\b\W*(?:\w+\W*)?$/i;
/** Words right after a ratio that make it something else (a return period, a time). */
const AFTER = /^\W{0,3}(year|yr|years|aep|ari|flood|storm|event|chance|am|pm|hrs?|hours?|min|mins|minutes?|sec|seconds?)\b/i;
/**
 * A ratio on a line with more than this many other words is inside a note ("REFER TO 1:50
 * DETAILS FOR ALL FLASHINGS…", review D6), unless "SCALE" precedes it. View titles and
 * title-block cells are short (L21's view title has two other words).
 */
export const NOTE_WORDS = 8;
const WORD = /[A-Za-z]{2,}/g;

/** Every scale ratio in `line` (one line of a page's text, NFKC-normalised). */
export function findRatios(line: string): RatioMatch[] {
  const out: RatioMatch[] = [];
  for (const m of line.matchAll(METRIC)) {
    const ratio = Number(m[1]);
    if (!METRIC_RATIOS.has(ratio)) continue;
    // "1/2", "1/5" are fractions far more often than scales ("1/2 HR"): the slash form needs 1:10 or more.
    if (ratio < 10 && m[0].includes("/")) continue;
    const start = m.index!;
    const end = start + m[0].length;
    const before = line.slice(Math.max(0, start - 40), start);
    if (BEFORE.test(before) && !SCALE_BEFORE.test(before)) continue;
    if (AFTER.test(line.slice(end, end + 12))) continue;
    const sheet = m[2] ?? m[3] ?? m[4] ?? null;
    out.push({ ratio, sheet: sheet ? sheet.toUpperCase().replace(/\s+/g, " ") : null, start, end, text: m[0].trim(), imperial: false });
  }
  for (const m of line.matchAll(IMPERIAL)) {
    const whole = m[1] ? Number(m[1]) : 0;
    const paper = m[3] ? whole + Number(m[2]) / Number(m[3]) : whole + Number(m[2]);
    const real = Number(m[4]) * 12 + (m[5] ? Number(m[5]) : 0);
    if (!(paper > 0) || !(real > 0)) continue;
    const ratio = real / paper;
    // Architectural and engineering scales give whole ratios (1/8" = 1'-0" is 1:96, 1" = 20' is 1:240).
    if (!Number.isInteger(ratio) || ratio < 2 || ratio > 10000) continue;
    const start = m.index!;
    out.push({ ratio, sheet: null, start, end: start + m[0].length, text: m[0].trim(), imperial: true });
  }
  // Overlaps (the "1/2" inside `1 1/2" = 1'-0"`): the imperial scale, then the longer match, wins.
  out.sort((a, b) => Number(b.imperial) - Number(a.imperial) || b.end - b.start - (a.end - a.start));
  const kept: RatioMatch[] = [];
  for (const m of out) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  kept.sort((a, b) => a.start - b.start);
  // A note (review D6): many words besides the ratios, and no "SCALE" before a ratio.
  let rest = line;
  for (const k of [...kept].reverse()) rest = `${rest.slice(0, k.start)} ${rest.slice(k.end)}`;
  if ((rest.match(WORD)?.length ?? 0) <= NOTE_WORDS) return kept;
  return kept.filter((k) => SCALE_BEFORE.test(line.slice(Math.max(0, k.start - 40), k.start)));
}
