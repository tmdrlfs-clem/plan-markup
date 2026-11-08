import { describe, expect, it } from "vitest";

import { NZS4541_V1, type Hazard } from "../rules/rules";
import { inputOf, readLayouts, samples } from "../testing/zone-fixtures";

import { placeZone, tileStopAt, type PlaceInput, type PlaceResult, type PlacedHead, type Pt } from "./index";

const fig = (h: Hazard) => NZS4541_V1.hazards[h];
const rect = (w: number, h: number, x0 = 0, y0 = 0): Pt[] => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];
const zone = (ring: Pt[], extra: Partial<PlaceInput> = {}): PlaceInput => ({ zoneId: "T", barriers: [{ kind: "wall", ring }], ...extra });

/** Places a sample's zones in order; earlier zones' heads are neighbours (as the engine does). */
function placeSample(zones: PlaceInput[], hazard: Hazard): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const z of zones) {
    const neighbourHeads = out.flatMap((r) => r.heads);
    out.push(placeZone({ ...z, neighbourHeads }, fig(hazard)));
  }
  return out;
}

const all = samples();
const feasible = all.filter((s) => !s.error).flatMap((s) => s.hazards.map((h) => [`${s.id} ${h}`, s, h] as const));
const layouts = readLayouts();

describe("placer: the spike's reference layouts (Story 9.5, faithful port)", () => {
  it("covers every feasible fixture and hazard", () => {
    expect(feasible.length).toBe(layouts.length);
  });

  // The spike ignored keep-outs (R1, R2 carry them), so the comparison strips them; the engine
  // tests check the keep-out layouts with the oracle. R1 takes about 4 s (multi-column floor, 9.6).
  it.each(feasible)("%s: same heads as the spike placer", { timeout: 60_000 }, (_, s, hazard) => {
    const results = placeSample(
      s.zones.map((f) => ({ ...inputOf(f.zone), keepOuts: [] })),
      hazard,
    );
    const ref = layouts.find((l) => l.sample === s.id && l.hazard === hazard)!;
    results.forEach((r, i) => {
      expect(r.ok).toBe(true);
      const want = ref.zones[i].heads;
      expect(r.heads.map((h) => h.id)).toEqual(want.map((h) => h.id));
      r.heads.forEach((h, k) => {
        expect(Math.abs(h.x - want[k].x)).toBeLessThan(0.06);
        expect(Math.abs(h.y - want[k].y)).toBeLessThan(0.06);
      });
    });
  });
});

describe("placer: determinism and invariance", () => {
  it("returns identical output across runs", () => {
    const s = all.find((x) => x.id === "Z6")!;
    const a = JSON.stringify(placeSample([inputOf(s.zones[0].zone)], "OH1"));
    const b = JSON.stringify(placeSample([inputOf(s.zones[0].zone)], "OH1"));
    expect(a).toBe(b);
  });

  it("gives the same count when the zone is translated far from the origin", () => {
    const base = placeZone(zone(rect(10_000, 6_000)), fig("OH1"));
    const moved = placeZone(zone(rect(10_000, 6_000, 1_234_567, 7_654_321)), fig("OH1"));
    expect(moved.heads.length).toBe(base.heads.length);
    expect(moved.heads[0].x - base.heads[0].x).toBeCloseTo(1_234_567, 3);
  });

  it("gives the same count for a rotated rectangle (frame search follows the walls)", () => {
    const base = placeZone(zone(rect(12_000, 7_000)), fig("OH1"));
    const a = (23 * Math.PI) / 180;
    const ring = rect(12_000, 7_000).map((p) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
    const turned = placeZone(zone(ring), fig("OH1"));
    expect(turned.ok).toBe(true);
    expect(turned.heads.length).toBe(base.heads.length);
    expect(turned.notes?.frameDeg).toBeCloseTo(23, 1);
  });

  it("does not depend on the outline's starting vertex or winding", () => {
    const r = rect(9_000, 5_000);
    const a = placeZone(zone(r), fig("ELH"));
    const b = placeZone(zone([r[2], r[1], r[0], r[3]]), fig("ELH"));
    expect(b.heads.map((h) => [h.x, h.y])).toEqual(a.heads.map((h) => [h.x, h.y]));
  });
});

describe("placer: the textbook rectangle (A8 objective)", () => {
  it("puts an even grid in a 10 × 6 m OH1 room: count first, then even spacing and wall distance", () => {
    const r = placeZone(zone(rect(10_000, 6_000)), fig("OH1"));
    expect(r.ok).toBe(true);
    // 60 m² / 12 m² → at least 5; the rectangular family needs 2 rows × 3 = 6 (S ≤ 4 m, Rc 2.5 m).
    expect(r.heads.length).toBe(6);
    const xs = [...new Set(r.heads.map((h) => Math.round(h.x)))].sort((a, b) => a - b);
    const ys = [...new Set(r.heads.map((h) => Math.round(h.y)))].sort((a, b) => a - b);
    expect(ys).toEqual([1500, 4500]);
    expect(xs.length).toBe(3);
    // even: gaps equal, half a gap at the walls
    const gap = xs[1] - xs[0];
    expect(xs[2] - xs[1]).toBe(gap);
    expect(Math.abs(xs[0] - gap / 2)).toBeLessThanOrEqual(50);
    expect(r.notes?.decomposition).toBe("none");
  });

  it("uses one row in a corridor", () => {
    const r = placeZone(zone(rect(20_000, 1_500)), fig("OH1"));
    expect(r.ok).toBe(true);
    expect(new Set(r.heads.map((h) => h.y)).size).toBe(1);
  });

  it("follows preferred spacing and wall distance without adding heads", () => {
    const plain = placeZone(zone(rect(12_000, 6_000)), fig("ELH"));
    const pref = placeZone(zone(rect(12_000, 6_000), { prefs: { spacing: 4_000, wallDist: 1_000 } }), fig("ELH"));
    expect(pref.heads.length).toBe(plain.heads.length);
    const wallDist = (h: Pt) => Math.min(h.x, 12_000 - h.x, h.y, 6_000 - h.y);
    expect(Math.min(...pref.heads.map(wallDist))).toBe(1_000);
    expect(Math.min(...plain.heads.map(wallDist))).not.toBe(1_000);
  });

  it("gives deterministic head ids zone:bay:row:k and a row id", () => {
    const r = placeZone(zone(rect(10_000, 6_000)), fig("OH1"), { idPrefix: "p-" });
    expect(r.heads[0].id).toMatch(/^p-T:0:0:0$/);
    expect(r.heads.every((h: PlacedHead) => h.kind === "row" && h.rowId === h.id.split(":").slice(1, 3).join(":"))).toBe(true);
  });
});

describe("placer: hard constraints (no repair pass)", () => {
  it("keeps every head Wmin from the walls and Smin from each other", () => {
    for (const hz of ["ELH", "OH1"] as const) {
      const r = placeZone(zone(rect(7_300, 4_100)), fig(hz));
      const f = fig(hz);
      for (const h of r.heads) {
        expect(Math.min(h.x, 7_300 - h.x, h.y, 4_100 - h.y)).toBeGreaterThanOrEqual(f.Wmin * 1000);
        for (const g of r.heads) if (g !== h) expect(Math.hypot(g.x - h.x, g.y - h.y)).toBeGreaterThanOrEqual(f.Smin * 1000 - 1);
      }
    }
  });

  it("keeps heads out of keep-outs and their clearance", () => {
    const free = placeZone(zone(rect(10_000, 6_000)), fig("OH1"));
    const h0 = free.heads[0];
    const r = placeZone(zone(rect(10_000, 6_000), { keepOuts: [{ circle: { x: h0.x, y: h0.y, r: 300 }, clearance: 200 }] }), fig("OH1"));
    expect(r.ok).toBe(true);
    for (const h of r.heads) expect(Math.hypot(h.x - h0.x, h.y - h0.y)).toBeGreaterThanOrEqual(500);
    const ring = placeZone(zone(rect(10_000, 6_000), { keepOuts: [{ ring: rect(1_200, 600, h0.x - 600, h0.y - 300) }] }), fig("OH1"));
    for (const h of ring.heads) expect(Math.abs(h.x - h0.x) <= 600 && Math.abs(h.y - h0.y) <= 300).toBe(false);
  });

  it("keeps locked heads as they are and builds around them", () => {
    const r = placeZone(zone(rect(10_000, 6_000), { locked: [{ id: "L1", x: 1_234, y: 1_111 }] }), fig("OH1"));
    expect(r.heads.find((h) => h.id === "L1")).toEqual({ id: "L1", x: 1_234, y: 1_111, kind: "locked" });
    for (const h of r.heads) if (h.id !== "L1") expect(Math.hypot(h.x - 1_234, h.y - 1_111)).toBeGreaterThanOrEqual(1_800 - 1);
  });

  it("puts tile-centre heads in a preferred ceiling grid when that costs nothing", () => {
    const grid = { angleDeg: 0, pitchX: 1_200, pitchY: 600, originX: 0, originY: 0, mode: "preferred" as const };
    const r = placeZone(zone(rect(9_600, 7_200), { grid }), fig("ELH"));
    expect(r.ok).toBe(true);
    expect(r.notes?.tileAligned?.onStop).toBe(r.heads.length);
    const s = tileStopAt(grid, 700, 400);
    expect(s).toEqual({ x: 600, y: 300 });
  });
});

describe("placer: typed, located errors", () => {
  it("returns NO_ADMISSIBLE_REGION for Z10 (6 m × 90 mm), located at the zone", () => {
    const z10 = all.find((s) => s.id === "Z10")!;
    const r = placeZone(inputOf(z10.zones[0].zone), fig("ELH"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NO_ADMISSIBLE_REGION");
    expect(r.error.where).toEqual([{ x: 3000, y: 45 }]);
    expect(r.error.message).toMatch(/2 × Wmin/);
    expect(r.heads).toEqual([]);
  });

  it("matches every fixture that expects an error", () => {
    for (const s of all.filter((x) => x.error)) {
      const r = placeZone(inputOf(s.zones[0].zone), fig(s.zones[0].zone.hazard));
      expect(r.ok ? null : r.error.code, s.id).toBe(s.error);
    }
  });

  it("returns INVALID_ZONE for a crossing outline, located at the crossing", () => {
    const bow = [
      { x: 0, y: 0 },
      { x: 4_000, y: 4_000 },
      { x: 4_000, y: 0 },
      { x: 0, y: 4_000 },
    ];
    const r = placeZone(zone(bow), fig("OH1"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INVALID_ZONE");
    expect(r.error.where[0].x).toBeCloseTo(2_000, 6);
    expect(r.error.where[0].y).toBeCloseTo(2_000, 6);
  });

  it("returns INVALID_ZONE for too few points, no outline, a hole outside or a non-finite point", () => {
    const bad: PlaceInput[] = [
      zone(rect(1, 1).slice(0, 2)),
      { zoneId: "T", barriers: [] },
      zone(rect(5_000, 5_000), { barriers: [{ kind: "wall", ring: rect(5_000, 5_000) }, { kind: "column", ring: rect(300, 300, 6_000, 6_000) }] }),
      zone([...rect(5_000, 5_000).slice(0, 3), { x: Number.NaN, y: 0 }]),
      zone(rect(50, 50)),
    ];
    for (const z of bad) {
      const r = placeZone(z, fig("OH1"));
      expect(r.ok ? null : r.error.code).toBe("INVALID_ZONE");
    }
  });
});

describe("placer: performance (NFR6)", () => {
  it("places a 200 m² zone well inside 1 s", () => {
    const t0 = performance.now();
    const r = placeZone(zone(rect(20_000, 10_000)), fig("OH1"));
    const ms = performance.now() - t0;
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(1_000);
  });
});
