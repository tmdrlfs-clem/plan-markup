import { describe, expect, it } from "vitest";

import { simplifyStroke, smoothPath, straightFrom, strokeHasLength } from "./ink";

describe("straightFrom (Story 5.7)", () => {
  it("holds a point horizontal or vertical from the anchor, along the nearer axis", () => {
    expect(straightFrom({ x: 0, y: 0 }, { x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
    expect(straightFrom({ x: 0, y: 0 }, { x: -3, y: -10 })).toEqual({ x: 0, y: -10 });
    expect(straightFrom({ x: 5, y: 5 }, { x: 9, y: 9 })).toEqual({ x: 9, y: 5 });
  });
});

describe("simplifyStroke", () => {
  it("keeps the ends and the corners, drops points within the tolerance and repeated points", () => {
    const stroke = [
      { x: 0, y: 0 },
      { x: 1, y: 0.05 },
      { x: 1, y: 0.05 },
      { x: 2, y: -0.04 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 3.02, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(simplifyStroke(stroke, 0.1)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ]);
  });

  it("handles a long stroke without recursion, and short ones as they are", () => {
    const long = Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) * 100 }));
    const out = simplifyStroke(long, 0.5);
    expect(out[0]).toEqual(long[0]);
    expect(out.at(-1)).toEqual(long.at(-1));
    expect(out.length).toBeLessThan(long.length / 10);
    expect(simplifyStroke([{ x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
    expect(simplifyStroke([{ x: 1, y: 1 }, { x: 1, y: 1 }], 1)).toEqual([{ x: 1, y: 1 }]);
  });
});

describe("strokeHasLength", () => {
  it("is false for a click", () => {
    expect(strokeHasLength([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBe(false);
    expect(strokeHasLength([{ x: 1, y: 1 }, { x: 1, y: 2 }])).toBe(true);
  });
});

describe("smoothPath", () => {
  it("runs through the segments' midpoints with the inner points as controls, ending at the last point", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(path).toEqual({
      start: { x: 0, y: 0 },
      curves: [
        { control: { x: 10, y: 0 }, to: { x: 10, y: 5 } },
        { control: { x: 10, y: 10 }, to: { x: 10, y: 10 } },
      ],
    });
    expect(smoothPath([{ x: 0, y: 0 }])).toBeNull();
  });
});
