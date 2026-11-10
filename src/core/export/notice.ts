// Story 9.12 (FR78): the advisory notice. The 4541 panel states it, and an export or a
// flatten can draw it onto each exported page: one line of text on a white band at the
// page's bottom left as it is viewed (its /Rotate applied), burned into the page content.

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "@cantoo/pdf-lib";

import { ADVISORY_NOTICE } from "@/core/sprinkler/report";

export { ADVISORY_NOTICE };

/** Margin from the page edge and padding inside the band, in points. */
const MARGIN = 12;
const PAD = 3;
const MIN_SIZE = 5;

/**
 * Where the viewed page's bottom-left corner is in the unrotated page, and the unrotated
 * directions of the viewed page's right (`u`) and up (`v`). `rotate` turns text along `u`.
 */
export function viewedFrame(angle: number, box: { x: number; y: number; width: number; height: number }) {
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (a === 90) return { origin: { x: x1, y: y0 }, u: { x: 0, y: 1 }, v: { x: -1, y: 0 }, rotate: 90, width: box.height, height: box.width };
  if (a === 180) return { origin: { x: x1, y: y1 }, u: { x: -1, y: 0 }, v: { x: 0, y: -1 }, rotate: 180, width: box.width, height: box.height };
  if (a === 270) return { origin: { x: x0, y: y1 }, u: { x: 0, y: -1 }, v: { x: 1, y: 0 }, rotate: 270, width: box.height, height: box.width };
  return { origin: { x: x0, y: y0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, rotate: 0, width: box.width, height: box.height };
}

/** The notice's font size for a viewed page `width` × `height` (larger sheets get larger text, and it always fits). */
export function noticeSize(font: Pick<PDFFont, "widthOfTextAtSize">, width: number, height: number, text = ADVISORY_NOTICE): number {
  const wanted = Math.min(12, Math.max(7, Math.min(width, height) / 120));
  const room = width - 2 * MARGIN - 2 * PAD;
  const fits = room > 0 ? (wanted * room) / font.widthOfTextAtSize(text, wanted) : 0;
  return Math.max(MIN_SIZE, Math.min(wanted, fits));
}

/** Draws the notice on one page. */
export function drawNotice(page: PDFPage, font: PDFFont, text = ADVISORY_NOTICE): void {
  const f = viewedFrame(page.getRotation().angle, page.getCropBox());
  const size = noticeSize(font, f.width, f.height, text);
  const textWidth = font.widthOfTextAtSize(text, size);
  const at = (a: number, b: number) => ({ x: f.origin.x + a * f.u.x + b * f.v.x, y: f.origin.y + a * f.u.y + b * f.v.y });
  const band = at(MARGIN, MARGIN);
  page.drawRectangle({ ...band, width: textWidth + 2 * PAD, height: size + 2 * PAD, rotate: degrees(f.rotate), color: rgb(1, 1, 1), opacity: 0.85 });
  // The baseline sits above the band's bottom by the padding plus the font's descent.
  const descent = font.heightAtSize(size, { descender: true }) - font.heightAtSize(size, { descender: false });
  const base = at(MARGIN + PAD, MARGIN + PAD + Math.max(0, descent));
  page.drawText(text, { ...base, size, font, rotate: degrees(f.rotate), color: rgb(0.1, 0.1, 0.1) });
}

/** Draws the notice on the given pages of `doc` (pages out of range are skipped); returns how many. */
export async function addNotice(doc: PDFDocument, pageIndexes: readonly number[], text = ADVISORY_NOTICE): Promise<number> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  let n = 0;
  for (const i of new Set(pageIndexes)) {
    if (i < 0 || i >= pages.length) continue;
    drawNotice(pages[i], font, text);
    n++;
  }
  return n;
}
