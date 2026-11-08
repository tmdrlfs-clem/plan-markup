import { describe, expect, it } from "vitest";

import { NZS4541_V1, type Hazard } from "../rules/rules";
import { inputOf, samples } from "../testing/zone-fixtures";

import { placeSite, type EngineZone } from "./site";

// Story 9.5 AC: the oracle reports zero errors on every feasible fixture, and output is identical
// across runs. The placer and the oracle meet only here.

const all = samples();
const feasible = all.filter((s) => !s.error).flatMap((s) => s.hazards.map((h) => [`${s.id} ${h}`, s, h] as const));
const errorsOf = (r: ReturnType<typeof placeSite>[number]) => r.report?.flags.filter((f) => f.severity === "error").map((f) => f.code) ?? ["NO_REPORT"];

describe("engine: placer output checked by the independent oracle", () => {
  it.each(feasible)("%s: zero oracle errors, keep-outs included", { timeout: 60_000 }, (_, s, hazard) => {
    const zones: EngineZone[] = s.zones.map((f) => ({ ...inputOf(f.zone), hazard }));
    const site = placeSite(zones, NZS4541_V1);
    for (const z of site) {
      expect(z.result.ok, z.zoneId).toBe(true);
      expect(errorsOf(z), z.zoneId).toEqual([]);
      expect(z.report?.coverage).toBe(1);
      expect(z.report?.ruleSet).toEqual({ id: "nzs4541", version: "1", verified: true });
    }
  });

  it("is identical across runs (multi-zone site)", () => {
    const s = all.find((x) => x.zones.length > 1)!;
    const zones: EngineZone[] = s.zones.map((f) => ({ ...inputOf(f.zone), hazard: s.hazards[0] }));
    expect(JSON.stringify(placeSite(zones, NZS4541_V1))).toBe(JSON.stringify(placeSite(zones, NZS4541_V1)));
  });

  it("returns NO_ADMISSIBLE_REGION for Z10 and no report", () => {
    const z10 = all.find((x) => x.id === "Z10")!;
    const [r] = placeSite([{ ...inputOf(z10.zones[0].zone), hazard: "ELH" }], NZS4541_V1);
    expect(r.result.ok).toBe(false);
    expect(!r.result.ok && r.result.error.code).toBe("NO_ADMISSIBLE_REGION");
    expect(r.report).toBeNull();
  });
});

// Seeded convex zones (design §5.4): a fixed LCG, so every run sees the same shapes.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function convexZone(seed: number): EngineZone {
  const rnd = lcg(seed);
  const n = 4 + Math.floor(rnd() * 6);
  const rx = 3_000 + rnd() * 7_000;
  const ry = 2_500 + rnd() * 5_000;
  const rot = rnd() * Math.PI;
  const angles = Array.from({ length: n }, () => rnd() * 2 * Math.PI).sort((a, b) => a - b);
  const ring = angles.map((a) => {
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return { x: 50_000 + x * Math.cos(rot) - y * Math.sin(rot), y: 20_000 + x * Math.sin(rot) + y * Math.cos(rot) };
  });
  return { zoneId: `C${seed}`, hazard: (seed % 2 ? "ELH" : "OH1") as Hazard, barriers: [{ kind: "wall", ring }] };
}

describe("engine: seeded convex zones (single bay)", () => {
  const seeds = Array.from({ length: 16 }, (_, i) => 101 + i * 7);
  it.each(seeds)("seed %i: placed with zero oracle errors", { timeout: 30_000 }, (seed) => {
    const z = convexZone(seed);
    const [r] = placeSite([z], NZS4541_V1);
    if (!r.result.ok && r.result.error.code === "INVALID_ZONE") return; // degenerate draw (sliver)
    expect(r.result.ok).toBe(true);
    expect(errorsOf(r)).toEqual([]);
    expect(r.result.ok && r.result.notes.decomposition).toBe("none");
  });
});
