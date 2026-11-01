import { describe, expect, it } from "vitest";

import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";

import { boxPoint, constrain45, copiesOf, resizeOf, rotateAbout, rotateVector, rotationOf, scaleAbout, setVertex, transformMarkup } from "./transform";

const RECT = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 250 },
  { x: 100, y: 250 },
];
const area = {
  id: "00000000-0000-7000-8000-000000000001",
  pageId: "doc:0",
  createdAt: "2026-11-02T00:00:00.000Z",
  style: DEFAULT_MEASURE_STYLE,
  type: "area",
  points: RECT,
  holes: [[{ x: 150, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 200 }]],
  captionOffset: { x: 10, y: 0 },
} as Markup;
const box = { x: 100, y: 100, width: 200, height: 150 };
const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

describe("markup transforms (Story 5.2)", () => {
  it("scales points and holes about an anchor; the caption offset stays", () => {
    const m = transformMarkup(area, scaleAbout({ x: 100, y: 100 }, 2, 2));
    expect(m.points[2]).toEqual({ x: 500, y: 400 });
    expect(m.type === "area" && m.holes?.[0][0]).toEqual({ x: 200, y: 200 });
    expect(m.captionOffset).toEqual({ x: 10, y: 0 });
  });

  it("rotates points and, when asked, the caption offset", () => {
    const quarter = Math.PI / 2;
    const m = transformMarkup(area, rotateAbout({ x: 200, y: 175 }, quarter), rotateVector(quarter));
    close(m.points[0], 275, 75);
    close(m.captionOffset!, 0, 10);
  });

  it("resizes from the opposite handle, from the centre, proportionally", () => {
    // The top-right corner (u 1, v 1) dragged to (500, 400): the bottom-left stays.
    expect(resizeOf(box, { u: 1, v: 1 }, { x: 500, y: 400 }, false, false)).toEqual({ anchor: { x: 100, y: 100 }, sx: 2, sy: 2 });
    // An edge scales one axis; proportional takes the dragged axis for both.
    expect(resizeOf(box, { u: 1, v: 0.5 }, { x: 500, y: 0 }, false, false)).toMatchObject({ sx: 2, sy: 1 });
    expect(resizeOf(box, { u: 1, v: 0.5 }, { x: 500, y: 0 }, true, false)).toMatchObject({ sx: 2, sy: 2 });
    // A corner proportional: the larger change for both.
    expect(resizeOf(box, { u: 1, v: 1 }, { x: 500, y: 175 }, true, false)).toMatchObject({ sx: 2, sy: 2 });
    // Alt: from the centre (200, 175); the right edge to 400 doubles the half width.
    expect(resizeOf(box, { u: 1, v: 0.5 }, { x: 400, y: 0 }, false, true)).toEqual({ anchor: { x: 200, y: 175 }, sx: 2, sy: 1 });
    // A box with no height: y does not scale.
    expect(resizeOf({ x: 0, y: 5, width: 10, height: 0 }, { u: 1, v: 1 }, { x: 20, y: 50 }, false, false)).toMatchObject({ sx: 2, sy: 1 });
    expect(boxPoint(box, { u: 0.5, v: 0 })).toEqual({ x: 200, y: 100 });
  });

  it("rotation snaps to steps; 45° constraint keeps the length along the direction", () => {
    const c = { x: 0, y: 0 };
    expect(rotationOf(c, { x: 10, y: 0 }, { x: 0, y: 10 }, 15)).toBeCloseTo(Math.PI / 2, 9);
    expect((rotationOf(c, { x: 10, y: 0 }, { x: 10, y: 1.5 }, 15) * 180) / Math.PI).toBeCloseTo(15, 9);
    expect((rotationOf(c, { x: 10, y: 0 }, { x: 10, y: 1.5 }, 1) * 180) / Math.PI).toBeCloseTo(9, 9);
    expect(constrain45({ x: 10, y: 1 })).toEqual({ x: 10, y: 0 });
    const d = constrain45({ x: 10, y: 9 });
    expect(d.x).toBeCloseTo(9.5, 9);
    expect(d.y).toBeCloseTo(9.5, 9);
    expect(constrain45({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("sets one vertex; copies get new ids, the page and a time", () => {
    expect(setVertex(area, 1, { x: 310, y: 90 }).points[1]).toEqual({ x: 310, y: 90 });
    expect(setVertex(area, 9, { x: 0, y: 0 })).toBe(area);
    let i = 0;
    const [copy] = copiesOf([area], { x: 5, y: 0 }, "doc:1", () => `id-${++i}`, "2026-11-03T00:00:00.000Z");
    expect(copy).toMatchObject({ id: "id-1", pageId: "doc:1", createdAt: "2026-11-03T00:00:00.000Z", captionOffset: { x: 10, y: 0 } });
    expect(copy.points[0]).toEqual({ x: 105, y: 100 });
    expect(area.points[0]).toEqual({ x: 100, y: 100 });
  });
});
