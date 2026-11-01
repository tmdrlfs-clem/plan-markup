import { describe, expect, it } from "vitest";

import { applyMarkupsOp, invertOp, reorderMarkupsOp } from "@/core/commands/ops";
import { DEFAULT_MEASURE_STYLE, type Markup } from "@/core/schema/markup";

import { alignOffsets, stepOrder, unitsOf, withGroups, withPageOrder } from "./arrange";
import { copiesOf } from "./transform";

const G = "00000000-0000-7000-8000-0000000000aa";
const markup = (n: number, pageId = "doc:0", extra: Partial<Markup> = {}) =>
  ({
    id: `00000000-0000-7000-8000-00000000000${n}`,
    pageId,
    createdAt: "2026-11-02T00:00:00.000Z",
    style: DEFAULT_MEASURE_STYLE,
    type: "count",
    points: [{ x: n, y: n }],
    ...extra,
  }) as Markup;

describe("arrange (Story 5.3)", () => {
  it("adds the other members of the selected markups' groups; units are groups or single markups", () => {
    const list = [markup(1, "doc:0", { groupId: G }), markup(2), markup(3, "doc:0", { groupId: G })];
    expect(withGroups(list, [list[0].id])).toEqual([list[0].id, list[2].id]);
    expect(withGroups(list, [list[1].id])).toEqual([list[1].id]);
    expect(unitsOf(list).map((u) => u.map((m) => m.id))).toEqual([[list[0].id, list[2].id], [list[1].id]]);
  });

  it("steps the order: front / back keep the selection's own order; forward / backward pass one", () => {
    const order = ["a", "b", "c", "d"];
    expect(stepOrder(order, new Set(["a", "c"]), "front")).toEqual(["b", "d", "a", "c"]);
    expect(stepOrder(order, new Set(["b", "d"]), "back")).toEqual(["b", "d", "a", "c"]);
    expect(stepOrder(order, new Set(["a", "c"]), "forward")).toEqual(["b", "a", "d", "c"]);
    expect(stepOrder(order, new Set(["b", "d"]), "backward")).toEqual(["b", "a", "d", "c"]);
    // Already on top: no change.
    expect(stepOrder(order, new Set(["c", "d"]), "forward")).toEqual(order);
  });

  it("puts a page's order back in its slots; the reorder op moves only what changed and inverts", () => {
    const list = [markup(1), markup(2, "doc:1"), markup(3), markup(4)];
    const order = withPageOrder(list, "doc:0", [list[3].id, list[0].id, list[2].id]);
    expect(order).toEqual([list[3].id, list[1].id, list[0].id, list[2].id]);
    const op = reorderMarkupsOp("doc", list, order)!;
    expect(op).toMatchObject({ kind: "markups.reorder", ids: [list[3].id, list[0].id, list[2].id], from: [3, 0, 2], to: [0, 2, 3] });
    const after = applyMarkupsOp(list, op);
    expect(after.map((m) => m.id)).toEqual(order);
    expect(applyMarkupsOp(after, invertOp(op))).toEqual(list);
    expect(reorderMarkupsOp("doc", list, list.map((m) => m.id))).toBeNull();
  });

  it("aligns boxes with their joint box (y down); fixed boxes stay", () => {
    const boxes = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 30, y: 20, width: 20, height: 20 },
    ];
    expect(alignOffsets(boxes, "left")).toEqual([{ x: 0, y: 0 }, { x: -30, y: 0 }]);
    expect(alignOffsets(boxes, "right")).toEqual([{ x: 40, y: 0 }, { x: 0, y: 0 }]);
    expect(alignOffsets(boxes, "centre")).toEqual([{ x: 20, y: 0 }, { x: -15, y: 0 }]);
    expect(alignOffsets(boxes, "top")).toEqual([{ x: 0, y: 0 }, { x: 0, y: -20 }]);
    expect(alignOffsets(boxes, "middle")).toEqual([{ x: 0, y: 15 }, { x: 0, y: -10 }]);
    expect(alignOffsets(boxes, "bottom", [false, true])).toEqual([{ x: 0, y: 30 }, { x: 0, y: 0 }]);
  });

  it("copies are unlocked and a copied group is a new group (D5)", () => {
    const list = [markup(1, "doc:0", { groupId: G, locked: true }), markup(2, "doc:0", { groupId: G }), markup(3)];
    let i = 0;
    const ids = ["10000000-0000-7000-8000-000000000001", "10000000-0000-7000-8000-000000000002", "10000000-0000-7000-8000-000000000003"];
    const copies = copiesOf(list, { x: 0, y: 0 }, "doc:0", () => ids[i++], "t");
    expect(copies.map((m) => m.groupId)).toEqual([ids[0], ids[0], undefined]);
    expect(copies.some((m) => "locked" in m)).toBe(false);
    expect("groupId" in copies[2]).toBe(false);
  });
});
