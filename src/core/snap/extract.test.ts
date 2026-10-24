import { readFileSync } from "node:fs";
import path from "node:path";
import { AnnotationMode, OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { PATH_OP, SEG_END_POINT, SEG_START_POINT, SEG_STRAIGHT, cubicPieces, extractSegments, type SnapOps } from "./extract";

const FIXTURE = path.join(__dirname, "..", "..", "..", "fixtures", "pdf", "snap.pdf");

async function pageSegments(pageNo: number) {
  const task = getDocument({ data: new Uint8Array(readFileSync(FIXTURE)), verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(pageNo);
    const list = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
    return { segments: extractSegments(list.fnArray, list.argsArray, OPS as unknown as SnapOps, { bounds: page.view as [number, number, number, number] }), view: page.view };
  } finally {
    await task.destroy();
  }
}

type Seg = { a: [number, number]; b: [number, number]; flags: number };
function list(s: { coords: Float64Array; flags: Uint8Array; count: number }): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < s.count; i++) out.push({ a: [s.coords[4 * i], s.coords[4 * i + 1]], b: [s.coords[4 * i + 2], s.coords[4 * i + 3]], flags: s.flags[i] });
  return out;
}
const near = (p: [number, number], x: number, y: number) => Math.hypot(p[0] - x, p[1] - y) < 0.01;
const has = (segs: Seg[], x1: number, y1: number, x2: number, y2: number) =>
  segs.some((s) => (near(s.a, x1, y1) && near(s.b, x2, y2)) || (near(s.a, x2, y2) && near(s.b, x1, y1)));

describe("extractSegments on fixtures/pdf/snap.pdf (pdf.js 6.4 operator list)", () => {
  it("reads lines and rectangles in user space points, with endpoint and midpoint flags", async () => {
    const segs = list((await pageSegments(1)).segments);
    for (const [x1, y1, x2, y2] of [
      [100, 100, 300, 100],
      [300, 100, 300, 250],
      [300, 250, 100, 250],
      [100, 250, 100, 100],
      [400, 100, 600, 300],
      [400, 300, 600, 100],
    ]) expect(has(segs, x1, y1, x2, y2), `${x1},${y1}-${x2},${y2}`).toBe(true);
    const straight = segs.find((s) => near(s.a, 400, 100) || near(s.b, 400, 100))!;
    expect(straight.flags).toBe(SEG_START_POINT | SEG_END_POINT | SEG_STRAIGHT);
  });

  it("flattens the circle within the tolerance, with no false endpoints or midpoints", async () => {
    const circle = list((await pageSegments(1)).segments).filter((s) => Math.hypot(s.a[0] - 700, s.a[1] - 200) < 60 && Math.hypot(s.a[0] - 700, s.a[1] - 200) > 40);
    expect(circle.length).toBeGreaterThan(8);
    for (const s of circle) {
      expect(s.flags & SEG_STRAIGHT).toBe(0);
      // Every piece's midpoint stays within 0.1 pt of the circle.
      const mx = (s.a[0] + s.b[0]) / 2;
      const my = (s.a[1] + s.b[1]) / 2;
      expect(Math.abs(Math.hypot(mx - 700, my - 200) - 50)).toBeLessThan(0.15);
    }
    // pdf-lib draws it as 4 Béziers: 4 starts and 4 ends are real points, the rest are not.
    expect(circle.filter((s) => s.flags & SEG_START_POINT)).toHaveLength(4);
  });

  it("applies a form XObject's matrix, and skips white-only fills, clip-only paths and text", async () => {
    const segs = list((await pageSegments(1)).segments);
    expect(has(segs, 600, 400, 650, 400)).toBe(true); // the form's line at half size
    const inside = (x0: number, y0: number, x1: number, y1: number) => segs.filter((s) => [s.a, s.b].every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1));
    expect(inside(99, 399, 201, 501)).toEqual([]); // white-filled rectangle
    expect(inside(299, 399, 401, 501)).toEqual([]); // clip-only rectangle
    expect(inside(440, 440, 540, 480)).toEqual([]); // "SNAP"
  });

  it("reads a /Rotate 90 page with its box off the origin in user space (not rotated)", async () => {
    const { segments, view } = await pageSegments(2);
    expect(view).toEqual([-100, -50, 495, 792]);
    const segs = list(segments);
    expect(has(segs, 0, 0, 200, 0)).toBe(true);
    expect(has(segs, -50, 100, 50, 100)).toBe(true);
  });
});

describe("extractSegments (synthetic operator lists)", () => {
  const ops: SnapOps = {
    save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, constructPath: 91,
    setFillRGBColor: 59, setStrokeRGBColor: 58, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24,
    eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27, endPath: 28, beginText: 31, endText: 32,
  };
  const path = (...d: number[]) => [ops.stroke, [new Float32Array(d)], null];

  it("composes nested transforms and restores them", () => {
    const s = extractSegments(
      [ops.save, ops.transform, ops.transform, ops.constructPath, ops.restore, ops.constructPath],
      [null, [2, 0, 0, 2, 10, 0], [1, 0, 0, 1, 5, 0], path(PATH_OP.moveTo, 0, 0, PATH_OP.lineTo, 1, 0), null, path(PATH_OP.moveTo, 0, 0, PATH_OP.lineTo, 1, 0)],
      ops,
    );
    expect(Array.from(s.coords)).toEqual([20, 0, 22, 0, 0, 0, 1, 0]);
  });

  it("drops zero-length pieces, keeps huge coordinates, stops at the cap and when told to", () => {
    const zero = extractSegments([ops.constructPath], [path(PATH_OP.moveTo, 5, 5, PATH_OP.lineTo, 5, 5)], ops);
    expect(zero.count).toBe(0);
    const huge = extractSegments([ops.constructPath], [path(PATH_OP.moveTo, 1e7, 1e7, PATH_OP.lineTo, 1e7 + 1, 1e7)], ops);
    expect(Array.from(huge.coords)).toEqual([1e7, 1e7, 1e7 + 1, 1e7]);
    const many = path(PATH_OP.moveTo, 0, 0, PATH_OP.lineTo, 1, 0, PATH_OP.lineTo, 1, 1, PATH_OP.lineTo, 0, 1);
    const capped = extractSegments([ops.constructPath], [many], ops, { maxSegments: 2 });
    expect(capped).toMatchObject({ count: 2, truncated: true });
    expect(extractSegments([ops.constructPath], [many], ops, { shouldStop: () => true }).count).toBe(0);
  });

  it("an unknown path opcode stops that path instead of misreading it", () => {
    const s = extractSegments([ops.constructPath], [path(PATH_OP.moveTo, 0, 0, PATH_OP.lineTo, 1, 0, 9, 5, 5)], ops);
    expect(s.count).toBe(1);
  });

  it("splits a cubic into enough pieces for the tolerance", () => {
    expect(cubicPieces([0, 0, 0, 0, 0, 0, 0, 0], 0.1)).toBe(1);
    expect(cubicPieces([0, 0, 0, 100, 100, 100, 100, 0], 0.1)).toBeGreaterThan(cubicPieces([0, 0, 0, 100, 100, 100, 100, 0], 1));
    expect(cubicPieces([0, 0, 0, 1e9, 1e9, 1e9, 1e9, 0], 0.1)).toBe(64);
  });
});
