import { describe, expect, it } from "vitest";

import { factorForRatio, measureLength } from "@/core/calibration/calibration";
import { markupSchema } from "@/core/schema/markup";

import { areaCaption, areaCaptionText, areaMm2, formatArea, perimeterMm, polygonCentroid, segmentsMeet, selfIntersects } from "./area";

const k100 = factorForRatio(100);
const cal = { xFactor: k100, yFactor: k100, unit: "mm" as const, precision: "0" as const };
// The fixture rectangle (snap.pdf): 200 × 150 pt.
const RECT = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 250 },
  { x: 100, y: 250 },
];

describe("areaMm2 (Story 4.8)", () => {
  it("is the product of the two sides Verify would measure, either winding", () => {
    const w = measureLength(200, 0, cal);
    const h = measureLength(0, 150, cal);
    expect(areaMm2(RECT, undefined, cal)).toBeCloseTo(w * h, 6);
    expect(areaMm2([...RECT].reverse(), undefined, cal)).toBeCloseTo(w * h, 6);
    expect(areaMm2(RECT, undefined, null)).toBeNull();
  });

  it("subtracts holes, whatever their winding", () => {
    const hole = [
      { x: 150, y: 150 },
      { x: 150, y: 200 },
      { x: 250, y: 200 },
      { x: 250, y: 150 },
    ];
    const full = areaMm2(RECT, undefined, cal)!;
    const cut = areaMm2(RECT, [hole], cal)!;
    expect(cut).toBeCloseTo(full - measureLength(100, 0, cal) * measureLength(0, 50, cal), 6);
    expect(areaMm2(RECT, [hole, [...hole].reverse()], cal)).toBeCloseTo(full - 2 * (full - cut), 6);
  });

  it("uses separate X / Y factors and the UserUnit", () => {
    const xy = { xFactor: factorForRatio(100), yFactor: factorForRatio(50) };
    expect(areaMm2(RECT, undefined, xy)).toBeCloseTo(measureLength(200, 0, xy) * measureLength(0, 150, xy), 6);
    expect(areaMm2(RECT, undefined, cal, 2)).toBeCloseTo(4 * areaMm2(RECT, undefined, cal)!, 6);
  });
});

describe("captions (Story 4.8)", () => {
  it("reads 37.34 m², P 24694 mm for the fixture rectangle at 1:100", () => {
    const c = areaCaption(RECT, undefined, cal);
    expect(c).toEqual({ area: "37.34 m²", perimeter: "24694 mm", scaled: true });
    expect(areaCaptionText(c)).toBe("37.34 m², P 24694 mm");
    expect(perimeterMm(RECT, cal)).toBeCloseTo(2 * (measureLength(200, 0, cal) + measureLength(0, 150, cal)), 6);
  });

  it("formats m² for metric units and ft² for imperial ones; Scale not set without a calibration", () => {
    expect(formatArea(1_234_567, "mm")).toBe("1.23 m²");
    expect(formatArea(1_234_567, "m")).toBe("1.23 m²");
    expect(formatArea(304.8 * 304.8 * 10, "ft-in")).toBe("10.00 ft²");
    expect(formatArea(304.8 * 304.8 * 2.5, "in")).toBe("2.50 ft²");
    expect(areaCaption(RECT, undefined, null)).toEqual({ area: "Scale not set", perimeter: null, scaled: false });
    expect(areaCaptionText(areaCaption(RECT, undefined, null))).toBe("Scale not set");
  });

  it("places the caption at the centroid (an L shape's lies in its bigger part)", () => {
    expect(polygonCentroid(RECT)).toEqual({ x: 200, y: 175 });
    const L = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 0, y: 30 },
    ];
    const c = polygonCentroid(L);
    expect(c.x).toBeCloseTo(c.y, 9);
    expect(c.x).toBeCloseTo((15 * 300 + 5 * 200) / 500, 9);
    // Degenerate: the mean of the vertices.
    expect(polygonCentroid([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toEqual({ x: 10, y: 0 });
  });
});

describe("selfIntersects (Story 4.8, D3)", () => {
  it("accepts simple polygons, convex or not", () => {
    expect(selfIntersects(RECT)).toBe(false);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }])).toBe(false);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }])).toBe(false);
  });

  it("rejects a bow tie, a vertex on another edge, a collinear overlap, a spike and degenerate rings", () => {
    // Crossing.
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(true);
    // Touching: a vertex lands on a non-adjacent edge.
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 10, y: 0 }, { x: 0, y: 20 }])).toBe(true);
    // Collinear overlap of two non-adjacent edges.
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 15, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 10 }])).toBe(true);
    // A spike back along the previous edge.
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(true);
    // Fewer than three distinct vertices, a repeated vertex, no area.
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(true);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }])).toBe(true);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(true);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBe(true);
  });

  it("segmentsMeet: crossing, touching and overlapping count; apart and parallel do not", () => {
    const o = { x: 0, y: 0 };
    expect(segmentsMeet(o, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsMeet(o, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 })).toBe(true);
    expect(segmentsMeet(o, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(true);
    expect(segmentsMeet(o, { x: 10, y: 0 }, { x: 11, y: 0 }, { x: 15, y: 0 })).toBe(false);
    expect(segmentsMeet(o, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(false);
  });
});

describe("area and count markups in the schema (Story 4.8)", () => {
  const base = { id: "0190a8a0-0000-7000-8000-000000000000", pageId: "x:0", createdAt: "2026-11-01T00:00:00Z", style: { color: "#ff0000", width: 1, fontSize: 10 } };
  it("an area needs three points; holes need three each; a count needs one", () => {
    expect(markupSchema.safeParse({ ...base, type: "area", points: RECT }).success).toBe(true);
    expect(markupSchema.safeParse({ ...base, type: "area", points: RECT.slice(0, 2) }).success).toBe(false);
    expect(markupSchema.safeParse({ ...base, type: "area", points: RECT, holes: [RECT.slice(0, 3)] }).success).toBe(true);
    expect(markupSchema.safeParse({ ...base, type: "area", points: RECT, holes: [RECT.slice(0, 2)] }).success).toBe(false);
    expect(markupSchema.safeParse({ ...base, type: "count", points: [RECT[0]] }).success).toBe(true);
    expect(markupSchema.safeParse({ ...base, type: "count", points: [] }).success).toBe(false);
    expect(markupSchema.safeParse({ ...base, type: "count", points: [RECT[0]], captionOffset: { x: 1, y: 2 } }).success).toBe(true);
  });
});
