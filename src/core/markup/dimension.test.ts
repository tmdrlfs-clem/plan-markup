import { describe, expect, it } from "vitest";

import { hitMarkup, markupBounds } from "./geometry";
import { dimensionLine, dimensionOutline } from "./dimension";
import { DEFAULT_MARKUP_STYLE, type DimensionMarkup } from "@/core/schema/markup";

describe("dimensionLine (Story 5.8)", () => {
  it("runs parallel to the measured points through the third point's projection", () => {
    expect(dimensionLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 20 })).toEqual({
      from: { x: 0, y: 20 },
      to: { x: 100, y: 20 },
      normal: { x: -0, y: 1 },
      offset: 20,
    });
    // The other side.
    const below = dimensionLine({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 70, y: -5 })!;
    expect(below.from).toEqual({ x: 0, y: -5 });
    expect(below.normal.y).toBe(-1);
    // A sloped dimension keeps its offset perpendicular.
    const sloped = dimensionLine({ x: 0, y: 0 }, { x: 30, y: 40 }, { x: -40, y: 30 })!;
    expect(sloped.offset).toBeCloseTo(50);
    expect(sloped.to.x).toBeCloseTo(-10);
    expect(sloped.to.y).toBeCloseTo(70);
    expect(dimensionLine({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 5, y: 5 })).toBeNull();
  });

  it("outlines, bounds and hits the dimension by its lines", () => {
    const m: DimensionMarkup = {
      id: "0190a0f0-0000-7000-8000-000000000001",
      pageId: "p",
      createdAt: "",
      style: DEFAULT_MARKUP_STYLE,
      type: "dimension",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 30 },
      ],
    };
    expect(dimensionOutline(m.points)).toHaveLength(4);
    expect(markupBounds(m)).toEqual({ x: 0, y: 0, width: 100, height: 30 });
    expect(hitMarkup(m, { x: 50, y: 31 }, 2)).toBe(true);
    expect(hitMarkup(m, { x: 0.5, y: 15 }, 1)).toBe(true);
    expect(hitMarkup(m, { x: 50, y: 15 }, 2)).toBe(false);
  });
});
