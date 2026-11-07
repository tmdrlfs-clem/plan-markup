import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, markupSchema, type Markup } from "@/core/schema/markup";

import { fieldsOf, sharedFields, withChange } from "./properties";
import {
  DEFAULT_LEGEND_STYLE,
  estimateText,
  fitSymbol,
  legendLabel,
  legendLayout,
  legendMarkupAt,
  legendRows,
  legendScopeMarkups,
  legendTotal,
} from "./legend";

let n = 0;
const id = () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;
function line(pageId: string, createdAt: string, device?: { group: string; label: string }, groupId?: string): Markup {
  return {
    id: id(),
    pageId,
    createdAt,
    style: DEFAULT_MARKUP_STYLE,
    type: "line",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    ...(device ? { device } : {}),
    ...(groupId ? { groupId } : {}),
  } as Markup;
}
const PENDANT = { group: "Sprinklers", label: "Pendant" };
const BELL = { group: "Alarms", label: "Bell" };
const upright = (p: { x: number; y: number }) => ({ x: p.x, y: -p.y });
const META = { title: "LEGEND", scope: "page" as const };

describe("auto legend (Story 7.8, FR38)", () => {
  it("one row per device type, in group then label order, with its count; other markups are not counted", () => {
    const markups = [line("p:0", "2026-11-02"), line("p:0", "2026-11-02", PENDANT), line("p:0", "2026-11-01", PENDANT), line("p:0", "2026-11-03", BELL)];
    const rows = legendRows(markups);
    expect(rows.map((r) => [r.text, r.count])).toEqual([
      ["Bell", 1],
      ["Pendant", 2],
    ]);
    expect(legendTotal(rows)).toBe(3);
    // The symbol is the type's first placement.
    expect(rows[1].symbol).toEqual([markups[2]]);
    expect(legendRows([])).toEqual([]);
  });

  it("a symbol is its placement's whole group; a label two groups share says its group", () => {
    const g = "00000000-0000-7000-8000-00000000aaaa";
    const head = { ...line("p:0", "2026-11-01", PENDANT, g), id: g };
    const part = line("p:0", "2026-11-01", undefined, g);
    const other = line("p:0", "2026-11-02", { group: "Heads", label: "Pendant" });
    const rows = legendRows([head, part, other, line("p:0", "2026-11-01")]);
    expect(rows.map((r) => r.text)).toEqual(["Heads · Pendant", "Sprinklers · Pendant"]);
    expect(rows[1].symbol).toEqual([head, part]);
  });

  it("counts this page's placements, or the whole document's", () => {
    const markups = [line("p:0", "a", PENDANT), line("p:1", "a", PENDANT), line("p:1", "a", BELL)];
    expect(legendTotal(legendRows(legendScopeMarkups(markups, "page", "p:0")))).toBe(1);
    expect(legendTotal(legendRows(legendScopeMarkups(markups, "document", "p:0")))).toBe(3);
  });

  it("lays out a title row, a row per type (one saying none when empty) and a total row", () => {
    const empty = legendLayout([], "LEGEND", estimateText);
    expect(empty.rowsY).toHaveLength(1);
    expect(empty.totalY).toBeNull();
    const rows = legendRows([line("p:0", "a", PENDANT), line("p:0", "a", BELL)]);
    const two = legendLayout(rows, "LEGEND", estimateText);
    expect(two.rowsY).toEqual([two.header, two.header + two.row]);
    expect(two.totalY).toBe(two.header + 2 * two.row);
    expect(two.height).toBe(two.totalY! + two.header);
    expect(two.countX).toBe(two.width - two.pad);
    // A longer label widens it.
    const long = legendLayout(legendRows([line("p:0", "a", { group: "S", label: "Pendant sprinkler, quick response, 68 °C" })]), "LEGEND", estimateText);
    expect(long.width).toBeGreaterThan(two.width);
  });

  it("placed: centred on the click, upright, at its natural size over the page's UserUnit, a valid markup", () => {
    const rows = legendRows([line("p:0", "a", PENDANT)]);
    const m = legendMarkupAt(META, rows, { x: 100, y: 100 }, "p:0", upright, 1, id(), "2026-11-07T00:00:00Z");
    expect(markupSchema.safeParse(m).success).toBe(true);
    expect(m.style).toEqual(DEFAULT_LEGEND_STYLE);
    const { width, height } = legendLayout(rows, "LEGEND", estimateText);
    expect(m.points[0]).toEqual({ x: 100 - width / 2, y: 100 + height / 2 });
    expect(m.points[2]).toEqual({ x: 100 + width / 2, y: 100 - height / 2 });
    const big = legendMarkupAt(META, rows, { x: 0, y: 0 }, "p:0", upright, 2, id(), m.createdAt);
    expect(big.points[1].x - big.points[0].x).toBe(width / 2);
    expect(legendLabel(META, 1)).toBe("LEGEND — 1 device");
    expect(legendLabel(META, 3)).toBe("LEGEND — 3 devices");
  });

  it("Properties: title and scope for one legend; a change keeps a valid legend only", () => {
    const m = legendMarkupAt(META, [], { x: 0, y: 0 }, "p:0", upright, 1, id(), "2026-11-07T00:00:00Z");
    expect([...fieldsOf(m)]).toEqual(expect.arrayContaining(["subject", "legend", "color", "fill", "width", "opacity"]));
    expect(fieldsOf(m).has("fontSize")).toBe(false);
    expect(sharedFields([m, { ...m, id: id() }])).not.toContain("legend");
    expect(withChange(m, { legend: { title: "DEVICES", scope: "document" } })).toMatchObject({ legend: { title: "DEVICES", scope: "document" } });
    expect(withChange(m, { legend: { title: "  " } })).toBe(m);
    expect(withChange(m, { legend: { scope: "page" } })).toBe(m);
  });

  it("fits a symbol's points, centred, in its square", () => {
    const fit = fitSymbol(
      [
        { x: 10, y: 10 },
        { x: 30, y: 20 },
      ],
      { x: 0, y: 0 },
      10,
    )!;
    expect(fit.scale).toBe(0.5);
    expect(fit.map({ x: 20, y: 15 })).toEqual({ x: 0, y: 0 });
    expect(fit.map({ x: 30, y: 20 })).toEqual({ x: 5, y: 2.5 });
    expect(fitSymbol([], { x: 0, y: 0 }, 10)).toBeNull();
    expect(fitSymbol([{ x: 3, y: 3 }], { x: 0, y: 0 }, 10)!.scale).toBe(1);
  });
});
