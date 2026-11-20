import { describe, expect, it } from "vitest";

import { arcFromClicks, arcPoints } from "./arc";

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

describe("arc markup", () => {
  it("samples the arc through its three points, from start to end, on the circle", () => {
    const pts = arcPoints({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 });
    expect(near(pts[0], { x: 10, y: 0 })).toBe(true);
    expect(near(pts.at(-1)!, { x: -10, y: 0 })).toBe(true);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6);
    // It bulges through the top (y > 0), not the bottom.
    expect(pts.every((p) => p.y >= -1e-9)).toBe(true);
  });

  it("takes the other way round when the middle point is below", () => {
    const pts = arcPoints({ x: 10, y: 0 }, { x: 0, y: -10 }, { x: -10, y: 0 });
    expect(pts.every((p) => p.y <= 1e-9)).toBe(true);
  });

  it("three points in a line are a straight line", () => {
    expect(arcPoints({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it("clicks: start, end, then the bulge, stored start, through, end", () => {
    expect(arcFromClicks({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ]);
  });
});
