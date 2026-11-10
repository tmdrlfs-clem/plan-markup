import { describe, expect, it } from "vitest";

import { factorForRatio } from "@/core/calibration/calibration";
import { markupSchema, type ZoneMarkup } from "@/core/schema/markup";

import { translateMarkup } from "@/core/markup/geometry";

import { HEAD_DEVICE, HEAD_DIAMETER_MM, engineZoneOf, headCentre, headMarkup, headsOfZone, isHead, pageScaleOf, refineHeadEdits, toMm, toPage, zoneAt, zoneOptions, type HeadMarkup } from "./heads";
import { newZone } from "./zone";

const k100 = factorForRatio(100);
const CAL = { xFactor: k100, yFactor: k100 };
const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function zone(holes: { x: number; y: number }[][] = []): ZoneMarkup {
  return newZone({ id: "00000000-0000-7000-8000-00000000000a", pageId: "doc:0", createdAt: "2026-11-12T00:00:00.000Z", outer: ring(100, 100, 200, 150), holes }, [], CAL);
}

describe("heads (Story 9.8)", () => {
  it("converts page points to mm and back, UserUnit applied", () => {
    const s = pageScaleOf(CAL, 2);
    expect(s.x).toBeCloseTo(2 * k100);
    const p = { x: 123.4, y: 56.7 };
    const back = toPage(toMm(p, s), s);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(pageScaleOf(CAL, 0).x).toBeCloseTo(k100);
  });

  it("gives the engine the zone in mm with its hole kinds, options and locked heads", () => {
    // A 10 × 10 pt hole at 1:100 is 0.12 m² (a column); 60 × 40 pt is 3 m² (a shaft).
    const z = { ...zone([ring(120, 120, 10, 10), ring(200, 150, 60, 40)]) };
    const withOpts: ZoneMarkup = { ...z, zone: { ...z.zone, options: { pattern: "staggered", spacing: 3600, wallDist: -5 } } };
    const locked = headMarkup({ x: 5000, y: 5000, kind: "manual" }, withOpts, pageScaleOf(CAL), "00000000-0000-7000-8000-0000000000aa", "t");
    const ez = engineZoneOf(withOpts, "OH1", CAL, 1, [locked]);
    expect(ez.hazard).toBe("OH1");
    expect(ez.barriers.map((b) => b.kind)).toEqual(["wall", "column", "shaft"]);
    expect(ez.barriers[0].ring[0].x).toBeCloseTo(100 * k100);
    expect(ez.pattern).toBe("staggered");
    expect(ez.prefs).toEqual({ spacing: 3600 });
    expect(ez.locked).toHaveLength(1);
    expect(ez.locked![0].x).toBeCloseTo(5000, 6);
    expect(zoneOptions(zone())).toEqual({});
  });

  it("makes a valid ellipse device markup of a fixed real size, linked to its zone", () => {
    const z = zone();
    const s = pageScaleOf(CAL);
    const h = headMarkup({ x: 7000, y: 4000, kind: "row" }, z, s, "00000000-0000-7000-8000-0000000000bb", "2026-11-12T00:00:00.000Z");
    expect(markupSchema.safeParse(h).success).toBe(true);
    expect(isHead(h)).toBe(true);
    expect(isHead(z)).toBe(false);
    expect(h.device).toEqual(HEAD_DEVICE);
    expect(h.head).toEqual({ zoneId: z.id, kind: "row" });
    expect((h.points[1].x - h.points[0].x) * s.x).toBeCloseTo(HEAD_DIAMETER_MM);
    const c = toMm(headCentre(h), s);
    expect(c.x).toBeCloseTo(7000);
    expect(c.y).toBeCloseTo(4000);
    expect(headsOfZone([z, h], z.id)).toEqual([h]);
    expect(headsOfZone([z, h], "other")).toEqual([]);
  });
});

describe("hand edits (Story 9.10)", () => {
  const a = zone([ring(150, 150, 20, 20)]);
  const b = { ...newZone({ id: "00000000-0000-7000-8000-00000000000b", pageId: "doc:0", createdAt: "2026-11-12T00:00:00.000Z", outer: ring(300, 100, 150, 150), holes: [] }, [], CAL) };
  const s = pageScaleOf(CAL);
  const at = (x: number, y: number, kind: HeadMarkup["head"]["kind"] = "row", id = "00000000-0000-7000-9000-000000000001") =>
    headMarkup({ ...toMm({ x, y }, s), kind }, a, s, id, "2026-11-12T00:00:00.000Z");
  const doc = [a, b];

  it("finds the zone under a point, holes excluded", () => {
    expect(zoneAt({ x: 120, y: 120 }, [a, b])?.id).toBe(a.id);
    expect(zoneAt({ x: 160, y: 160 }, [a, b])).toBeNull(); // in a's hole
    expect(zoneAt({ x: 400, y: 200 }, [a, b])?.id).toBe(b.id);
    expect(zoneAt({ x: 50, y: 50 }, [a, b])).toBeNull();
  });

  it("a moved head becomes manual and joins the zone it is dropped in", () => {
    const h = at(200, 200);
    const inA = translateMarkup(h, { x: 10, y: 0 });
    const toB = translateMarkup(h, { x: 200, y: 0 });
    const out = translateMarkup(h, { x: 0, y: 500 });
    const op = refineHeadEdits({ kind: "markups.update", documentId: "doc", before: [h, h, h], after: [inA, toB, out] }, doc);
    expect(op.kind === "markups.update" && op.after.map((m) => (m as HeadMarkup).head)).toEqual([
      { zoneId: a.id, kind: "manual" },
      { zoneId: b.id, kind: "manual" },
      { zoneId: a.id, kind: "manual" }, // outside every zone: keeps its zone (the check flags it)
    ]);
    // undo restores the engine's head as it was
    expect(op.kind === "markups.update" && op.before).toEqual([h, h, h]);
  });

  it("leaves a style change, a locked head's kind and other markups alone", () => {
    const h = at(200, 200);
    const recolour = { kind: "markups.update" as const, documentId: "doc", before: [h], after: [{ ...h, style: { ...h.style, color: "#000000" } }] };
    expect(refineHeadEdits(recolour, doc)).toBe(recolour);
    const locked = at(200, 200, "locked");
    const op = refineHeadEdits({ kind: "markups.update", documentId: "doc", before: [locked], after: [translateMarkup(locked, { x: 5, y: 0 })] }, doc);
    expect(op.kind === "markups.update" && (op.after[0] as HeadMarkup).head.kind).toBe("locked");
    const zoneMove = { kind: "markups.update" as const, documentId: "doc", before: [a], after: [translateMarkup(a, { x: 5, y: 0 })] };
    expect(refineHeadEdits(zoneMove, doc)).toBe(zoneMove);
  });

  it("a pasted or copied head is manual; a restore (undo of a delete) is put back as it was", () => {
    const h = at(200, 200);
    const paste = refineHeadEdits({ kind: "markups.add", documentId: "doc", markups: [translateMarkup(h, { x: 200, y: 0 })] }, doc);
    expect(paste.kind === "markups.add" && (paste.markups[0] as HeadMarkup).head).toEqual({ zoneId: b.id, kind: "manual" });
    const restore = { kind: "markups.add" as const, documentId: "doc", markups: [h], at: [2] };
    expect(refineHeadEdits(restore, doc)).toBe(restore);
    const compound = refineHeadEdits({ kind: "compound", documentId: "doc", ops: [{ kind: "markups.add", documentId: "doc", markups: [h] }] }, doc);
    expect(compound.kind === "compound" && compound.ops[0].kind === "markups.add" && (compound.ops[0].markups[0] as HeadMarkup).head.kind).toBe("manual");
  });
});
