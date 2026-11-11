// Head lines (guides): the designer draws where a row of heads goes, and optionally lines across
// the rows; the placer keeps those rows and prefers the crossings (founder feedback 2026-11-12).
import { describe, expect, it } from "vitest";
import { NZS4541_V1 } from "../rules/rules";
import { placeZone } from "../placer";
import { placeSite, type EngineZone } from "./site";

const rect = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const H = (y: number, x0: number, x1: number) => ({ a: { x: x0, y }, b: { x: x1, y } });
const V = (x: number, y0: number, y1: number) => ({ a: { x, y: y0 }, b: { x, y: y1 } });
const zone = (w: number, h: number, guides: EngineZone["guides"], more: Partial<EngineZone> = {}): EngineZone => ({
  zoneId: "z",
  hazard: "ELH",
  barriers: [{ kind: "wall", ring: rect(w, h) }],
  guides,
  ...more,
});
const run = (z: EngineZone) => placeSite([z], NZS4541_V1)[0];
const ys = (o: ReturnType<typeof run>) => [...new Set(o.result.heads.map((h) => Math.round(h.y)))].sort((a, b) => a - b);

describe("head lines (guides)", () => {
  it("keeps the rows on the lines along the rows, with no more heads than without lines", () => {
    const free = run(zone(9678, 6711, undefined));
    const o = run(zone(9678, 6711, [H(1028, 500, 9100), H(5457, 500, 9100)]));
    expect(o.result.ok).toBe(true);
    expect(o.report?.pass).toBe(true);
    expect(ys(o)).toEqual([1028, 5457]);
    expect(o.result.heads.length).toBe(free.result.heads.length);
    expect(o.result.notes?.guides).toEqual({ rows: 2, cross: 0, ignored: 0 });
  });

  it("puts heads where lines across the rows meet them", () => {
    const xs = [2226, 4928, 7388];
    const o = run(zone(9678, 6711, [H(1028, 500, 9100), H(5457, 500, 9100), ...xs.map((x) => V(x, 300, 6400))]));
    expect(o.report?.pass).toBe(true);
    expect(o.result.heads.length).toBe(6);
    const onCross = o.result.heads.filter((h) => xs.some((x) => Math.abs(h.x - x) < 1)).length;
    // One crossing sits at the limit of the placer's sampling margin, so it may move along its row.
    expect(onCross).toBeGreaterThanOrEqual(5);
    expect(o.result.notes?.guides).toEqual({ rows: 2, cross: 3, ignored: 0 });
  });

  it("a corridor: one line and crossings give the designer's positions", () => {
    const at = [1515, 4271, 8739, 13129];
    const o = run(zone(4070, 15140, [V(2300, 500, 14600), ...at.map((y) => H(y, 1500, 3100))]));
    expect(o.report?.pass).toBe(true);
    expect(o.result.notes?.frameDeg).toBe(90);
    expect(o.result.heads.map((h) => Math.round(h.x))).toEqual([2300, 2300, 2300, 2300]);
    o.result.heads.forEach((h, i) => expect(Math.abs(h.y - at[i])).toBeLessThanOrEqual(1));
  });

  it("a line drawn a little past the maximum spacing is moved back, not given an extra row", () => {
    const o = run(zone(9678, 6810, [H(1061, 500, 9100), H(1061 + 4601, 500, 9100)]));
    expect(o.report?.pass).toBe(true);
    expect(ys(o)).toEqual([1061, 5661]);
  });

  it("adds rows between a line and a far wall", () => {
    const o = run(zone(9000, 12000, [H(2000, 500, 8500)]));
    expect(o.report?.pass).toBe(true);
    expect(ys(o)[0]).toBe(2000);
    expect(ys(o).length).toBeGreaterThanOrEqual(3);
  });

  it("the longest line sets the row direction, and a line at another angle is reported", () => {
    const o = run(zone(9000, 9000, [V(3000, 500, 8500), { a: { x: 1000, y: 1000 }, b: { x: 4000, y: 3000 } }]));
    expect(o.report?.pass).toBe(true);
    expect(o.result.notes?.frameDeg).toBe(90);
    expect(o.result.notes?.guides).toEqual({ rows: 1, cross: 0, ignored: 1 });
    expect(o.result.notes?.preferences.unmet.join(" ")).toContain("1 head line(s) were not used");
    expect(o.result.heads.some((h) => Math.abs(h.x - 3000) < 1)).toBe(true);
  });

  it("a line too close to a wall is left out and the zone is still laid out", () => {
    const o = run(zone(6000, 6000, [H(50, 500, 5500)]));
    expect(o.result.ok).toBe(true);
    expect(o.report?.pass).toBe(true);
  });

  it("no lines: the layout is the same as before", () => {
    const a = run(zone(9678, 6711, undefined));
    const b = run(zone(9678, 6711, []));
    expect(b.result.heads).toEqual(a.result.heads);
    expect(a.result.notes?.guides).toBeUndefined();
  });
});

describe("aligned rows (the default)", () => {
  // A long room with a short partition stub on one wall: the fewest-heads layout cuts the room in
  // two bays and leaves their heads out of step; a person keeps two straight columns.
  const ring = [
    { x: 0, y: 0 },
    { x: 7159, y: 0 },
    { x: 7159, y: 14633 },
    { x: 2739, y: 14633 },
    { x: 2739, y: 14733 },
    { x: 7159, y: 14733 },
    { x: 7159, y: 22534 },
    { x: 0, y: 22534 },
  ];
  const z: EngineZone = { zoneId: "z", hazard: "ELH", barriers: [{ kind: "wall", ring }] };
  const distinct = (vs: number[]) => new Set(vs.map((v) => Math.round(v / 100))).size;

  it("takes one more head to keep the rows in line across the room, and says so", () => {
    const o = run(z);
    expect(o.report?.pass).toBe(true);
    expect(o.result.notes?.aligned).toEqual({ extraHeads: 1 });
    expect(o.result.heads.length).toBe(12);
    expect(distinct(o.result.heads.map((h) => h.x))).toBe(2);
    expect(distinct(o.result.heads.map((h) => h.y))).toBe(6);
  });

  it("alignRows: false gives the fewest heads", () => {
    const r = placeZone(z, NZS4541_V1.hazards.ELH, { alignRows: false });
    expect(r.ok).toBe(true);
    expect(r.heads.length).toBe(11);
    expect(r.notes?.aligned).toBeUndefined();
  });

  it("rows of unequal count (5-4-4-5) become a regular grid", () => {
    const room: EngineZone = { zoneId: "z", hazard: "OH1", barriers: [{ kind: "wall", ring: rect(14000, 14000) }] };
    const o = run(room);
    expect(o.report?.pass).toBe(true);
    expect(o.result.heads.length).toBe(20);
    expect(distinct(o.result.heads.map((h) => h.x)) + distinct(o.result.heads.map((h) => h.y))).toBe(9);
    expect(o.result.notes?.aligned).toEqual({ extraHeads: 2 });
    const fewest = placeZone(room, NZS4541_V1.hazards.OH1, { alignRows: false });
    expect(fewest.heads.length).toBe(18);
  });

  it("a plain room is not changed (nothing to align)", () => {
    const o = run(zone(9678, 6711, undefined));
    expect(o.result.notes?.aligned).toBeUndefined();
    expect(o.result.heads.length).toBe(6);
  });
});
