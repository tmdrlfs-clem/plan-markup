// Page ranges typed in the Calibrate dialog (Story 4.3 AC 3): "1-3, 5". Framework-free.

export type PageRangeResult = { ok: true; pages: number[] } | { ok: false; message: string };

/**
 * The 0-based pages of a range of 1-based page numbers ("1-3, 5", "2", "4-",
 * "-3", spaces and ";" allowed) in a document of `pageCount` pages, in order,
 * each once. Pages outside the document are an error, not silently dropped.
 */
export function parsePageRange(text: string, pageCount: number): PageRangeResult {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return { ok: false, message: "Enter pages, like 1-3, 5" };
  const pages = new Set<number>();
  for (const part of parts) {
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!m) return { ok: false, message: `"${part}" is not a page or a range` };
    const single = m.length === 2;
    const from = single ? Number(m[1]) : m[1] === "" ? 1 : Number(m[1]);
    const to = single ? from : m[2] === "" ? pageCount : Number(m[2]);
    if (!single && m[1] === "" && m[2] === "") return { ok: false, message: `"${part}" is not a page or a range` };
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      return { ok: false, message: `This drawing has ${pageCount} page${pageCount === 1 ? "" : "s"}` };
    }
    if (from > to) return { ok: false, message: `"${part}" runs backwards` };
    for (let p = from; p <= to; p++) pages.add(p - 1);
  }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}

/** A typed ratio: "100", "1:100", "1 : 100", "1/100", with an optional sheet ("@ A1", "at A3", "A1"). */
export type RatioInput = { ratio: number; sheet: string | null };

const RATIO = /^(?:1\s*[:∶/]\s*)?(\d+(?:\.\d+)?)\s*(?:(?:@|at|on|for)?\s*([a-z]+\s?[a-z]?\d?|[ab]\d))?$/i;

/** Parses a typed ratio; `canonical` names the sheet (null: unknown sheet). */
export function parseRatioInput(text: string, canonical: (name: string) => string | null): { ok: true; value: RatioInput } | { ok: false; message: string } {
  const m = RATIO.exec(text.trim());
  if (!m) return { ok: false, message: "Enter a ratio like 1:100 or 1:100 @ A1" };
  const ratio = Number(m[1]);
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { ok: false, message: "The ratio must be more than 0" };
  if (!m[2]) return { ok: true, value: { ratio, sheet: null } };
  const sheet = canonical(m[2]);
  if (!sheet) return { ok: false, message: `"${m[2].toUpperCase()}" is not a sheet size (A0-A5, B0-B4, ANSI A-E, ARCH A-E1)` };
  return { ok: true, value: { ratio, sheet } };
}
