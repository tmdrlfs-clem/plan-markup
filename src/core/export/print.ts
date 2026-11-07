// Story 8.3 (FR68): the print PDF. Printing goes through a generated PDF so
// that "actual size" measures right on paper: each chosen page (its markups
// already drawn in, or not) is placed on a sheet of the chosen paper, turned
// to the page's orientation, either scaled to fit or at 1:1, centred. A sheet
// "the same as the drawing" is the page's own size. Framework-free.

import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import { exportJobPdf } from "./export";
import type { ExportJob } from "./from-app";

/** Paper sizes in points, portrait (ISO 216, ANSI). */
export const PAPERS = {
  A0: [2383.94, 3370.39],
  A1: [1683.78, 2383.94],
  A2: [1190.55, 1683.78],
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Tabloid: [792, 1224],
} as const satisfies Record<string, readonly [number, number]>;
export type Paper = keyof typeof PAPERS | "same";
export const PAPER_NAMES: readonly Paper[] = ["same", "A0", "A1", "A2", "A3", "A4", "Letter", "Tabloid"];

/** Fit the page to the paper, or print it at its actual size (1:1). */
export type PrintScale = "fit" | "actual";

export type PrintOptions = { pages: readonly number[]; paper: Paper; scale: PrintScale };

/** Where a page of visual size `w` × `h` (points, /Rotate applied) goes on the sheet. */
export type Placement = { sheet: [number, number]; scale: number; x: number; y: number; clipped: boolean };

/** The sheet (turned to the page's orientation), the scale and the page's bottom-left corner on it. */
export function placement(w: number, h: number, paper: Paper, scale: PrintScale): Placement {
  if (paper === "same") return { sheet: [w, h], scale: 1, x: 0, y: 0, clipped: false };
  const [a, b] = PAPERS[paper];
  const sheet: [number, number] = w > h ? [b, a] : [a, b];
  const s = scale === "fit" ? Math.min(sheet[0] / w, sheet[1] / h) : 1;
  return { sheet, scale: s, x: (sheet[0] - w * s) / 2, y: (sheet[1] - h * s) / 2, clipped: w * s > sheet[0] + 1e-6 || h * s > sheet[1] + 1e-6 };
}

/**
 * Where to draw an unrotated page (its box `bw` × `bh`) so that, turned by its /Rotate `angle`
 * (clockwise, as viewers show it), it covers the visual box at (x, y) of size bw·s × bh·s (or
 * turned): the drawing origin and pdf-lib's counter-clockwise rotation.
 */
export function rotatedOrigin(angle: number, x: number, y: number, bw: number, bh: number, s: number): { x: number; y: number; rotate: number } {
  const a = ((angle % 360) + 360) % 360;
  if (a === 90) return { x, y: y + bw * s, rotate: -90 };
  if (a === 180) return { x: x + bw * s, y: y + bh * s, rotate: 180 };
  if (a === 270) return { x: x + bh * s, y, rotate: 90 };
  return { x, y, rotate: 0 };
}

/** The print PDF of `bytes`: the chosen pages, one per sheet (pages out of range are skipped). */
export async function printPdf(bytes: Uint8Array, options: PrintOptions): Promise<{ bytes: Uint8Array; sheets: number; clipped: number }> {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  let sheets = 0;
  let clipped = 0;
  for (const index of options.pages) {
    if (index < 0 || index >= src.getPageCount()) continue;
    const page = src.getPage(index);
    const box = page.getCropBox();
    const angle = page.getRotation().angle;
    const turned = ((angle % 180) + 180) % 180 === 90;
    const [w, h] = turned ? [box.height, box.width] : [box.width, box.height];
    const at = placement(w, h, options.paper, options.scale);
    const sheet = out.addPage(at.sheet);
    // A page with nothing on it (no content stream) prints as a blank sheet.
    if (page.node.Contents()) {
      const embedded = await out.embedPage(page, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
      const o = rotatedOrigin(angle, at.x, at.y, box.width, box.height, at.scale);
      sheet.drawPage(embedded, { x: o.x, y: o.y, xScale: at.scale, yScale: at.scale, rotate: degrees(o.rotate) });
    }
    sheets++;
    if (at.clipped) clipped++;
  }
  return { bytes: await out.save({ useObjectStreams: false }), sheets, clipped };
}

/** The print PDF of a drawing: its markups (the job, if any) drawn in, then laid on the paper. */
export async function printJobPdf(base: Uint8Array, job: ExportJob | null, date: Date, options: PrintOptions): Promise<{ bytes: Uint8Array; sheets: number; clipped: number }> {
  const drawn = job ? (await exportJobPdf(base, job, date, { flatten: true })).bytes : base;
  return printPdf(drawn, options);
}
