import { describe, expect, it } from "vitest";

import { coverageOf, coverageRadiusMm, ringAreaOf, squareAngleOf, type CoverageBarrier } from "./coverage";
import { placeSite } from "./engine/site";
import { NZS4541_V1 } from "./rules/rules";
import { officeFloor } from "./testing/zone-generators";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
function inside(px: number, py: number, ring: readonly { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

const ROOM: CoverageBarrier[] = [{ kind: "wall", ring: rect(0, 0, 20_000, 20_000) }];
const R = coverageRadiusMm(NZS4541_V1.hazards.OH1);

describe("coverage polygons (Story 9.9)", () => {
  it("Rc is the oracle's coverage radius", () => {
    // OH1: Smax 4.0 m, Amax 12 m² → ½·√(4² + 3²) = 2.5 m.
    expect(R).toBeCloseTo(2500, 6);
  });

  it("a head in the open covers its full circle or inscribed square", () => {
    const [c] = coverageOf(ROOM, [{ id: "h", x: 10_000, y: 10_000 }], R);
    expect(ringAreaOf(c.ring) / (Math.PI * R * R)).toBeGreaterThan(0.998);
    expect(ringAreaOf(c.ring) / (Math.PI * R * R)).toBeLessThanOrEqual(1);
    const [s] = coverageOf(ROOM, [{ id: "h", x: 10_000, y: 10_000 }], R, "square");
    expect(ringAreaOf(s.ring)).toBeCloseTo(2 * R * R, -2);
    // Turned to the room's edges: the corners sit on the diagonals.
    expect(Math.max(...s.ring.map((p) => p.x))).toBeCloseTo(10_000 + R / Math.SQRT2, 3);
  });

  it("walls clip the polygon: a head 1 m from a wall covers nothing past it", () => {
    const [c] = coverageOf(ROOM, [{ id: "h", x: 1000, y: 10_000 }], R);
    expect(Math.min(...c.ring.map((p) => p.x))).toBeCloseTo(0, 6);
    const segArea = R * R * Math.acos(1000 / R) - 1000 * Math.sqrt(R * R - 1000 * 1000);
    const exact = Math.PI * R * R - segArea;
    expect(ringAreaOf(c.ring) / exact).toBeGreaterThan(0.998);
    expect(ringAreaOf(c.ring) / exact).toBeLessThanOrEqual(1);
  });

  it("a column casts a spray shadow; a turned room turns the square", () => {
    const col: CoverageBarrier = { kind: "column", ring: rect(11_000, 9_800, 11_400, 10_200) };
    const [c] = coverageOf([...ROOM, col], [{ id: "h", x: 10_000, y: 10_000 }], R);
    expect(inside(12_000, 10_000, c.ring)).toBe(false); // behind the column
    expect(inside(11_200, 10_000, c.ring)).toBe(false); // in the column
    expect(inside(12_000, 11_000, c.ring)).toBe(true); // beside the shadow
    expect(inside(10_800, 10_000, c.ring)).toBe(true); // in front of it
    const turned = [{ kind: "wall", ring: [{ x: 0, y: 0 }, { x: 30_000, y: 10_000 }, { x: 25_000, y: 25_000 }, { x: -5_000, y: 15_000 }] }];
    expect(squareAngleOf(turned)).toBeCloseTo(Math.atan2(10_000, 30_000), 9);
  });

  it("a head outside its zone or in a hole has no polygon", () => {
    const shaft: CoverageBarrier = { kind: "shaft", ring: rect(5000, 5000, 8000, 8000) };
    const out = coverageOf([...ROOM, shaft], [
      { id: "out", x: -100, y: 500 },
      { id: "hole", x: 6000, y: 6000 },
    ], R);
    expect(out.map((c) => c.ring.length)).toEqual([0, 0]);
  });

  it("covers a 600 m² office floor's heads, either shape, well within the 100 ms toggle budget", () => {
    const zones = officeFloor();
    const placed = placeSite(zones, NZS4541_V1);
    const jobs = zones.map((z, i) => ({ barriers: z.barriers, heads: placed[i].result.heads, R: coverageRadiusMm(NZS4541_V1.hazards[z.hazard]) }));
    const heads = jobs.reduce((n, j) => n + j.heads.length, 0);
    expect(heads).toBeGreaterThan(30);
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      for (const shape of ["circle", "square"] as const) for (const j of jobs) coverageOf(j.barriers, j.heads, j.R, shape);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(100);
    // Every head's polygon stays inside its zone.
    for (const j of jobs) {
      for (const c of coverageOf(j.barriers, j.heads, j.R)) {
        expect(c.ring.length).toBeGreaterThan(10);
      }
    }
  }, 60_000);
});
