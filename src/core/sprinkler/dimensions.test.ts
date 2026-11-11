// Head dimensions: head-to-head and head-to-wall distances for setting out (founder request 2026-11-12).
import { describe, expect, it } from "vitest";

import { factorForRatio } from "@/core/calibration/calibration";
import { markupSchema } from "@/core/schema/markup";

import { headDimensionSegments, headDimensions } from "./dimensions";
import { headMarkup, pageScaleOf } from "./heads";
import { newZone } from "./zone";

const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const lengths = (segs: ReturnType<typeof headDimensionSegments>) => segs.map(([a, b]) => Math.round(Math.hypot(b.x - a.x, b.y - a.y))).sort((a, b) => a - b);
const grid = (xs: number[], ys: number[]) => ys.flatMap((y) => xs.map((x) => ({ x, y })));

describe("head dimensions", () => {
  it("a regular grid: one row's gaps and wall ends, the row spacing, and the outer rows to the wall", () => {
    const segs = headDimensionSegments(rect(9678, 6711), [], grid([1613, 4839, 8065], [1678, 5033]));
    // Row 1: 1613 | 3226 | 3226 | 1613; row 2 repeats it. Across: wall 1678, rows 3355, wall 1678.
    expect(lengths(segs)).toEqual([1613, 1613, 1678, 1678, 3226, 3226, 3355]);
  });

  it("rows that differ are each dimensioned", () => {
    const heads = [...grid([2000, 6000], [2000]), ...grid([1500, 4000, 6500], [5000])];
    const segs = headDimensionSegments(rect(8000, 7000), [], heads);
    expect(lengths(segs)).toEqual([1500, 1500, 2000, 2000, 2000, 2000, 2500, 2500, 3000, 4000]);
  });

  it("a rotated room gives the same figures", () => {
    const a = (25 * Math.PI) / 180;
    const turn = (p: { x: number; y: number }) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a) + 20000, y: p.x * Math.sin(a) + p.y * Math.cos(a) + 5000 });
    const segs = headDimensionSegments(rect(9678, 6711).map(turn), [], grid([1613, 4839, 8065], [1678, 5033]).map(turn));
    expect(lengths(segs)).toEqual([1613, 1613, 1678, 1678, 3226, 3226, 3355]);
  });

  it("a column between two heads of a row: each head is dimensioned to it", () => {
    const col = rect(400, 400, 3800, 1800);
    const segs = headDimensionSegments(rect(8000, 4000), [col], grid([2000, 6000], [2000]));
    // wall 2000, head → column 1800, column ← head 1800, wall 2000; up 2000, down 2000.
    expect(lengths(segs)).toEqual([1800, 1800, 2000, 2000, 2000, 2000]);
  });

  it("one head: its four wall distances; no heads: nothing", () => {
    expect(lengths(headDimensionSegments(rect(4000, 3000), [], [{ x: 1500, y: 1000 }]))).toEqual([1000, 1500, 2000, 2500]);
    expect(headDimensionSegments(rect(4000, 3000), [], [])).toEqual([]);
  });

  it("makes valid dimension markups on the zone's page, and none without a calibration", () => {
    const k = factorForRatio(100);
    const cal = { xFactor: k, yFactor: k };
    const pt = (r: { x: number; y: number }[]) => r.map((p) => ({ x: p.x / k, y: p.y / k }));
    const zone = newZone({ id: "00000000-0000-7000-8000-0000000000d1", pageId: "doc:0", createdAt: "t", outer: pt(rect(9678, 6711)), holes: [] }, [], cal);
    const heads = grid([1613, 4839, 8065], [1678, 5033]).map((h, i) => headMarkup({ ...h, kind: "row" }, zone, pageScaleOf(cal), `00000000-0000-7000-8000-0000000001${i.toString().padStart(2, "0")}`, "t"));
    const dims = headDimensions(zone, heads, cal, 1, 500);
    expect(dims).toHaveLength(7);
    expect(new Set(dims.map((d) => d.id)).size).toBe(7);
    for (const d of dims) {
      expect(markupSchema.safeParse(d).success).toBe(true);
      expect(d.pageId).toBe("doc:0");
    }
    const mm = dims.map((d) => Math.round(Math.hypot(d.points[1].x - d.points[0].x, d.points[1].y - d.points[0].y) * k)).sort((a, b) => a - b);
    expect(mm).toEqual([1613, 1613, 1678, 1678, 3226, 3226, 3355]);
    expect(headDimensions(zone, heads, null)).toEqual([]);
  });
});
