import { describe, expect, it } from "vitest";

import { factorForRatio, measureLength } from "@/core/calibration/calibration";
import { DEFAULT_MEASURE_STYLE, type MeasureMarkup } from "@/core/schema/markup";

import { formatTotal, formatValue, markupBounds, measurementGroups, measurementValue, panelPrecision, type PageContext } from "./totals";

const k100 = factorForRatio(100);
const cal = { xFactor: k100, yFactor: k100 };
const mm = { unit: "mm" as const, precision: "0" as const };
const scaled: PageContext = { calibration: cal, userUnit: 1 };
const unscaled: PageContext = { calibration: null, userUnit: 1 };

let n = 0;
function markup<T extends MeasureMarkup["type"]>(type: T, points: { x: number; y: number }[], pageId = "doc:0", extra: object = {}): MeasureMarkup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId,
    createdAt: "2026-11-01T00:00:00.000Z",
    style: DEFAULT_MEASURE_STYLE,
    type,
    points,
    ...extra,
  } as MeasureMarkup;
}

const RECT = [
  { x: 100, y: 100 },
  { x: 300, y: 100 },
  { x: 300, y: 250 },
  { x: 100, y: 250 },
];

describe("measurementValue (Story 4.11)", () => {
  it("measures each type as its caption does", () => {
    const len = measurementValue(markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]), scaled);
    expect(len).toEqual({ kind: "length", mm: measureLength(72, 0, cal) });
    expect(formatValue("length", len, mm)).toBe("2540 mm");
    const area = measurementValue(markup("area", RECT), scaled);
    expect(area.kind).toBe("area");
    expect(formatValue("area", area, mm)).toBe("37.34 m²");
    expect(formatValue("count", measurementValue(markup("count", RECT), unscaled), mm)).toBe("4");
    const angle = measurementValue(markup("angle", [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }]), unscaled);
    expect(formatValue("angle", angle, mm)).toBe("90.0°");
    const circle = [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }];
    expect(formatValue("radius", measurementValue(markup("radius", circle), scaled), mm)).toBe(`R ${Math.round(measureLength(10, 0, cal))} mm`);
    expect(formatValue("diameter", measurementValue(markup("diameter", circle), scaled), mm)).toBe(`Ø ${Math.round(measureLength(20, 0, cal))} mm`);
  });

  it("has no value without a scale, or without a circle", () => {
    expect(formatValue("length", measurementValue(markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]), unscaled), mm)).toBe("Scale not set");
    expect(formatValue("area", measurementValue(markup("area", RECT), unscaled), mm)).toBe("Scale not set");
    const line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    expect(formatValue("radius", measurementValue(markup("radius", line), scaled), mm)).toBe("Points in a line");
  });

  it("subtracts holes and applies UserUnit", () => {
    const hole = [{ x: 150, y: 150 }, { x: 150, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 150 }];
    const whole = measurementValue(markup("area", RECT), scaled);
    const cut = measurementValue(markup("area", RECT, "doc:0", { holes: [hole] }), scaled);
    if (whole.kind !== "area" || cut.kind !== "area") throw new Error("area");
    expect(whole.mm2 - cut.mm2).toBeCloseTo(measureLength(50, 0, cal) ** 2, 3);
    const big = measurementValue(markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }]), { calibration: cal, userUnit: 2 });
    expect(big).toEqual({ kind: "length", mm: 2 * measureLength(72, 0, cal) });
  });
});

describe("measurementGroups (Story 4.11)", () => {
  const pages: Record<string, PageContext & { pageIndex: number }> = {
    "doc:0": { ...scaled, pageIndex: 0 },
    "doc:1": { ...unscaled, pageIndex: 1 },
    "doc:2": { ...scaled, pageIndex: 2 },
  };
  const pageOf = (id: string) => pages[id] ?? null;

  it("groups by type in menu order with totals; rows in page then drawing order", () => {
    const a = markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }], "doc:2");
    const b = markup("length", [{ x: 0, y: 0 }, { x: 0, y: 36 }], "doc:0");
    const c = markup("count", RECT, "doc:1");
    const d = markup("area", RECT, "doc:0");
    const e = markup("angle", [{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }], "doc:0");
    const f = markup("length", [{ x: 0, y: 0 }, { x: 10, y: 0 }], "doc:9");
    const groups = measurementGroups([a, b, c, d, e, f], pageOf);
    expect(groups.map((g) => g.type)).toEqual(["length", "area", "count", "angle"]);
    const length = groups[0];
    expect(length.rows.map((r) => r.markup.id)).toEqual([b.id, a.id]);
    expect(length.total).toBeCloseTo(measureLength(72, 0, cal) + measureLength(0, 36, cal), 6);
    expect(formatTotal(length, mm)).toBe("3810 mm");
    expect(formatTotal(length, { unit: "m", precision: "0.00" })).toBe("3.81 m");
    expect(formatTotal(groups[1], { unit: "ft-in", precision: "1/8" })).toBe("401.88 ft²");
    expect(formatTotal(groups[2], mm)).toBe("4");
    expect(groups[3].total).toBeNull();
    expect(formatTotal(groups[3], mm)).toBeNull();
  });

  it("leaves unscaled measurements out of the total and counts them", () => {
    const groups = measurementGroups(
      [markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }], "doc:0"), markup("length", [{ x: 0, y: 0 }, { x: 72, y: 0 }], "doc:1")],
      pageOf,
    );
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].unscaled).toBe(1);
    expect(groups[0].total).toBeCloseTo(measureLength(72, 0, cal), 6);
    // Review R2: three points in a line have no value, but they are not "not scaled".
    const line = measurementGroups([markup("radius", [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], "doc:0")], pageOf);
    expect(line[0].unscaled).toBe(0);
  });
});

describe("panelPrecision (Story 4.11)", () => {
  it("keeps the calibration's precision only in its own unit", () => {
    expect(panelPrecision("mm", { unit: "mm", precision: "0.0" })).toBe("0.0");
    expect(panelPrecision("m", { unit: "mm", precision: "0" })).toBe("0.00");
    expect(panelPrecision("ft-in", { unit: "ft-in", precision: "1/16" })).toBe("1/16");
    expect(panelPrecision("ft-in", null)).toBe("1/8");
  });
});

describe("markupBounds (Story 4.11)", () => {
  it("boxes the points, or a circle's whole circle", () => {
    expect(markupBounds(markup("area", RECT))).toEqual({ x: 100, y: 100, width: 200, height: 150 });
    const b = markupBounds(markup("radius", [{ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }]));
    expect(b.x).toBeCloseTo(-10);
    expect(b.y).toBeCloseTo(-10);
    expect(b.width).toBeCloseTo(20);
    expect(b.height).toBeCloseTo(20);
    expect(markupBounds(markup("count", [{ x: 5, y: 6 }]))).toEqual({ x: 5, y: 6, width: 0, height: 0 });
  });
});
