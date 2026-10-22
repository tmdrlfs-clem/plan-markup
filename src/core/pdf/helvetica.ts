// Advance widths of the standard-14 Helvetica font (Adobe Core 14 AFM, units
// of 1/1000 em) for WinAnsi codes 32-126 plus the few Latin-1 signs the
// export labels use. Lets framework-free code centre and measure text without
// loading a font program.

const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32-47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48-63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64-79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80-95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96-111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 112-126
];

const LATIN1: Record<number, number> = {
  0xb0: 400, // degree
  0xb2: 333, // twosuperior
  0xb3: 333, // threesuperior
  0xd7: 584, // multiply
  0xf8: 611, // oslash (diameter sign stand-in)
  0xd8: 778, // Oslash
};

/** Width of one character in 1/1000 em. Unknown characters count as 556. */
export function helveticaCharWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 32 && c <= 126) return ASCII[c - 32]!;
  return LATIN1[c] ?? 556;
}

/** Width of `text` set in Helvetica at `size` pt. */
export function helveticaWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += helveticaCharWidth(ch);
  return (w * size) / 1000;
}

/** Ascent / descent of Helvetica in 1/1000 em (AFM Ascender / Descender). */
export const HELVETICA_ASCENT = 718;
export const HELVETICA_DESCENT = -207;
