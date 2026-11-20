import { describe, expect, it } from "vitest";

import { isNameValue, type PdfDictValue } from "../pdf/value";
import { arcBeziers, arcVertices, cloudPath, markupAppearance, textBlockSize } from "./appearance";
import { angleDeg, measureDictionary, measureValue, pathLength, polygonArea, polygonCentroid } from "./measure";
import type { Markup } from "./model";
import { CALIBRATION, CELL_LABELS, PAGE_HEIGHT, PAGE_WIDTH, TEXT_RUNS, cellBox, runQuad, sampleDocument } from "./sample-set";

const base = { id: "x", subject: "s", author: "a" };
/** 1 m at 1:100 in points. */
const M = 1 / CALIBRATION.unitsPerPoint;

describe("measurement values (1:100, m)", () => {
  it("computes lengths, areas, angles, radius, diameter and counts", () => {
    const v = (m: Markup) => measureValue(m, CALIBRATION)!;
    expect(v({ ...base, type: "length", from: [0, 0], to: [3 * M, 4 * M] }).text).toBe("5.00 m");
    expect(v({ ...base, type: "polylength", points: [[0, 0], [M, 0], [M, M]] }).value).toBeCloseTo(2, 9);
    expect(v({ ...base, type: "perimeter", points: [[0, 0], [M, 0], [M, M], [0, M]] }).value).toBeCloseTo(4, 9);
    const area = v({ ...base, type: "area", points: [[0, 0], [2 * M, 0], [2 * M, 3 * M], [0, 3 * M]] });
    expect(area.value).toBeCloseTo(6, 9);
    expect(area.text).toBe("6.00 m²");
    expect(v({ ...base, type: "angle", vertex: [0, 0], a: [10, 0], b: [0, 10] }).text).toBe("90.0°");
    expect(v({ ...base, type: "radius", center: [0, 0], radius: M, angleDeg: 0 }).text).toBe("R 1.00 m");
    expect(v({ ...base, type: "diameter", center: [0, 0], radius: M, angleDeg: 0 }).text).toBe("Ø 2.00 m");
    expect(v({ ...base, type: "count", points: [[0, 0], [1, 1]] }).text).toBe("2");
    expect(measureValue({ ...base, type: "line", from: [0, 0], to: [1, 1] }, CALIBRATION)).toBeUndefined();
  });

  it("has geometry helpers that agree with hand values", () => {
    expect(pathLength([[0, 0], [3, 4]])).toBe(5);
    expect(polygonArea([[0, 0], [4, 0], [4, 3]])).toBe(6);
    expect(polygonCentroid([[0, 0], [2, 0], [2, 2], [0, 2]])).toEqual([1, 1]);
    expect(polygonCentroid([[0, 0], [0, 0]])).toEqual([0, 0]);
    expect(angleDeg([0, 0], [1, 0], [-1, -0.0000001])).toBeCloseTo(180, 4);
  });

  it("writes an ISO 32000 rectilinear measure dictionary", () => {
    const d = measureDictionary(CALIBRATION);
    expect(d.Subtype).toEqual({ $name: "RL" });
    const x = (d.X as PdfDictValue[])[0]!;
    expect(x.C).toBeCloseTo(0.0352778, 6);
    expect(x.U).toEqual({ $text: "m" });
    expect(x.D).toBe(100);
    expect(isNameValue(x.F)).toBe(true);
    expect(((d.A as PdfDictValue[])[0]!).U).toEqual({ $text: "sq m" });
  });
});

describe("appearance geometry", () => {
  it("approximates arcs and samples their vertices on the circle", () => {
    const { start, curves } = arcBeziers([0, 0], 10, 0, 180);
    expect(start).toEqual([10, 0]);
    expect(curves).toHaveLength(2);
    expect(curves[1]![2][0]).toBeCloseTo(-10, 9);
    for (const [x, y] of arcVertices([0, 0], 10, 15, 150)) expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
  });

  it("bulges cloud scallops outwards for either ring orientation", () => {
    const square: Array<[number, number]> = [[0, 0], [40, 0], [40, 40], [0, 40]];
    for (const ring of [square, [...square].reverse()]) {
      const { controls } = cloudPath(ring, 1);
      const xs = controls.map((p) => p[0]);
      expect(Math.min(...xs)).toBeLessThan(0);
      expect(Math.max(...xs)).toBeGreaterThan(40);
    }
  });

  it("sizes text blocks from Helvetica metrics and fails on empty geometry", () => {
    const [w, h] = textBlockSize("AB\nC", 10);
    expect(w).toBeGreaterThan(13);
    expect(h).toBeGreaterThan(20);
    expect(() => markupAppearance({ ...base, type: "pen", strokes: [] }, CALIBRATION)).toThrow(/no geometry/);
  });
});

describe("synthetic sample set", () => {
  const doc = sampleDocument();

  it("has one checklist cell per type plus the group and layer cells, all on the A3 page", () => {
    expect(CELL_LABELS).toHaveLength(35);
    for (let i = 0; i < CELL_LABELS.length; i++) {
      const [x0, y0, x1, y1] = cellBox(i);
      expect(x0).toBeGreaterThan(0);
      expect(y0).toBeGreaterThan(0);
      expect(x1).toBeLessThan(PAGE_WIDTH);
      expect(y1).toBeLessThan(PAGE_HEIGHT);
    }
  });

  it("keeps every markup appearance inside the page and inside its cell", () => {
    const cellOf = (i: number) => (i < 33 ? i : i < 36 ? 33 : 34);
    doc.markups.forEach((m, i) => {
      const [x0, y0, x1, y1] = cellBox(m.id === "pm-squiggly" ? 15 : cellOf(i));
      const ap = markupAppearance(m, doc.calibration);
      for (const f of [ap.form, ...(ap.extra ?? [])]) {
        expect(f.bbox[0], m.id).toBeGreaterThanOrEqual(x0);
        expect(f.bbox[1], m.id).toBeGreaterThanOrEqual(y0);
        expect(f.bbox[2], m.id).toBeLessThanOrEqual(x1);
        expect(f.bbox[3], m.id).toBeLessThanOrEqual(y1);
      }
    });
  });

  it("places text markups exactly on their page text runs", () => {
    const hl = doc.markups.find((m) => m.type === "highlight")!;
    expect(hl.type === "highlight" && hl.quads[0]).toEqual(runQuad(TEXT_RUNS.highlight));
  });

  it("uses unique ids and known layers", () => {
    const ids = doc.markups.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const layers = new Set(doc.layers.map((l) => l.id));
    for (const m of doc.markups) if (m.layer) expect(layers.has(m.layer)).toBe(true);
    expect(new Set(doc.markups.map((m) => m.layer).filter(Boolean)).size).toBe(2);
    expect(doc.markups.filter((m) => m.group === "g1")).toHaveLength(3);
  });
});
