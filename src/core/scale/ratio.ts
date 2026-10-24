// Printed scale ratios in one line of text (Story 4.2, FR23). Framework-free.
//
// From the prototype's detectScales regular expression (tool/src/core/20-scale.js)
// and its SCALE_CANDIDATES, extended: the sheet qualifier in more spellings
// ("@ A1", "AT A3", "(A1)", "FOR A1"), "1/100", imperial architectural and
// engineering scales, and context that rules a ratio out (a slope, a flood
// return period, a time, a date).

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
// "1:100", "1 : 100", "1/100", then an optional sheet: "@ A1", "AT A3", "ON A1", "FOR A1", "(A1)", "[A1]".
const METRIC = new RegExp(
  String.raw`(?<![\w.,:/])1\s?(?::|/)\s?(\d{1,5})(?![\d.,:/])(?:\s?[(\[]?\s?(?:@|AT\b|ON\b|FOR\b)?\s?${SHEET}(?![\w])\s?[)\]]?)?`,
  "gi",
);
// Architectural: 1/8" = 1'-0", 1/4"=1', 3/16" = 1'0", 1 1/2" = 1'-0". Engineering: 1" = 20'.
// Inch and foot marks as fonts print them: straight, doubled primes, ″ ′ (NFKC keeps them), curly quotes.
const INCH = String.raw`(?:"|''|″|′′|”|in\b)`;
const FOOT = String.raw`(?:'|′|’|ft\b)`;
const IMPERIAL = new RegExp(
  String.raw`(?<![\w./])(?:(\d{1,2})\s)?(\d{1,2})(?:/(\d{1,2}))?\s?${INCH}\s?=\s?(\d{1,4})\s?${FOOT}(?:\s?-?\s?(\d{1,2})\s?${INCH})?`,
  "gi",
);

/** Words before a ratio that make it something else (a slope, a mix, a ratio of quantities). */
const BEFORE = /\b(slope[sd]?|fall(?:s|ing)?|gradient|grade|pitch|ramp|incline|batter|mix|ratio|aep|ari|chance|odds|risk)\W*(?:\S+\W*){0,2}$/i;
/** Words right after a ratio that make it something else (a return period, a time). */
const AFTER = /^\W{0,3}(year|yr|years|aep|ari|flood|storm|event|chance|am|pm|hrs?|hours?|min|mins|minutes?|sec|seconds?)\b/i;

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
    if (BEFORE.test(line.slice(Math.max(0, start - 40), start))) continue;
    if (AFTER.test(line.slice(end, end + 12))) continue;
    out.push({ ratio, sheet: m[2] ? m[2].toUpperCase().replace(/\s+/g, " ") : null, start, end, text: m[0].trim(), imperial: false });
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
  return kept.sort((a, b) => a.start - b.start);
}
