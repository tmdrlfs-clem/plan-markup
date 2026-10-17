// WCAG 2.1 contrast helpers (sRGB). Pure functions, no DOM.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGBA =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** Parses `#RGB`, `#RRGGBB`, `rgb(r,g,b)` or `rgba(r,g,b,a)` into 0-255 channels plus alpha 0-1. */
export function parseColor(input: string): Rgba {
  const value = input.trim();
  if (HEX.test(value)) {
    let hex = value.slice(1);
    if (hex.length === 3) {
      hex = [...hex].map((c) => c + c).join("");
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const m = RGBA.exec(value);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  }
  throw new Error(`Unsupported color: "${input}"`);
}

/** Composites a (possibly translucent) color over an opaque background. */
export function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * channel(color.r) +
    0.7152 * channel(color.g) +
    0.0722 * channel(color.b)
  );
}

/**
 * Contrast ratio (1-21) of `fg` over `bg`. A translucent `fg` is composited
 * over `bg` first; `bg` must be opaque.
 */
export function contrastRatio(fg: string, bg: string): number {
  const back = parseColor(bg);
  if (back.a !== 1) {
    throw new Error(`Background must be opaque: "${bg}"`);
  }
  const front = compositeOver(parseColor(fg), back);
  const l1 = relativeLuminance(front);
  const l2 = relativeLuminance(back);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
