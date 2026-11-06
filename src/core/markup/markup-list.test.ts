import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import { markupListRows, pageIndexOf, visibleRange, type ListPage } from "./markup-list";

const k100 = factorForRatio(100);
const CAL: Calibration = { xFactor: k100, yFactor: k100, unit: "mm", precision: "0", source: "ratio" } as Calibration;
const LAYER = "00000000-0000-7000-8000-00000000aaaa";

let n = 0;
function markup(type: string, pageId: string, extra: object = {}): Markup {
  n++;
  const points = type === "length" ? [{ x: 0, y: 0 }, { x: 72, y: 0 }] : [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId,
    createdAt: `2026-11-0${n % 9}T00:00:00.000Z`,
    style: { ...DEFAULT_MARKUP_STYLE, color: "#00ff00" },
    type,
    points,
    ...extra,
  } as Markup;
}

const pages: ListPage[] = [
  { label: "A-101", calibration: CAL, userUnit: 1 },
  { label: "Page 2", calibration: null, userUnit: 1 },
];

describe("Markups List rows (Story 6.7)", () => {
  it("one row per markup in page order then drawing order, with subject, page, colour, layer and value", () => {
    const list = [
      markup("line", "doc:1"),
      markup("length", "doc:0", { subject: "Duct run", layerId: LAYER }),
      markup("arrow", "doc:0"),
      markup("length", "doc:1"),
      markup("eraser", "doc:0"),
      markup("line", "other:0"),
      markup("line", "doc:7"),
    ];
    const rows = markupListRows(list, "doc", pages, [{ id: LAYER, name: "Fire" }]);
    expect(rows.map((r) => [r.type, r.page, r.subject, r.layer, r.value])).toEqual([
      ["length", "A-101", "Duct run", "Fire", "2540 mm"],
      ["arrow", "A-101", "Arrow", "", ""],
      ["line", "Page 2", "Line", "", ""],
      ["length", "Page 2", "Length", "", "Scale not set"],
    ]);
    expect(rows[0].color).toBe("#00ff00");
    expect(rows[0].date).toMatch(/^2026-11-/);
  });

  it("page ids of the document only", () => {
    expect(pageIndexOf("doc:1", "doc", 2)).toBe(1);
    expect(pageIndexOf("doc:2", "doc", 2)).toBeNull();
    expect(pageIndexOf("docx:1", "doc", 2)).toBeNull();
    expect(pageIndexOf("doc:x", "doc", 2)).toBeNull();
  });

  it("windows thousands of rows to the visible ones plus overscan", () => {
    expect(visibleRange(0, 280, 28, 5000)).toEqual({ start: 0, end: 18 });
    expect(visibleRange(28 * 1000, 280, 28, 5000)).toEqual({ start: 992, end: 1018 });
    expect(visibleRange(28 * 4995, 280, 28, 5000)).toEqual({ start: 4987, end: 5000 });
  });
});
