import { describe, expect, it } from "vitest";

import { placeZone, type PlacedHead } from "../placer";
import { NZS4541_V1 } from "../rules/rules";
import { inputOf, samples } from "../testing/zone-fixtures";
import { GEN_SHAPES, irregularZone, officeFloor } from "../testing/zone-generators";

import { checkPlacement, placeSite, type EngineZone, type ZoneOutcome } from "./site";

// Story 9.6 AC: irregular zones (L, U, T, splayed, columns, shafts, rotated) placed with zero
// oracle errors; spacing kept across bay seams and shared open edges; NFR6 timings; the op budget.

const errorsOf = (r: ZoneOutcome) => r.report?.flags.filter((f) => f.severity === "error").map((f) => f.code) ?? ["NO_REPORT"];
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
/** Deterministic work ceiling for a zone <= 200 m² (about 1 s on the reference laptop). */
const OPS_CEILING = 15_000_000;

/** Closest pair of heads, mm (the oracle checks Smin with sight lines; this is the plain distance). */
function closestPair(heads: readonly PlacedHead[]): number {
  let best = Infinity;
  for (let i = 0; i < heads.length; i++)
    for (let k = i + 1; k < heads.length; k++) best = Math.min(best, Math.hypot(heads[i].x - heads[k].x, heads[i].y - heads[k].y));
  return best;
}

describe("engine: seeded irregular zones (design §5.4)", () => {
  it("draws every shape at least 10 times", () => {
    for (const shape of GEN_SHAPES) expect(SEEDS.filter((s) => irregularZone(s).shape === shape).length).toBeGreaterThanOrEqual(10);
  });

  // each zone is placed once; the seam and timing checks below read these records
  const placed = new Map<number, { area: number; ops: number; bays: number; closest: number; shape: string; smin: number }>();

  it.each(SEEDS)("seed %i: zero oracle errors, full coverage", { timeout: 30_000 }, (seed) => {
    const z = irregularZone(seed);
    const [r] = placeSite([z], NZS4541_V1);
    expect(r.result.ok, `${z.zoneId} ${z.shape}`).toBe(true);
    expect(errorsOf(r), `${z.zoneId} ${z.shape}`).toEqual([]);
    expect(r.report?.coverage).toBe(1);
    expect(r.result.ok && r.result.notes.searchTruncated).toBe(false);
    const bays = r.result.ok ? r.result.notes.bays : 0;
    const ops = r.result.ok ? r.result.notes.ops : Infinity;
    placed.set(seed, { area: z.area, ops, bays, closest: closestPair(r.result.heads), shape: z.shape, smin: NZS4541_V1.hazards[z.hazard].Smin * 1000 });
  });

  it("keeps Smin across bay seams where a zone was cut into bays", () => {
    // columns and shafts are left out: heads either side of one may be closer than Smin unseen
    const cut = [...placed.values()].filter((p) => p.bays > 1 && p.shape !== "columns" && p.shape !== "shaft");
    expect(cut.length).toBeGreaterThanOrEqual(10);
    for (const p of cut) expect(p.closest).toBeGreaterThanOrEqual(p.smin - 1);
  });

  // NFR6: 1 s per zone <= 200 m² on reference hardware. Wall-clock times are noisy under the
  // parallel suite, so every zone is held to a deterministic op ceiling, and the heaviest one is
  // timed alone (best of two) against 2x headroom (design §6 perf CI).
  it("keeps every zone <= 200 m² under the op ceiling, and the heaviest places in time", { timeout: 30_000 }, () => {
    const small = [...placed.entries()].filter(([, p]) => p.area <= 200e6);
    expect(small.length).toBeGreaterThanOrEqual(50);
    for (const [seed, p] of small) expect(p.ops, `G${seed}`).toBeLessThan(OPS_CEILING);
    const [heaviest] = small.sort((a, b) => b[1].ops - a[1].ops)[0];
    const z = irregularZone(heaviest);
    let best = Infinity;
    for (let i = 0; i < 2; i++) {
      const t = performance.now();
      placeZone(z, NZS4541_V1.hazards[z.hazard]);
      best = Math.min(best, performance.now() - t);
    }
    expect(best).toBeLessThan(2_000);
  });

  it("is deterministic (same heads twice, rotated zone with a shaft)", () => {
    const z = irregularZone(5, "shaft");
    expect(JSON.stringify(placeSite([z], NZS4541_V1))).toBe(JSON.stringify(placeSite([z], NZS4541_V1)));
  });
});

describe("engine: targeted irregular shapes", () => {
  const fixture = (id: string) => samples().find((s) => s.id === id)!;

  it.each(["Z2", "U", "T", "Z5L", "Z7"])("%s is cut at its reflex corners and passes the oracle", { timeout: 30_000 }, (id) => {
    const s = fixture(id);
    const zones: EngineZone[] = s.zones.map((f) => ({ ...inputOf(f.zone), hazard: s.hazards[0] }));
    const site = placeSite(zones, NZS4541_V1);
    for (const r of site) expect(errorsOf(r)).toEqual([]);
    // every one of these has a reflex corner, so a cut decomposition was at least considered
    const r = placeZone(zones[0], NZS4541_V1.hazards[s.hazards[0]]);
    expect(r.ok && r.notes.variantsTried).toBeGreaterThan(2);
  });

  it("columns need Wmin but carry no Wmax: a column 3 m from every head is fine", () => {
    // 12 x 9 m ELH room, one 400 mm column in the middle: no head is forced next to it
    const room = { x0: 0, y0: 0, x1: 12_000, y1: 9_000 };
    const ring = [
      { x: room.x0, y: room.y0 },
      { x: room.x1, y: room.y0 },
      { x: room.x1, y: room.y1 },
      { x: room.x0, y: room.y1 },
    ];
    const col = [
      { x: 5_800, y: 4_300 },
      { x: 6_200, y: 4_300 },
      { x: 6_200, y: 4_700 },
      { x: 5_800, y: 4_700 },
    ];
    const z: EngineZone = { zoneId: "COL1", hazard: "ELH", barriers: [{ kind: "wall", ring }, { kind: "column", ring: col }] };
    const [r] = placeSite([z], NZS4541_V1);
    expect(errorsOf(r)).toEqual([]);
    for (const h of r.result.heads) {
      const dx = Math.max(col[0].x - h.x, 0, h.x - col[1].x);
      const dy = Math.max(col[0].y - h.y, 0, h.y - col[2].y);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(50); // Wmin
    }
  });

  it("a shaft is a wall: heads keep Wmin from it and serve its faces", () => {
    const z = irregularZone(11, "shaft");
    const [r] = placeSite([z], NZS4541_V1);
    expect(errorsOf(r)).toEqual([]);
    expect(r.report?.coverage).toBe(1);
  });
});

describe("engine: a 600 m² floor of 15 zones (NFR6)", () => {
  const floor = officeFloor();

  it("is 15 zones and 600 m²", () => {
    expect(floor.length).toBe(15);
    expect(Math.round(floor.reduce((s, z) => s + z.area, 0) / 1e6)).toBe(600);
  });

  it("places in under 5 s with zero oracle errors, spacing kept across the open corridor seam", { timeout: 30_000 }, () => {
    const t = performance.now();
    const site = placeSite(floor, NZS4541_V1);
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(5_000);
    for (const r of site) {
      expect(r.result.ok, r.zoneId).toBe(true);
      expect(errorsOf(r), r.zoneId).toEqual([]);
    }
    // the two corridor halves share an open edge: their heads keep Smin across it
    const corridor = site.filter((r) => r.zoneId.startsWith("C")).flatMap((r) => r.result.heads);
    expect(closestPair(corridor)).toBeGreaterThanOrEqual(1_800 - 1);
  });
});

describe("placer: the op budget (design §6)", () => {
  it("stops at the budget after the first complete layout, deterministically, and the oracle still passes", { timeout: 60_000 }, () => {
    const z = irregularZone(39); // the heaviest seeded zone (rotated, cut into bays)
    const fig = NZS4541_V1.hazards[z.hazard];
    const a = placeZone(z, fig, { opBudget: 100_000 });
    const b = placeZone(z, fig, { opBudget: 100_000 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ok).toBe(true);
    expect(a.ok && a.notes.searchTruncated).toBe(true);
    expect(a.ok && a.notes.variantsTried).toBe(1);
    expect(checkPlacement(z, a.heads, [], NZS4541_V1).flags.filter((f) => f.severity === "error")).toEqual([]);
    const full = placeZone(z, fig);
    expect(full.ok && full.notes.searchTruncated).toBe(false);
    expect(full.ok && full.notes.variantsTried).toBeGreaterThan(1);
  });
});
