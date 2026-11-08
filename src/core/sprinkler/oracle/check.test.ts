import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HAZARDS, NZS4541_V1, type Hazard } from "../rules/rules";

import { checkZone, type FlagCode, type OracleHead, type OracleZone, type Pt } from "./index";

// The zone fixtures (fixtures/zones, format plan-markup.zone-fixture/1) and the reference layouts
// (fixtures/zones/layouts, from scripts/fixtures/make-zone-layouts.mjs). The layouts are data: the
// oracle never imports what made them.
const ZONES = path.join(__dirname, "..", "..", "..", "..", "fixtures", "zones");

type Pair = [number, number];
type FixtureZone = {
  zoneId: string;
  hazard: Hazard;
  outer: Pair[];
  holes?: { kind: "column" | "shaft"; ring: Pair[] }[];
  openEdges?: [Pair, Pair][];
  keepOuts?: ({ kind: string; ring: Pair[] } | { kind: string; circle: { x: number; y: number; r: number } })[];
};
type Fixture = { slug: string; sample: { id: string }; zone: FixtureZone; expected: Record<string, { lowerBound?: number }> & { error?: string } };
type Layout = { sample: string; hazard: Hazard; zones: { slug: string; zoneId: string; heads: OracleHead[] }[] };

const pts = (ring: Pair[]): Pt[] => ring.map(([x, y]) => ({ x, y }));
const fixtures = new Map<string, Fixture>(
  readdirSync(ZONES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const d = JSON.parse(readFileSync(path.join(ZONES, f), "utf8")) as Fixture;
      return [d.slug, d];
    }),
);
const layouts: Layout[] = readdirSync(path.join(ZONES, "layouts"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(ZONES, "layouts", f), "utf8")) as Layout);

function zoneOf(z: FixtureZone, holeKind?: "column" | "shaft"): OracleZone {
  return {
    barriers: [{ kind: "wall", ring: pts(z.outer) }, ...(z.holes ?? []).map((h) => ({ kind: holeKind ?? h.kind, ring: pts(h.ring) }))],
    openEdges: (z.openEdges ?? []).map(([a, b]) => ({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } })),
    keepOuts: (z.keepOuts ?? []).map((k) => ("ring" in k ? { ring: pts(k.ring) } : { circle: k.circle })),
  };
}
const fig = (h: Hazard) => NZS4541_V1.hazards[h];
const layoutOf = (sample: string, hazard: Hazard) => layouts.find((l) => l.sample === sample && l.hazard === hazard)!;
const single = (sample: string, hazard: Hazard) => {
  const l = layoutOf(sample, hazard);
  return { zone: fixtures.get(l.zones[0].slug)!.zone, heads: l.zones[0].heads };
};
const codes = (r: ReturnType<typeof checkZone>, severity: "error" | "warning" = "error"): FlagCode[] => [
  ...new Set(r.flags.filter((f) => f.severity === severity).map((f) => f.code)),
];

describe("oracle: reference layouts (Story 9.4, NFR9)", () => {
  it("has a layout for every feasible fixture and each of its hazards", () => {
    expect(layouts.length).toBeGreaterThanOrEqual(29);
    for (const id of ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7", "Z8", "R1", "R2"]) expect(layouts.some((l) => l.sample === id)).toBe(true);
  });

  it.each(layouts.map((l) => [`${l.sample} ${l.hazard}`, l] as const))("%s: zero errors, area and lower bound agree", (_, l) => {
    for (const z of l.zones) {
      const fx = fixtures.get(z.slug)!;
      const neighbours = l.zones.filter((o) => o !== z).map((o) => ({ zone: zoneOf(fixtures.get(o.slug)!.zone), heads: o.heads }));
      const r = checkZone(zoneOf(fx.zone), z.heads, fig(l.hazard), { neighbours, ruleSet: NZS4541_V1 });
      // Keep-outs included: the spike placer ignored them, but none of its heads landed in one.
      expect(codes(r)).toEqual([]);
      expect(r.coverage).toBe(1);
      const lb = fx.expected[l.hazard]?.lowerBound;
      if (lb !== undefined && l.zones.length === 1) expect(Math.ceil(r.areaM2 / fig(l.hazard).Amax - 1e-9)).toBe(lb);
    }
  });

  it("is deterministic", () => {
    const { zone, heads } = single("Z2", "ELH");
    expect(JSON.stringify(checkZone(zoneOf(zone), heads, fig("ELH")))).toBe(JSON.stringify(checkZone(zoneOf(zone), heads, fig("ELH"))));
  });
});

describe("oracle: analytic goldens", () => {
  const rect: OracleZone = {
    barriers: [
      {
        kind: "wall",
        ring: [
          { x: 0, y: 0 },
          { x: 10000, y: 0 },
          { x: 10000, y: 6000 },
          { x: 0, y: 6000 },
        ],
      },
    ],
  };
  // Design §5 Z1 OH1: x ∈ {1667, 5000, 8333} × y ∈ {1500, 4500}.
  const grid = [1667, 5000, 8333].flatMap((x, i) => [1500, 4500].map((y, j) => ({ id: `h${i}${j}`, x, y })));

  it("passes the textbook Z1 OH1 grid with its figures", () => {
    const r = checkZone(rect, grid, fig("OH1"), { ruleSet: NZS4541_V1 });
    expect(r.pass).toBe(true);
    expect(r.flags).toEqual([]);
    expect(r.figures.Rc).toBeCloseTo(2500, 6);
    expect(r.areaM2).toBe(60);
    expect(r.areaPerHeadM2).toBe(10);
    expect(r.minSpacingM).toBeCloseTo(3, 6);
    expect(r.maxNNSpacingM).toBeCloseTo(3, 6);
    expect(r.worstWallDistM).toBeCloseTo(1.667, 3);
    expect(r.minWallDistM).toBeCloseTo(1.5, 6);
  });

  it("flags the corner left uncovered when its head is removed, sized within 5 % of a fine integration", () => {
    const rest = grid.slice(1);
    const r = checkZone(rect, rest, fig("OH1"));
    const gaps = r.flags.filter((f) => f.code === "UNCOVERED");
    expect(gaps).toHaveLength(1);
    expect(gaps[0].where!.x).toBeLessThan(2500);
    expect(gaps[0].where!.y).toBeLessThan(2500);
    // The same gap integrated on a 20 mm grid (no walls in the way in a rectangle).
    let n = 0;
    for (let x = 10; x < 10000; x += 20) for (let y = 10; y < 6000; y += 20) if (rest.every((h) => Math.hypot(h.x - x, h.y - y) > 2500)) n++;
    const exact = (n * 400) / 1e6;
    expect(exact).toBeGreaterThan(1);
    expect(Math.abs(gaps[0].value! - exact) / exact).toBeLessThan(0.05);
    expect(codes(r)).toContain("WALL_DIST");
  });

  it("an unverified rule set and an empty zone are flagged", () => {
    expect(codes(checkZone(rect, grid, fig("OH1"), { ruleSet: { ...NZS4541_V1, verified: false } }), "warning")).toEqual(["RULES_UNVERIFIED"]);
    expect(codes(checkZone(rect, [], fig("OH1")))).toContain("NO_HEADS");
    expect(() => checkZone({ barriers: [] }, grid, fig("OH1"))).toThrow(/one wall barrier/);
  });
});

describe("oracle: mutations of the NFR9 zones are all caught (design §4.3)", () => {
  const cases = (["Z1", "Z2", "Z3", "Z4", "Z5"] as const).flatMap((s) => (["ELH", "OH1"] as const).filter((h) => layouts.some((l) => l.sample === s && l.hazard === h)).map((h) => [`${s} ${h}`, s, h] as const));
  const COVERAGE: FlagCode[] = ["UNCOVERED", "WALL_DIST", "MAX_SPACING"];

  it.each(cases)("%s", (_, sample, hazard) => {
    const { zone: fz, heads } = single(sample, hazard);
    const zone = zoneOf(fz);
    const f = fig(hazard);
    expect(checkZone(zone, heads, f).pass).toBe(true);
    const corner = heads.reduce((a, h) => (h.x + h.y < a.x + a.y ? h : a));
    const without = (h: OracleHead) => heads.filter((x) => x !== h);
    const replaced = (h: OracleHead, at: Partial<OracleHead>) => heads.map((x) => (x === h ? { ...x, ...at } : x));

    // (i) a missing head: removing any one head breaks coverage somewhere.
    for (const h of heads) expect(codes(checkZone(zone, without(h), f)).some((c) => COVERAGE.includes(c))).toBe(true);
    // (ii) a moved head: the corner head 0.6 m further into the room (1.2 m for ELH, whose
    // larger reach lets the reference Z1 layout absorb 0.6 m: it has more heads than ELH needs).
    const step = hazard === "ELH" ? 1200 : 600;
    expect(codes(checkZone(zone, replaced(corner, { x: corner.x + step, y: corner.y + step }), f)).some((c) => COVERAGE.includes(c))).toBe(true);
    // (iii) a duplicate 1.5 m away (under Smin).
    expect(codes(checkZone(zone, [...heads, { id: "dup", x: corner.x + 1500, y: corner.y }], f))).toContain("MIN_SPACING");
    // (iv) a head near a wall: 30 mm from the bottom wall (y = 0 in every NFR9 zone).
    expect(codes(checkZone(zone, replaced(corner, { y: 30 }), f))).toContain("WALL_CLEARANCE");
    // (v) too few heads: fewer than area / Amax.
    const lowerBound = Math.ceil(checkZone(zone, heads, f).areaM2 / f.Amax - 1e-9);
    const r = checkZone(zone, heads.slice(0, Math.max(1, lowerBound - 1)), f);
    expect(codes(r, "warning")).toContain("AREA_ZONE");
    expect(r.pass).toBe(false);
    // A head outside the zone.
    expect(codes(checkZone(zone, [...heads, { id: "out", x: -500, y: -500 }], f))).toContain("OUTSIDE");
  });
});

describe("oracle: columns, shafts, shadows, open edges, keep-outs", () => {
  const distToRing = (p: Pt, ring: Pair[]) =>
    Math.min(
      ...ring.map((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const vx = b[0] - a[0];
        const vy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p.x - a[0]) * vx + (p.y - a[1]) * vy) / (vx * vx + vy * vy)));
        return Math.hypot(p.x - a[0] - t * vx, p.y - a[1] - t * vy);
      }),
    );
  const wallDistOnHoles = (fz: FixtureZone, zone: OracleZone, heads: OracleHead[]) =>
    checkZone(zone, heads, fig(fz.hazard)).flags.filter((f) => f.code === "WALL_DIST" && (fz.holes ?? []).some((h) => distToRing(f.where!, h.ring) < 60)).length;

  it("Z6: Wmax does not apply to column faces; the same holes as shafts are flagged (founder decision 4)", () => {
    const { zone: z6, heads } = single("Z6", "OH1");
    const thinned = heads.filter((h) => !(h.x > 4400 && h.x < 7000));
    expect(wallDistOnHoles(z6, zoneOf(z6), thinned)).toBe(0);
    expect(wallDistOnHoles(z6, zoneOf(z6, "shaft"), thinned)).toBeGreaterThan(0);
  });

  it("Z6: a head 30 mm from a column face needs clearance (Wmin applies to columns)", () => {
    const { zone: z6, heads } = single("Z6", "OH1");
    const col = z6.holes![0].ring;
    const near = heads.map((h, i) => (i === 0 ? { ...h, x: Math.max(...col.map((p) => p[0])) + 30, y: 4500 } : h));
    expect(codes(checkZone(zoneOf(z6), near, fig("OH1")))).toContain("WALL_CLEARANCE");
  });

  it("Z7: a shaft keeps Wmax on its faces; tagged as a column it does not", () => {
    const { zone: z7, heads } = single("Z7", "OH1");
    const sh = z7.holes![0].ring;
    const sx = (Math.min(...sh.map((p) => p[0])) + Math.max(...sh.map((p) => p[0]))) / 2;
    const sy = (Math.min(...sh.map((p) => p[1])) + Math.max(...sh.map((p) => p[1]))) / 2;
    const pushed = heads.map((h) => {
      if (distToRing(h, sh) > 2500) return h;
      const dx = h.x - sx;
      const dy = h.y - sy;
      const L = Math.hypot(dx, dy) || 1;
      return { ...h, x: h.x + (600 * dx) / L, y: h.y + (600 * dy) / L };
    });
    expect(wallDistOnHoles(z7, zoneOf(z7), pushed)).toBeGreaterThan(0);
    expect(wallDistOnHoles(z7, zoneOf(z7, "column"), pushed)).toBe(0);
  });

  it("a column casts a spray shadow: the point behind it is uncovered, and covered without the column", () => {
    const room: Pt[] = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const column: Pt[] = [
      { x: 2000, y: 1200 },
      { x: 2600, y: 1200 },
      { x: 2600, y: 1800 },
      { x: 2000, y: 1800 },
    ];
    const head = [{ id: "a", x: 1800, y: 1500 }];
    const withColumn = checkZone({ barriers: [{ kind: "wall", ring: room }, { kind: "column", ring: column }] }, head, fig("ELH"));
    const shadow = withColumn.flags.filter((f) => f.code === "UNCOVERED");
    expect(shadow.length).toBeGreaterThan(0);
    expect(shadow.some((f) => f.where!.x > 2600)).toBe(true);
    expect(codes(checkZone({ barriers: [{ kind: "wall", ring: room }] }, head, fig("ELH")))).not.toContain("UNCOVERED");
  });

  it("zones touching without a wall are checked across the shared edge (founder decision 6)", () => {
    const left: OracleZone = {
      barriers: [
        {
          kind: "wall",
          ring: [
            { x: 0, y: 0 },
            { x: 4000, y: 0 },
            { x: 4000, y: 3000 },
            { x: 0, y: 3000 },
          ],
        },
      ],
      openEdges: [{ a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } }],
    };
    const right: OracleZone = {
      barriers: [
        {
          kind: "wall",
          ring: [
            { x: 4000, y: 0 },
            { x: 8000, y: 0 },
            { x: 8000, y: 3000 },
            { x: 4000, y: 3000 },
          ],
        },
      ],
      openEdges: [{ a: { x: 4000, y: 0 }, b: { x: 4000, y: 3000 } }],
    };
    const mine = [{ id: "l", x: 3200, y: 1500 }];
    const theirs = [{ id: "r", x: 4600, y: 1500 }];
    const r = checkZone(left, mine, fig("ELH"), { neighbours: [{ zone: right, heads: theirs }] });
    expect(r.flags.find((f) => f.code === "MIN_SPACING")?.headIds).toEqual(["l", "r"]);
    // No Wmax on the open edge: one head 3.2 m from it would fail a real wall there.
    expect(r.flags.filter((f) => f.code === "WALL_DIST").every((f) => f.where!.x < 4000)).toBe(true);
    const walled = checkZone({ barriers: left.barriers }, mine, fig("ELH"), { neighbours: [{ zone: right, heads: theirs }] });
    expect(codes(walled)).not.toContain("MIN_SPACING");
  });

  it("flags a head in a keep-out or its clearance", () => {
    const { zone: r2 } = single("R2", "ELH");
    const zone = zoneOf(r2);
    expect(codes(checkZone(zone, [{ id: "a", x: 1800, y: 1800 }], fig("ELH")))).toContain("IN_KEEPOUT");
    expect(codes(checkZone(zone, [{ id: "a", x: 2200, y: 1800 }], fig("ELH")))).not.toContain("IN_KEEPOUT");
    const ring = { barriers: zone.barriers, keepOuts: [{ ring: [{ x: 1000, y: 1000 }, { x: 1600, y: 1000 }, { x: 1600, y: 1600 }, { x: 1000, y: 1600 }], clearance: 200 }] };
    expect(codes(checkZone(ring, [{ id: "a", x: 1700, y: 1300 }], fig("ELH")))).toContain("IN_KEEPOUT");
    expect(codes(checkZone(ring, [{ id: "a", x: 1900, y: 1300 }], fig("ELH")))).not.toContain("IN_KEEPOUT");
  });

  it("covers every hazard's figures", () => {
    for (const h of HAZARDS) expect(checkZone(zoneOf(single("Z1", "OH1").zone), single("Z1", "OH1").heads, fig(h)).figures.Smin).toBe(1800);
  });
});
