// The PDF standard-14 faces a text markup can be set in (text format bar,
// founder 2026-11-21), with their advance widths for WinAnsi 32–126 (Adobe
// Core 14 AFM, 1/1000 em) so framework-free code can wrap, align and measure
// text without a font program. Other characters count as the face's "n".
// Oblique faces share their upright widths (Helvetica, Courier).

export type FontFamily = "sans" | "serif" | "mono";
export type PdfFace = { baseFont: string; widths: readonly number[]; ascent: number; descent: number };

const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const TIMES = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];
const TIMES_BOLD = [250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778, 611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500, 333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500, 556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520];
const TIMES_ITALIC = [250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500, 920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500, 333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541];
const TIMES_BOLD_ITALIC = [250, 389, 555, 500, 500, 833, 778, 278, 333, 333, 500, 570, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500, 832, 667, 667, 667, 722, 667, 667, 722, 778, 389, 500, 667, 611, 889, 722, 722, 611, 722, 667, 556, 611, 722, 667, 889, 667, 611, 611, 333, 278, 333, 570, 500, 333, 500, 500, 444, 500, 444, 333, 500, 556, 278, 278, 500, 278, 778, 556, 500, 500, 500, 389, 389, 278, 556, 444, 667, 500, 444, 389, 348, 220, 348, 570];
const COURIER = new Array<number>(95).fill(600);

const face = (baseFont: string, widths: readonly number[], ascent: number, descent: number): PdfFace => ({ baseFont, widths, ascent, descent });

const FACES: Record<FontFamily, [PdfFace, PdfFace, PdfFace, PdfFace]> = {
  // regular, bold, italic, bold italic
  sans: [face("Helvetica", HELVETICA, 718, -207), face("Helvetica-Bold", HELVETICA_BOLD, 718, -207), face("Helvetica-Oblique", HELVETICA, 718, -207), face("Helvetica-BoldOblique", HELVETICA_BOLD, 718, -207)],
  serif: [face("Times-Roman", TIMES, 683, -217), face("Times-Bold", TIMES_BOLD, 683, -217), face("Times-Italic", TIMES_ITALIC, 683, -217), face("Times-BoldItalic", TIMES_BOLD_ITALIC, 683, -217)],
  mono: [face("Courier", COURIER, 629, -157), face("Courier-Bold", COURIER, 629, -157), face("Courier-Oblique", COURIER, 629, -157), face("Courier-BoldOblique", COURIER, 629, -157)],
};

/** The face for a family, bold and italic. */
export function pdfFace(family: FontFamily = "sans", bold = false, italic = false): PdfFace {
  return FACES[family][(bold ? 1 : 0) + (italic ? 2 : 0)];
}

/** Width of `text` in `f` at `size` pt. */
export function faceWidth(f: PdfFace, text: string, size: number): number {
  const fallback = f.widths["n".charCodeAt(0) - 32];
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    w += c >= 32 && c <= 126 ? f.widths[c - 32] : fallback;
  }
  return (w * size) / 1000;
}
