import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { contrastRatio as ratioOf, compositeOver, parseColor } from "./contrast";
import { CANVAS_SHEET, CONTRAST_PAIRS, MIN_RATIO, SEARCH_CURRENT_PAIR } from "./contrast-pairs";
import { parseThemeBlock, readGlobalsCss } from "./theme-css";
import { THEME_NAMES } from "./token-names";

describe("contrastRatio", () => {
  it("computes known values", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777", "#fff")).toBeCloseTo(4.48, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(
      contrastRatio("#fedcba", "#123456"),
      10,
    );
  });

  it("composites translucent colours over the background", () => {
    // 50% black over white is #808080 -> 3.95:1 against white.
    expect(contrastRatio("rgba(0,0,0,0.5)", "#fff")).toBeCloseTo(
      contrastRatio("#808080", "#fff"),
      1,
    );
  });

  it("rejects unsupported input", () => {
    expect(() => contrastRatio("red", "#fff")).toThrow();
    expect(() => contrastRatio("#000", "rgba(0,0,0,0.5)")).toThrow();
  });
});

const css = readGlobalsCss();

function resolve(vars: Record<string, string>, ref: string): string {
  return ref.startsWith("--") ? vars[ref] : ref;
}

describe.each(THEME_NAMES)("theme %s contrast", (theme) => {
  const vars = parseThemeBlock(css, theme);

  it.each(CONTRAST_PAIRS)("$label ($kind)", (pair) => {
    const fg = resolve(vars, pair.fg);
    const bg = resolve(vars, pair.bg);
    const ratio = contrastRatio(fg, bg);
    const min = MIN_RATIO[pair.kind];
    expect(
      ratio >= min,
      `${theme}: ${pair.label} = ${ratio.toFixed(2)}:1, needs >= ${min}:1`,
    ).toBe(true);
  });

  it("the current search hit's outline reaches 3:1 against its fill over the sheet (Story 3.8)", () => {
    const fill = compositeOver(parseColor(vars[SEARCH_CURRENT_PAIR.fill]), parseColor(CANVAS_SHEET));
    const hex = `#${[fill.r, fill.g, fill.b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
    expect(ratioOf(vars[SEARCH_CURRENT_PAIR.outline], hex)).toBeGreaterThanOrEqual(3);
  });

  it("selection reaches 3:1 on the sheet via accent or its dark outline", () => {
    const best = Math.max(
      contrastRatio(vars["--accent"], CANVAS_SHEET),
      contrastRatio(vars["--canvas-selection-outline"], CANVAS_SHEET),
    );
    expect(best >= 3, `${theme}: selection = ${best.toFixed(2)}:1`).toBe(true);
  });
});
