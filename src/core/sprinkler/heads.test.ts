import { describe, expect, it } from "vitest";

import { factorForRatio } from "@/core/calibration/calibration";
import { markupSchema, type ZoneMarkup } from "@/core/schema/markup";

import { HEAD_DEVICE, HEAD_DIAMETER_MM, engineZoneOf, headCentre, headMarkup, headsOfZone, isHead, pageScaleOf, toMm, toPage, zoneOptions } from "./heads";
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
