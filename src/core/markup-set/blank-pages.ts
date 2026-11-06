// Story 6.6 (FR51): blank pages standing in for a markup set's PDF when the
// file is not at hand. Each page keeps the set's page geometry (its crop box as
// the media box, and its /Rotate), so the markups' page coordinates land where
// they were drawn.

import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import type { PageGeometry } from "./markup-set";

/** A PDF of blank pages with the geometry of `pages`. */
export async function blankPagesPdf(pages: readonly PageGeometry[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const page of pages) {
    const [x1, y1, x2, y2] = page.cropBox;
    const left = Math.min(x1, x2);
    const bottom = Math.min(y1, y2);
    const width = Math.abs(x2 - x1) || page.width;
    const height = Math.abs(y2 - y1) || page.height;
    const blank = doc.addPage([width, height]);
    blank.setMediaBox(left, bottom, width, height);
    if (page.rotation) blank.setRotation(degrees(page.rotation));
  }
  return doc.save();
}
