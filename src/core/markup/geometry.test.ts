import { describe, expect, it } from "vitest";

import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";

import { hitMarkup, insideLoop, insidePolygon, insideRect, markupBounds, rectOf, segmentDistance, translateMarkup } from "./geometry";
import { MarkupIndex } from "./markup-index";

let n = 0;
function markup(type: Markup["type"], points: { x: number; y: number }[], extra: object = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: "doc:0",
    createdAt: "2026-11-02T00:00:00.000Z",
    style: DEFAULT_MEASURE_STYLE,
    type,
    points,
    ...extra,
  } as Markup;
}

const RECT = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 250 },
  { x: 100, y: 250 },
];
const HOLE = [
  { x: 150, y: 150 },
  { x: 200, y: 150 },
  { x: 200, y: 200 },
  { x: 150, y: 200 },
];
const CIRCLE = [
  { x: 10, y: 0 },
  { x: 0, y: 10 },
  { x: -10, y: 0 },
];

describe("markup geometry (Story 5.1)", () => {
  it("measures a point's distance to a segment", () => {
    expect(segmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(segmentDistance({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(segmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it("hits lines by their stroke, areas also inside (not in a hole), counts by a marker, circles by circle and line", () => {
    const line = markup("polylength", [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(hitMarkup(line, { x: 50, y: 2 }, 3)).toBe(true);
    expect(hitMarkup(line, { x: 50, y: 5 }, 3)).toBe(false);
    expect(hitMarkup(line, { x: 50, y: 50 }, 3)).toBe(false);
    const area = markup("area", RECT, { holes: [HOLE] });
    expect(hitMarkup(area, { x: 120, y: 120 }, 1)).toBe(true);
    expect(hitMarkup(area, { x: 175, y: 175 }, 1)).toBe(false);
    expect(hitMarkup(area, { x: 150, y: 175 }, 1)).toBe(true);
    expect(hitMarkup(area, { x: 99, y: 175 }, 2)).toBe(true);
    const count = markup("count", [{ x: 0, y: 0 }, { x: 50, y: 0 }]);
    expect(hitMarkup(count, { x: 53, y: 3 }, 1)).toBe(true);
    expect(hitMarkup(count, { x: 25, y: 0 }, 1)).toBe(false);
    const radius = markup("radius", CIRCLE);
    expect(hitMarkup(radius, { x: 0, y: -10.5 }, 1)).toBe(true);
    expect(hitMarkup(radius, { x: 5, y: 0.5 }, 1)).toBe(true);
    expect(hitMarkup(radius, { x: -5, y: 0.5 }, 1)).toBe(false);
    expect(hitMarkup(markup("diameter", CIRCLE), { x: -5, y: 0.5 }, 1)).toBe(true);
  });

  it("bounds a circle by its whole circle; containment by rectangle and loop", () => {
    const radius = markup("radius", CIRCLE);
    const b = markupBounds(radius);
    expect(b.x).toBeCloseTo(-10);
    expect(b.width).toBeCloseTo(20);
    expect(insideRect(radius, { x: -11, y: -11, width: 22, height: 22 })).toBe(true);
    expect(insideRect(radius, { x: -11, y: -5, width: 22, height: 22 })).toBe(false);
    const area = markup("area", RECT);
    expect(insideLoop(area, [{ x: 90, y: 90 }, { x: 320, y: 90 }, { x: 200, y: 400 }])).toBe(false);
    expect(insideLoop(area, [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }])).toBe(true);
    expect(insidePolygon({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toBe(false);
    expect(rectOf({ x: 5, y: 1 }, { x: 1, y: 4 })).toEqual({ x: 1, y: 1, width: 4, height: 3 });
  });

  it("translates every point, holes too, and keeps the caption offset", () => {
    const area = markup("area", RECT, { holes: [HOLE], captionOffset: { x: 3, y: 4 } });
    const moved = translateMarkup(area, { x: 10, y: -5 });
    expect(moved.points[0]).toEqual({ x: 110, y: 95 });
    expect(moved.type === "area" && moved.holes?.[0][0]).toEqual({ x: 160, y: 145 });
    expect(moved.captionOffset).toEqual({ x: 3, y: 4 });
    expect(area.points[0]).toEqual({ x: 100, y: 100 });
  });
});

describe("MarkupIndex (Story 5.1, AR15)", () => {
  it("hits the topmost markup; finds markups wholly inside a rectangle or loop in drawing order", () => {
    const a = markup("area", RECT);
    const b = markup("length", [{ x: 120, y: 120 }, { x: 180, y: 120 }]);
    const c = markup("count", [{ x: 500, y: 500 }]);
    const index = new MarkupIndex([a, b, c]);
    expect(index.hit({ x: 150, y: 121 }, 2)).toBe(b);
    expect(index.hit({ x: 150, y: 200 }, 2)).toBe(a);
    expect(index.hit({ x: 503, y: 500 }, 0.5)).toBe(c);
    expect(index.hit({ x: 400, y: 400 }, 2)).toBeNull();
    expect(index.inRect({ x: 110, y: 110, width: 100, height: 20 })).toEqual([b]);
    expect(index.inRect({ x: 0, y: 0, width: 600, height: 600 })).toEqual([a, b, c]);
    expect(index.inLoop([{ x: 110, y: 110 }, { x: 200, y: 110 }, { x: 200, y: 130 }, { x: 110, y: 130 }])).toEqual([b]);
    expect(index.inLoop([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([]);
  });
});
