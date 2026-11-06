import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import { EMPTY_VIEW, NO_DEVICE, NO_LAYER, applyListView, countText, filterOptions, isFiltered, markupListRows, nextSort, pageIndexOf, visibleRange, type ListPage } from "./markup-list";

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

describe("sort, filter and search (Story 6.8)", () => {
  const LAYER2 = "00000000-0000-7000-8000-00000000bbbb";
  const list = [
    markup("line", "doc:1", { subject: "Duct run", layerId: LAYER }),
    markup("length", "doc:0", { points: [{ x: 0, y: 0 }, { x: 144, y: 0 }] }),
    markup("arrow", "doc:0", { layerId: LAYER2, style: { ...DEFAULT_MARKUP_STYLE, color: "#0000FF" } }),
    markup("length", "doc:0"),
    markup("line", "doc:1", { subject: "Pipe" }),
  ];
  const rows = markupListRows(list, "doc", pages, [
    { id: LAYER, name: "Fire" },
    { id: LAYER2, name: "Annotations" },
  ]);
  const subjects = (v: Parameters<typeof applyListView>[1]) => applyListView(rows, v).map((r) => r.subject);

  it("sorts by a column, ascending then descending then none (stable)", () => {
    expect(subjects(EMPTY_VIEW)).toEqual(["Length", "Arrow", "Length", "Duct run", "Pipe"]);
    expect(subjects({ ...EMPTY_VIEW, sort: { key: "subject", dir: "asc" } })).toEqual(["Arrow", "Duct run", "Length", "Length", "Pipe"]);
    expect(subjects({ ...EMPTY_VIEW, sort: { key: "page", dir: "desc" } })).toEqual(["Duct run", "Pipe", "Length", "Arrow", "Length"]);
    // By value: numbers in order, rows without one last either way.
    const byValue = applyListView(rows, { ...EMPTY_VIEW, sort: { key: "value", dir: "desc" } });
    expect(byValue.map((r) => r.value)).toEqual(["5080 mm", "2540 mm", "", "", ""]);
    expect(nextSort(null, "date")).toEqual({ key: "date", dir: "asc" });
    expect(nextSort({ key: "date", dir: "asc" }, "date")).toEqual({ key: "date", dir: "desc" });
    expect(nextSort({ key: "date", dir: "desc" }, "date")).toBeNull();
    expect(nextSort({ key: "date", dir: "desc" }, "type")).toEqual({ key: "type", dir: "asc" });
  });

  it("column filters keep any of a column's values; across columns, all", () => {
    expect(filterOptions(rows, "type")).toEqual(["Arrow", "Length", "Line"]);
    expect(filterOptions(rows, "page")).toEqual(["A-101", "Page 2"]);
    expect(filterOptions(rows, "layer")).toEqual(["Annotations", "Fire", NO_LAYER]);
    expect(filterOptions(rows, "color")).toEqual(["#0000ff", "#00ff00"]);
    expect(subjects({ ...EMPTY_VIEW, filters: { type: ["Line", "Arrow"] } })).toEqual(["Arrow", "Duct run", "Pipe"]);
    expect(subjects({ ...EMPTY_VIEW, filters: { type: ["Line", "Arrow"], layer: [NO_LAYER] } })).toEqual(["Pipe"]);
    expect(subjects({ ...EMPTY_VIEW, filters: { type: [] } })).toHaveLength(5);
  });

  it("the quick filter needs every word somewhere in the row, any case", () => {
    expect(subjects({ ...EMPTY_VIEW, quick: "duct" })).toEqual(["Duct run"]);
    expect(subjects({ ...EMPTY_VIEW, quick: "LINE fire" })).toEqual(["Duct run"]);
    expect(subjects({ ...EMPTY_VIEW, quick: "5080" })).toEqual(["Length"]);
    expect(subjects({ ...EMPTY_VIEW, quick: "  " })).toHaveLength(5);
  });

  it("counts: Showing n of m while filtered", () => {
    expect(countText(24, 312, true)).toBe("Showing 24 of 312");
    expect(countText(312, 312, false)).toBe("312 markups");
    expect(countText(1, 1, false)).toBe("1 markup");
    expect(isFiltered({ ...EMPTY_VIEW, quick: " " })).toBe(false);
    expect(isFiltered({ ...EMPTY_VIEW, filters: { page: ["A-101"] } })).toBe(true);
  });

  it("Story 7.3: a placed device's type is a column, a filter and a sort", () => {
    const base = { pageId: `${"d".repeat(64)}:0`, createdAt: "2026-11-07T00:00:00.000Z", style: { color: "#ff0000", width: 1, fontSize: 10 }, type: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    const ms = [
      { ...base, id: "00000000-0000-7000-8000-000000000101", device: { group: "Sprinklers", label: "Pendant" } },
      { ...base, id: "00000000-0000-7000-8000-000000000102" },
      { ...base, id: "00000000-0000-7000-8000-000000000103", device: { group: "Alarms", label: "Bell" } },
    ] as never[];
    const rows = markupListRows(ms, "d".repeat(64), [{ label: "Page 1", calibration: null, userUnit: 1 }], []);
    expect(rows.map((r) => r.device)).toEqual(["Sprinklers · Pendant", "", "Alarms · Bell"]);
    expect(filterOptions(rows, "device")).toEqual(["Alarms · Bell", NO_DEVICE, "Sprinklers · Pendant"]);
    expect(applyListView(rows, { ...EMPTY_VIEW, filters: { device: ["Sprinklers · Pendant"] } })).toHaveLength(1);
    expect(applyListView(rows, { ...EMPTY_VIEW, sort: { key: "device", dir: "asc" } }).map((r) => r.device)).toEqual(["", "Alarms · Bell", "Sprinklers · Pendant"]);
    expect(applyListView(rows, { ...EMPTY_VIEW, quick: "pendant" })).toHaveLength(1);
  });
});
