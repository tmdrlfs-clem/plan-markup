// Story 8.1 (UX-DR29): the ExportDialog's page range, as typed ("1-3, 5"),
// 1-based as the page navigator shows them. Framework-free.

export const MAX_RANGE_LENGTH = 200;

/** The 0-based pages `text` names among `pageCount` (in order, once each), or why it cannot be read. */
export function parsePageRange(text: string, pageCount: number): { ok: true; pages: number[] } | { ok: false; reason: string } {
  const bad = { ok: false as const, reason: `Enter pages like 1-3, 5 (1 to ${pageCount}).` };
  const t = text.trim();
  if (t === "" || t.length > MAX_RANGE_LENGTH) return bad;
  const pages = new Set<number>();
  for (const part of t.split(",")) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part);
    if (!m) return bad;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from || to > pageCount) return bad;
    for (let p = from; p <= to; p++) pages.add(p - 1);
  }
  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
}
