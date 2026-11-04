import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, isMeasureMarkup, markupSchema, type Markup } from "@/core/schema/markup";

import { hitMarkup, insideLoop, insideRect, markupBounds } from "./geometry";
import { boxCorners, cloudArcs, ellipseFrame, ellipseLocal, ellipseOutline } from "./shapes";
import { rotateAbout, transformMarkup } from "./transform";

const ID = "00000000-0000-7000-8000-000000000001";
const BOX = boxCorners({ x: 100, y: 100 }, { x: 300, y: 250 });

function shape(type: "rectangle" | "ellipse" | "cloud", points: { x: number; y: number }[], style = DEFAULT_MARKUP_STYLE): Markup {
  return markupSchema.parse({ id: ID, pageId: "doc:0", createdAt: "2026-11-04T00:00:00.000Z", style, type, points });
}

describe("box and cloud schemas (Story 5.5)", () => {
  it("takes a rectangle and an ellipse as four corners, a cloud as three or more", () => {
    expect(shape("rectangle", BOX).type).toBe("rectangle");
    expect(shape("ellipse", BOX).type).toBe("ellipse");
    expect(shape("cloud", BOX.slice(0, 3)).type).toBe("cloud");
    expect(() => shape("rectangle", BOX.slice(0, 3))).toThrow();
    expect(() => shape("cloud", BOX.slice(0, 2))).toThrow();
  });

  it("takes an optional fill and opacity (0-1) in the style", () => {
    expect(shape("rectangle", BOX, { ...DEFAULT_MARKUP_STYLE, fill: "#00ff00", opacity: 0.5 }).style).toMatchObject({ fill: "#00ff00", opacity: 0.5 });
    expect(() => shape("rectangle", BOX, { ...DEFAULT_MARKUP_STYLE, opacity: 1.5 })).toThrow();
    expect(() => shape("rectangle", BOX, { ...DEFAULT_MARKUP_STYLE, fill: "green" })).toThrow();
  });

  it("are not measurements", () => {
    expect(isMeasureMarkup(shape("cloud", BOX))).toBe(false);
  });
});

describe("box corners and the ellipse", () => {
  it("orders the corners round the box", () => {
    expect(BOX).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 250 },
      { x: 100, y: 250 },
    ]);
  });

  it("inscribes the ellipse in the box", () => {
    const f = ellipseFrame(BOX);
    expect(f).toEqual({ centre: { x: 200, y: 175 }, u: { x: 100, y: 0 }, v: { x: 0, y: 75 } });
    const out = ellipseOutline(f, 4);
    expect(out[0]).toEqual({ x: 300, y: 175 });
    expect(out[1].x).toBeCloseTo(200);
    expect(out[1].y).toBeCloseTo(250);
    expect(ellipseLocal(f, { x: 300, y: 175 })).toEqual({ x: 1, y: 0 });
    expect(ellipseLocal(ellipseFrame(boxCorners({ x: 0, y: 0 }, { x: 10, y: 0 })), { x: 1, y: 1 })).toBeNull();
  });

  it("bounds a rotated ellipse exactly, not by its corners", () => {
    const m = transformMarkup(shape("ellipse", BOX), rotateAbout({ x: 200, y: 175 }, Math.PI / 4));
    const b = markupBounds(m);
    const r = Math.hypot(100, 75) / Math.SQRT2;
    expect(b.width / 2).toBeCloseTo(r);
    expect(b.height / 2).toBeCloseTo(r);
  });
});

describe("box and cloud hits (D2)", () => {
  it("hits a rectangle and a cloud on the outline and inside", () => {
    for (const type of ["rectangle", "cloud"] as const) {
      const m = shape(type, BOX);
      expect(hitMarkup(m, { x: 200, y: 175 }, 1)).toBe(true);
      expect(hitMarkup(m, { x: 100.5, y: 175 }, 1)).toBe(true);
      expect(hitMarkup(m, { x: 50, y: 175 }, 1)).toBe(false);
    }
  });

  it("hits a cloud's arcs, out to half a chord beyond its corners' ring", () => {
    const m = shape("cloud", BOX);
    expect(hitMarkup(m, { x: 96, y: 175 }, 1)).toBe(true);
    expect(hitMarkup(m, { x: 90, y: 175 }, 1)).toBe(false);
  });

  it("hits an ellipse inside and near its outline, not in the box's corners", () => {
    const m = shape("ellipse", BOX);
    expect(hitMarkup(m, { x: 200, y: 175 }, 1)).toBe(true);
    expect(hitMarkup(m, { x: 300.5, y: 175 }, 1)).toBe(true);
    expect(hitMarkup(m, { x: 105, y: 105 }, 1)).toBe(false);
  });

  it("selects an ellipse by marquee or lasso round its outline", () => {
    const m = shape("ellipse", BOX);
    expect(insideRect(m, { x: 99, y: 99, width: 202, height: 152 })).toBe(true);
    const diamond = [
      { x: 200, y: 50 },
      { x: 400, y: 175 },
      { x: 200, y: 300 },
      { x: 0, y: 175 },
    ];
    expect(insideLoop(m, diamond)).toBe(true);
    expect(insideLoop(shape("rectangle", BOX), diamond)).toBe(false);
  });
});

describe("cloud arcs (D1)", () => {
  it("splits each edge into whole chords of about the size", () => {
    const arcs = cloudArcs(BOX, 9);
    // 200 / 9 ≈ 22, 150 / 9 ≈ 17 per edge.
    expect(arcs).toHaveLength(2 * 22 + 2 * 17);
    expect(arcs[0].radius).toBeCloseTo(200 / 22 / 2);
    expect(cloudArcs(BOX, 1000)).toHaveLength(4);
  });

  it("bulges every arc out of the ring, whichever way round it goes", () => {
    for (const ring of [BOX, [...BOX].reverse()]) {
      for (const a of cloudArcs(ring, 50)) {
        // The arc's middle, half way from start to end in its direction.
        const mid = a.start + (a.anticlockwise ? -Math.PI / 2 : Math.PI / 2);
        const p = { x: a.centre.x + a.radius * Math.cos(mid), y: a.centre.y + a.radius * Math.sin(mid) };
        const inside = p.x > 100 && p.x < 300 && p.y > 100 && p.y < 250;
        expect(inside).toBe(false);
      }
    }
  });

  it("skips edges of no length", () => {
    expect(cloudArcs([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }], 5)).toHaveLength(4);
  });
});
