// Story 9.13 (M2 review): checks of the oracle's own machinery, beyond its rule checks.
//   1. The verdict does not depend on where the zone sits on the page. The head index and the
//      wall index work on absolute cells, so the same room moved must give the same report.
//   2. The wall index finds exactly the crossings a plain loop over every wall finds.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { NZS4541_V1, type Hazard } from "../rules/rules";

import { checkZone, type OracleHead, type OracleReport, type OracleZone, type Pt } from "./index";
import { EdgeBuckets, crosses, type Edge } from "./kernel";

const ZONES = path.join(__dirname, "..", "..", "..", "..", "fixtures", "zones");
type Pair = [number, number];
type FixtureZone = { outer: Pair[]; holes?: { kind: "column" | "shaft"; ring: Pair[] }[]; openEdges?: [Pair, Pair][] };
type Layout = { sample: string; hazard: Hazard; zones: { slug: string; heads: OracleHead[] }[] };

const fixtures = new Map<string, FixtureZone>(
  readdirSync(ZONES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const d = JSON.parse(readFileSync(path.join(ZONES, f), "utf8")) as { slug: string; zone: FixtureZone };
      return [d.slug, d.zone];
    }),
);
const layouts: Layout[] = readdirSync(path.join(ZONES, "layouts"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(ZONES, "layouts", f), "utf8")) as Layout);

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function moved(z: FixtureZone, dx: number, dy: number): OracleZone {
  const ring = (r: Pair[]): Pt[] => r.map(([x, y]) => ({ x: x + dx, y: y + dy }));
  return {
    barriers: [{ kind: "wall", ring: ring(z.outer) }, ...(z.holes ?? []).map((h) => ({ kind: h.kind, ring: ring(h.ring) }))],
    openEdges: (z.openEdges ?? []).map(([a, b]) => ({ a: { x: a[0] + dx, y: a[1] + dy }, b: { x: b[0] + dx, y: b[1] + dy } })),
  };
}

/** What a report says, without the positions (which move with the zone); distances to a micrometre. */
const verdict = (r: OracleReport) => ({
  pass: r.pass,
  coverage: r.coverage,
  samples: r.samples,
  flags: r.flags.map((f) => `${f.code}:${f.headIds.join("+")}:${f.value === undefined ? "" : f.value.toFixed(3)}`),
  maxLocal: r.maxLocalAreaM2,
  worstWall: Number.isFinite(r.worstWallDistM) ? Number(r.worstWallDistM.toFixed(6)) : r.worstWallDistM,
});

describe("oracle audit (Story 9.13): the verdict does not depend on the zone's position", () => {
  it("a head 0.7 mm past Rc, inside the 1 mm tolerance, covers the sample wherever the room sits", () => {
    // OH1: Rc = 2500 mm. The lattice starts 37 mm from the room's left wall, so its first sample is
    // 2500.7 mm from the head. With the head index read as "the sample's cell ± 1" the sample at
    // x = 2499.5 (cell 0) missed the head at x = 5000.2 (cell 2); moved by 700 mm it was found.
    const at = (dx: number) => checkZone({ barriers: [{ kind: "wall", ring: rect(2462.5 + dx, 0, 5100 + dx, 200) }] }, [{ id: "a", x: 5000.2 + dx, y: 61 }], NZS4541_V1.hazards.OH1);
    const reports = [0, 700, 1300, -2462.5, 1e6].map(at);
    for (const r of reports) expect(verdict(r)).toEqual(verdict(reports[0]));
    expect(Math.round(reports[0].coverage * reports[0].samples.lattice)).toBe(53);
  });

  // Whole millimetres keep the room's own lattice the same; what changes is where every head
  // and wall falls in the absolute cells of the two indexes.
  it.each(layouts.map((l) => [`${l.sample} ${l.hazard}`, l] as const))("%s: the same report after a move", (_name, l) => {
    for (const z of l.zones) {
      const zone = fixtures.get(z.slug)!;
      const base = verdict(checkZone(moved(zone, 0, 0), z.heads, NZS4541_V1.hazards[l.hazard]));
      for (const [dx, dy] of [
        [1237, -4411],
        [-250_003, 99_991],
      ]) {
        const heads = z.heads.map((h) => ({ id: h.id, x: h.x + dx, y: h.y + dy }));
        expect(verdict(checkZone(moved(zone, dx, dy), heads, NZS4541_V1.hazards[l.hazard])), `${z.slug} moved ${dx}, ${dy}`).toEqual(base);
      }
    }
  });
});

describe("oracle audit (Story 9.13): the wall index agrees with a plain loop", () => {
  it("clearSight is the same as testing every wall, on every fixture, for 400 seeded sight lines each", () => {
    let state = 20261113;
    const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    let blocked = 0;
    let total = 0;
    for (const [slug, z] of fixtures) {
      const rings = [z.outer, ...(z.holes ?? []).map((h) => h.ring)];
      const edges: Edge[] = rings.flatMap((r) =>
        r.map(([ax, ay], i) => {
          const [bx, by] = r[(i + 1) % r.length];
          return { ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay), inx: 0, iny: 0, open: false, column: false };
        }),
      );
      const buckets = new EdgeBuckets(edges, 1000);
      const xs = z.outer.map((p) => p[0]);
      const ys = z.outer.map((p) => p[1]);
      const pick = () => ({ x: Math.min(...xs) - 500 + random() * (Math.max(...xs) - Math.min(...xs) + 1000), y: Math.min(...ys) - 500 + random() * (Math.max(...ys) - Math.min(...ys) + 1000) });
      for (let i = 0; i < 400; i++) {
        const p = pick();
        const q = pick();
        const plain = !edges.some((e) => crosses(p.x, p.y, q.x, q.y, e));
        expect(buckets.clearSight(p.x, p.y, q.x, q.y), `${slug} ${JSON.stringify([p, q])}`).toBe(plain);
        total++;
        if (!plain) blocked++;
      }
    }
    // The sight lines are a real mix of blocked and clear.
    expect(blocked).toBeGreaterThan(total / 10);
    expect(total - blocked).toBeGreaterThan(total / 10);
  });
});
