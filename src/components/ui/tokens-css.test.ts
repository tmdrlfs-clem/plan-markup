import { describe, expect, it } from "vitest";

import { parseThemeBlock, readGlobalsCss } from "./theme-css";
import { REQUIRED_THEME_VARS, THEME_NAMES } from "./token-names";

const css = readGlobalsCss();

describe("globals.css theme blocks", () => {
  it.each(THEME_NAMES)("%s defines every required variable", (theme) => {
    const vars = parseThemeBlock(css, theme);
    const missing = REQUIRED_THEME_VARS.filter((name) => !vars[name]);
    expect(missing).toEqual([]);
  });

  it("sets Blueprint as the default theme in the root layout", async () => {
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync(
      new URL("../../app/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain('data-theme="blueprint"');
  });

  it("has no shadow with a non-zero blur", () => {
    const shadows = [...css.matchAll(/--shadow-\d+:\s*([^;]+);/g)]
      .map((m) => m[1])
      .filter((v) => v !== "initial");
    expect(shadows.length).toBeGreaterThanOrEqual(3);
    for (const value of shadows) {
      // A shadow layer is: <x> <y> [blur] [spread] <color>. Blur is the third length.
      const layers = value.split(/,(?![^(]*\))/);
      for (const layer of layers) {
        const lengths = layer
          .replace(/rgba?\([^)]*\)/g, "")
          .replace(/var\([^)]*\)/g, "")
          .match(/-?[\d.]+(?:px)?/g);
        const blur = lengths?.[2];
        expect(
          blur === undefined || parseFloat(blur) === 0,
          `shadow "${layer.trim()}" has a non-zero blur`,
        ).toBe(true);
      }
    }
  });
});
