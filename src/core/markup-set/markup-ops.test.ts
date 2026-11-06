import { describe, expect, it } from "vitest";

import { uuidv7 } from "@/core/ids/uuid";
import type { Markup } from "@/core/schema/markup";

import { diffMarkups, joinMarkup, markupOpSchema, orderKeys, savedMarkup, splitMarkup, stableJson, type SavedMarkup } from "./markup-ops";

const style = { color: "#ff0000", width: 1, fontSize: 10 };
const line = (id: string, x = 0): Markup => ({ id, type: "line", pageId: "abc:0", createdAt: "2026-11-07T00:00:00.000Z", style, points: [{ x, y: 0 }, { x: x + 1, y: 1 }] });
const ids = Array.from({ length: 6 }, (_, i) => uuidv7(1_000 + i));
const PAGE = "a1000000-0000-4000-8000-000000000003";

function saved(list: readonly Markup[]): Map<string, SavedMarkup> {
  return new Map(list.map((m, i) => [m.id, savedMarkup(m, i)]));
}

describe("splitMarkup / joinMarkup", () => {
  it("splits into geometry, style and props and joins back", () => {
    const area: Markup = { id: ids[0], type: "area", pageId: "abc:1", createdAt: "x", style, subject: "Room", captionOffset: { x: 1, y: 2 }, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], holes: [] };
    const row = splitMarkup(area);
    expect(row.geometry).toEqual({ points: area.points, holes: [], captionOffset: { x: 1, y: 2 } });
    expect(row.props).toEqual({ createdAt: "x", subject: "Room" });
    expect(row.style).toBe(style);
    expect(joinMarkup(row)).toEqual(area);
  });

  it("joins nothing from an invalid row", () => {
    expect(joinMarkup({ ...splitMarkup(line(ids[0])), geometry: { points: [] } })).toBeNull();
    expect(joinMarkup({ ...splitMarkup(line(ids[0])), props: null })).toBeNull();
  });
});

describe("markupOpSchema", () => {
  const create = { opId: ids[1], markupId: ids[0], kind: "create", type: "line", pageId: PAGE, baseVersion: 0, clientTs: 1, fields: { ...(({ geometry, style: s, props }) => ({ geometry, style: s, props }))(splitMarkup(line(ids[0]))), z: 0 } };

  it("accepts a create with every field", () => {
    expect(markupOpSchema.safeParse(create).success).toBe(true);
  });

  it("refuses a create without a field or a page, an empty update and a delete with fields", () => {
    expect(markupOpSchema.safeParse({ ...create, fields: { ...create.fields, z: undefined } }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, pageId: undefined }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: {} }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "delete" }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "delete", fields: undefined }).success).toBe(true);
  });

  it("validates each field against its type's part schema (NFR24)", () => {
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: { geometry: { points: [{ x: 0, y: 0 }] } } }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: { props: { text: "not a line's" } } }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: { style: { ...style, color: "red" } } }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: { props: { createdAt: "x", subject: "Pipe" } } }).success).toBe(true);
    expect(markupOpSchema.safeParse({ ...create, type: "teapot" }).success).toBe(false);
  });

  it("refuses protected fields", () => {
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: { version: 9 } }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, authorId: ids[2] }).success).toBe(false);
    expect(markupOpSchema.safeParse({ ...create, kind: "update", fields: { props: { id: ids[3] } } }).success).toBe(false);
  });
});

describe("orderKeys", () => {
  it("numbers a new list", () => {
    expect(orderKeys([undefined, undefined, undefined])).toEqual([0, 1, 2]);
  });

  it("keeps the keys still in order and fits the moved ones between neighbours", () => {
    // [a b c d] -> [d a b c]: only d moves.
    expect(orderKeys([3, 0, 1, 2])).toEqual([-1, 0, 1, 2]);
    // insert between 0 and 1
    expect(orderKeys([0, undefined, 1])).toEqual([0, 0.5, 1]);
    // added on top
    expect(orderKeys([0, 1, undefined])).toEqual([0, 1, 2]);
  });

  it("renumbers when doubles run out", () => {
    expect(orderKeys([1, undefined, 1 + Number.EPSILON])).toEqual([0, 1, 2]);
  });
});

describe("diffMarkups", () => {
  it("creates new markups with every field", () => {
    const { changes, next } = diffMarkups(new Map(), [line(ids[0])]);
    expect(changes).toEqual([{ kind: "create", row: splitMarkup(line(ids[0])), z: 0 }]);
    expect(next.get(ids[0])?.z).toBe(0);
  });

  it("sends nothing for the same objects and only changed fields otherwise", () => {
    const list = [line(ids[0]), line(ids[1])];
    expect(diffMarkups(saved(list), list).changes).toEqual([]);
    const moved = { ...list[1], points: [{ x: 9, y: 9 }, { x: 10, y: 10 }] } as Markup;
    expect(diffMarkups(saved(list), [list[0], moved]).changes).toEqual([{ kind: "update", id: ids[1], type: "line", fields: { geometry: { points: moved.points } } }]);
    // A copy with equal values (another key order) is unchanged.
    const copy = JSON.parse(stableJson(list[0])) as Markup;
    expect(diffMarkups(saved(list), [copy, list[1]]).changes).toEqual([]);
  });

  it("deletes markups no longer there", () => {
    const list = [line(ids[0]), line(ids[1])];
    expect(diffMarkups(saved(list), [list[0]]).changes).toEqual([{ kind: "delete", id: ids[1], type: "line" }]);
  });

  it("sends only the moved markup's z on a reorder", () => {
    const list = [line(ids[0]), line(ids[1]), line(ids[2])];
    const { changes } = diffMarkups(saved(list), [list[2], list[0], list[1]]);
    expect(changes).toEqual([{ kind: "update", id: ids[2], type: "line", fields: { z: -1 } }]);
  });
});
