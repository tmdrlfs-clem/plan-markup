import { describe, expect, it } from "vitest";

import { parseThemeBlock, readGlobalsCss } from "./theme-css";
import { VIEWER_PALETTE_FALLBACK, viewerPalette } from "./tokens";

describe("viewer palette (Story 3.8)", () => {
  it("the fallback is Blueprint's own values", () => {
    const blueprint = parseThemeBlock(readGlobalsCss(), "blueprint");
    expect(VIEWER_PALETTE_FALLBACK).toEqual({
      backdrop: blueprint["--canvas-backdrop"],
      zoomRect: blueprint["--canvas-zoom-rect"],
      failedFill: blueprint["--canvas-failed-fill"],
      failedStroke: blueprint["--canvas-failed-stroke"],
      searchHit: blueprint["--canvas-search-hit"],
      searchCurrent: blueprint["--canvas-search-current"],
      searchOutline: blueprint["--canvas-search-outline"],
      snap: blueprint["--canvas-snap"],
      halo: blueprint["--canvas-halo"],
      canvasWarning: blueprint["--canvas-warning"],
      selection: blueprint["--accent"],
      fontFamily: "sans-serif", // not a theme token: the browser's own fallback
    });
  });

  it("takes the theme's tokens and falls back only for unreadable ones", () => {
    expect(viewerPalette(null)).toEqual(VIEWER_PALETTE_FALLBACK);
    expect(viewerPalette({ backdrop: "#000000", searchHit: "" })).toEqual({ ...VIEWER_PALETTE_FALLBACK, backdrop: "#000000" });
  });

  it("every theme defines a different backdrop (the canvas visibly follows the theme)", () => {
    const css = readGlobalsCss();
    const backdrops = (["blueprint", "daylight", "contrast"] as const).map((t) => parseThemeBlock(css, t)["--canvas-backdrop"]);
    expect(new Set(backdrops).size).toBe(3);
  });
});
