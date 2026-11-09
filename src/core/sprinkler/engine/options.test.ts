import { describe, expect, it } from "vitest";

import { placeZone, type CeilingGrid, type PlaceInput, type Pt } from "../placer";
import { NZS4541_V1 } from "../rules/rules";
import { inputOf, samples } from "../testing/zone-fixtures";
import { irregularZone } from "../testing/zone-generators";

import { engineZoneSchema } from "./protocol";
import { checkPlacement, placeSite, type EngineZone, type ZoneOutcome } from "./site";

// Story 9.7 AC: pattern, ceiling grid and preferred spacing / wall distance are honoured within the
// hard constraints (the oracle finds no error), unmet preferences are reported, and manually edited
// heads are fixed inputs on a re-run.

const fig = (z: EngineZone) => NZS4541_V1.hazards[z.hazard];
const errorsOf = (r: ZoneOutcome) => r.report?.flags.filter((f) => f.severity === "error").map((f) => f.code) ?? ["NO_REPORT"];
const rect = (w: number, h: number): Pt[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const room = (w: number, h: number, extra: Partial<EngineZone> = {}): EngineZone => ({ zoneId: "R", hazard: "ELH", barriers: [{ kind: "wall", ring: rect(w, h) }], ...extra });

/** A tile grid laid along the zone's first wall, starting at its first corner. */
function gridOf(z: EngineZone, mode: CeilingGrid["mode"]): CeilingGrid {
  const w = z.barriers[0].ring;
  return { angleDeg: (Math.atan2(w[1].y - w[0].y, w[1].x - w[0].x) * 180) / Math.PI, pitchX: 1_200, pitchY: 600, originX: w[0].x, originY: w[0].y, mode };
}

const OPTIONS: [string, (z: EngineZone) => Partial<PlaceInput>][] = [
  ["staggered", () => ({ pattern: "staggered" })],
  ["tile grid, preferred", (z) => ({ grid: gridOf(z, "preferred") })],
  ["tile grid, required", (z) => ({ grid: gridOf(z, "required") })],
  ["spacing 3 m, wall 1.2 m", () => ({ prefs: { spacing: 3_000, wallDist: 1_200 } })],
  ["preferences beyond the rule limits", () => ({ prefs: { spacing: 99_000, wallDist: 5 } })],
];
// one seeded zone per shape (L, U, T, splayed, columns, shaft), rotated
const SEEDS = [1, 2, 3, 4, 5, 6];

describe("engine: zone options stay within the hard constraints (oracle)", () => {
  const cases = OPTIONS.flatMap(([name, opt]) => SEEDS.map((seed) => [name, seed, opt] as const));
  it.each(cases)("%s, seed %i: zero oracle errors", { timeout: 30_000 }, (_, seed, opt) => {
    const z0 = irregularZone(seed);
    const z: EngineZone = { ...z0, ...opt(z0) };
    const [r] = placeSite([z], NZS4541_V1);
    expect(r.result.ok, `${z.zoneId} ${z0.shape}`).toBe(true);
    expect(errorsOf(r), `${z.zoneId} ${z0.shape}`).toEqual([]);
  });

  it("staggers the five named zones without oracle errors", { timeout: 60_000 }, () => {
    for (const id of ["Z1", "Z2", "Z3", "Z4", "Z5"]) {
      const s = samples().find((x) => x.id === id)!;
      const z: EngineZone = { ...inputOf(s.zones[0].zone), hazard: s.hazards[0], pattern: "staggered" };
      const [r] = placeSite([z], NZS4541_V1);
      expect(errorsOf(r), id).toEqual([]);
      expect(r.result.ok && r.result.notes.preferences.pattern.extraHeadsVsRectangular, id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("placer: the preference report (FR74)", () => {
  it("reports preferences that were kept", () => {
    const r = placeZone(room(12_000, 6_000, { prefs: { spacing: 4_000, wallDist: 1_000 } }), NZS4541_V1.hazards.ELH);
    expect(r.ok && r.notes.preferences).toMatchObject({
      spacing: { requested: 4_000, used: 4_000, achieved: { min: 4_000, max: 4_000 }, met: true },
      wallDist: { requested: 1_000, used: 1_000, achieved: { min: 1_000, max: 1_000 }, met: true },
      unmet: [],
    });
  });

  it("clamps preferences to the rule limits and says so", () => {
    const r = placeZone(room(12_000, 6_000, { prefs: { spacing: 9_000, wallDist: 10 } }), NZS4541_V1.hazards.ELH);
    const p = r.ok ? r.notes.preferences : null;
    expect(p?.spacing?.used).toBe(4_600); // ELH Smax
    expect(p?.wallDist?.used).toBe(51); // Wmin + 1
    expect(p?.unmet).toContain("Preferred spacing 9000 mm is outside the rule limits; 4600 mm was used.");
    expect(p?.unmet.some((u) => u.startsWith("Preferred wall distance 10 mm is outside the rule limits"))).toBe(true);
  });

  it("never adds a head for a preference, and reports the one it could not keep", () => {
    const plain = placeZone(room(11_000, 6_000), NZS4541_V1.hazards.ELH);
    const r = placeZone(room(11_000, 6_000, { prefs: { spacing: 2_500 } }), NZS4541_V1.hazards.ELH);
    expect(r.heads.length).toBe(plain.heads.length);
    const p = r.ok ? r.notes.preferences : null;
    expect(p?.spacing?.met).toBe(false);
    expect(p?.unmet).toEqual([expect.stringMatching(/^Preferred spacing 2500 mm could not be kept everywhere \(head count comes first\): \d+–\d+ mm placed\.$/)]);
  });

  it("reports the extra head a staggered layout costs (spike weak case 2)", () => {
    const s = samples().find((x) => x.id === "STAG")!;
    const r = placeZone(inputOf(s.zones[0].zone), NZS4541_V1.hazards.OH2);
    const p = r.ok ? r.notes.preferences : null;
    expect(p?.pattern).toEqual({ requested: "staggered", extraHeadsVsRectangular: 1 });
    expect(p?.unmet).toContain("Staggered layout uses 1 more head(s) than rectangular.");
  });

  it("reports tile alignment: required costs nothing in the tiled office, and off-stop heads are counted", () => {
    const grid: CeilingGrid = { angleDeg: 0, pitchX: 1_200, pitchY: 600, originX: 0, originY: 0, mode: "required" };
    const req = placeZone(room(9_600, 7_200, { grid }), NZS4541_V1.hazards.ELH);
    expect(req.ok && req.notes.tileAligned).toEqual({ onStop: 6, total: 6, extraHeadsVsUnaligned: 0 });
    expect(req.ok && req.notes.preferences.unmet).toEqual([]);
    // a grid whose stops cannot all be used: origin shifted so stops sit 50 mm from a wall
    const off = placeZone(room(9_700, 7_300, { grid: { ...grid, originX: -550, originY: -250, mode: "preferred" } }), NZS4541_V1.hazards.ELH);
    const t = off.ok ? off.notes.tileAligned : null;
    if (t && t.onStop < t.total) expect(off.ok && off.notes.preferences.unmet).toContain(`${t.total - t.onStop} of ${t.total} heads are off tile centres (head count comes first).`);
  });

  it("rejects a ceiling grid finer than 100 mm (placer and protocol)", () => {
    const grid: CeilingGrid = { pitchX: 10, pitchY: 600, mode: "preferred" };
    const r = placeZone(room(6_000, 4_000, { grid }), NZS4541_V1.hazards.ELH);
    expect(!r.ok && r.error.code).toBe("INVALID_ZONE");
    expect(engineZoneSchema.safeParse(room(6_000, 4_000, { grid })).success).toBe(false);
    expect(placeZone(room(6_000, 4_000, { grid: { ...grid, mode: "off" } }), NZS4541_V1.hazards.ELH).ok).toBe(true);
  });
});

describe("engine: manually edited heads are fixed inputs on a re-run", () => {
  it("keeps moved heads where the user put them and re-places the rest, oracle-clean", { timeout: 30_000 }, () => {
    const z = irregularZone(6); // an L-shaped OH1 room
    const first = placeZone(z, fig(z));
    expect(first.ok).toBe(true);
    // the user nudges two heads 300 mm (e.g. clear of a light) and locks them
    const moved = first.heads.slice(0, 2).map((h) => ({ id: `user-${h.id}`, x: h.x + 300, y: h.y }));
    const again: EngineZone = { ...z, locked: moved };
    const [r] = placeSite([again], NZS4541_V1);
    for (const m of moved) expect(r.result.heads).toContainEqual({ ...m, kind: "locked" });
    expect(r.result.heads.filter((h) => h.kind === "locked")).toHaveLength(2);
    expect(errorsOf(r)).toEqual([]);
    // deterministic re-run
    expect(JSON.stringify(placeZone(again, fig(z)))).toBe(JSON.stringify(placeZone(again, fig(z))));
  });

  it("a locked head the rules reject is kept and flagged by the oracle, not moved", () => {
    const z = room(10_000, 6_000, { hazard: "OH1", locked: [{ id: "U1", x: 20, y: 3_000 }] }); // 20 mm from a wall (< Wmin)
    const r = placeZone(z, NZS4541_V1.hazards.OH1);
    expect(r.heads.find((h) => h.id === "U1")).toEqual({ id: "U1", x: 20, y: 3_000, kind: "locked" });
    const report = checkPlacement(z, r.heads, [], NZS4541_V1);
    expect(report.flags.some((f) => f.severity === "error" && f.headIds.includes("U1"))).toBe(true);
  });
});
