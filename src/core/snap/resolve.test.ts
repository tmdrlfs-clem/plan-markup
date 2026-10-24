import { readFileSync } from "node:fs";
import path from "node:path";
import { AnnotationMode, OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";

import { SEG_END_POINT, SEG_START_POINT, SEG_STRAIGHT, extractSegments, type SnapOps } from "./extract";
import { SnapIndex, buildSnapIndex, indexSource } from "./index";
import { MAX_CANDIDATES, intersect, resolveSnap, type SnapSegment, type SnapSource } from "./resolve";

const LINE = SEG_START_POINT | SEG_END_POINT | SEG_STRAIGHT;
const source = (segs: SnapSegment[]): SnapSource => ({
  near: (x, y, _r, limit) =>
    segs
      .map((s) => ({ s, d: Math.min(Math.hypot(s.ax - x, s.ay - y), Math.hypot(s.bx - x, s.by - y), Math.hypot((s.ax + s.bx) / 2 - x, (s.ay + s.by) / 2 - y)) }))
      .sort((a, b) => a.d - b.d)
      .map((e) => e.s)
      .slice(0, limit),
});
const seg = (ax: number, ay: number, bx: number, by: number, flags = LINE): SnapSegment => ({ ax, ay, bx, by, flags });

// The shipped extraction on the committed fixture (NFR45): fixtures/pdf/snap.pdf page 1.
let fixture: SnapSource;
beforeAll(async () => {
  const file = path.join(__dirname, "..", "..", "..", "fixtures", "pdf", "snap.pdf");
  const task = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
  const page = await (await task.promise).getPage(1);
  const list = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  fixture = indexSource(new SnapIndex(buildSnapIndex(extractSegments(list.fnArray, list.argsArray, OPS as unknown as SnapOps))));
  await task.destroy();
});

describe("resolveSnap on the fixture's linework", () => {
  const at = (x: number, y: number, from?: { x: number; y: number }) => resolveSnap({ point: { x, y }, tolerance: 8, sources: [fixture], from });

  it("endpoint beats everything near a rectangle corner", () => {
    expect(at(103, 98)).toMatchObject({ type: "endpoint", x: 100, y: 100 });
  });
  it("intersection where the two lines cross", () => {
    const r = at(503, 198)!;
    expect(r.type).toBe("intersection");
    expect(r.x).toBeCloseTo(500, 6);
    expect(r.y).toBeCloseTo(200, 6);
  });
  it("midpoint of a rectangle side", () => {
    expect(at(202, 103)).toMatchObject({ type: "midpoint", x: 200, y: 100 });
  });
  it("on line elsewhere on a side, and on the circle (no false endpoints or midpoints on a curve)", () => {
    const side = at(150, 104)!;
    expect(side).toMatchObject({ type: "on-line", x: 150 });
    expect(side.y).toBeCloseTo(100, 9);
    const circle = at(700 + 50 * Math.cos(0.3) + 2, 200 + 50 * Math.sin(0.3))!;
    expect(circle.type).toBe("on-line");
    expect(Math.hypot(circle.x - 700, circle.y - 200)).toBeCloseTo(50, 1);
  });
  it("perpendicular from a 'from' point beats on-line", () => {
    const r = at(240, 104, { x: 240, y: 180 })!;
    expect(r.type).toBe("perpendicular");
    expect(r.x).toBeCloseTo(240, 9);
    expect(r.y).toBeCloseTo(100, 9);
  });
  it("nothing outside the tolerance", () => {
    expect(at(150, 150)).toBeNull();
  });
});

describe("resolveSnap edge cases", () => {
  it("ties within a type go to the nearest", () => {
    const r = resolveSnap({ point: { x: 0, y: 0 }, tolerance: 10, sources: [source([seg(3, 0, 50, 50), seg(-2, 0, -50, 50)])] });
    expect(r).toMatchObject({ type: "endpoint", x: -2, y: 0 });
  });
  it("near-parallel lines do not produce a far-off intersection", () => {
    const r = resolveSnap({ point: { x: 50, y: 0.5 }, tolerance: 5, sources: [source([seg(0, 0, 100, 0), seg(0, 1, 100, 1 + 1e-9)])] });
    expect(r!.type).not.toBe("intersection");
    expect(intersect(0, 0, 100, 0, 0, 1, 100, 1 + 1e-9)).toBeNull();
  });
  it("segments meeting end to end do not intersect; a T-junction does", () => {
    expect(intersect(0, 0, 10, 0, 10, 0, 10, 10)).toBeNull();
    expect(intersect(0, 0, 10, 0, 5, 0, 5, 10)).toEqual({ x: 5, y: 0 });
  });
  it("zero-length and non-finite segments are ignored", () => {
    expect(resolveSnap({ point: { x: 0, y: 0 }, tolerance: 5, sources: [source([seg(1, 1, 1, 1), seg(Number.NaN, 0, 1, 0)])] })).toBeNull();
  });
  it("huge coordinates keep their precision", () => {
    const X = 1e7;
    const r = resolveSnap({ point: { x: X + 0.3, y: X + 0.2 }, tolerance: 1, sources: [source([seg(X, X - 5, X, X + 5), seg(X - 5, X, X + 5, X)])] })!;
    expect(r).toMatchObject({ type: "intersection", x: X, y: X });
  });
  it("a rotated page is plain user space: the caller converts the cursor, resolution is the same", () => {
    const r = resolveSnap({ point: { x: 1, y: 199 }, tolerance: 3, sources: [source([seg(0, 0, 0, 200)])] });
    expect(r).toMatchObject({ type: "endpoint", x: 0, y: 200 });
  });
  it("bounded work: never more than MAX_CANDIDATES segments are read", () => {
    const asked: number[] = [];
    const many: SnapSource = {
      near: (_x, _y, _r, limit) => {
        asked.push(limit);
        return Array.from({ length: limit }, (_, i) => seg(i * 0.01, -1, i * 0.01, 1));
      },
    };
    resolveSnap({ point: { x: 0, y: 0 }, tolerance: 5, sources: [many, many] });
    expect(asked).toEqual([MAX_CANDIDATES]); // the second source is not even asked: the budget is spent
  });
  it("no tolerance, no point: nothing", () => {
    expect(resolveSnap({ point: { x: 0, y: 0 }, tolerance: 0, sources: [source([seg(0, 0, 1, 0)])] })).toBeNull();
    expect(resolveSnap({ point: { x: Number.NaN, y: 0 }, tolerance: 1, sources: [source([seg(0, 0, 1, 0)])] })).toBeNull();
  });
});
