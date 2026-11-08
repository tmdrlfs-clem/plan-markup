// Test helper (Story 9.5, tests only): reads the zone fixtures (fixtures/zones, format
// plan-markup.zone-fixture/1) and the reference layouts (fixtures/zones/layouts)
// as placer inputs. Node-only; imported by tests, never by the placer itself.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Hazard } from "../rules/rules";

import type { PlaceInput, Pt } from "../placer";

export const ZONES_DIR = path.join(__dirname, "..", "..", "..", "..", "fixtures", "zones");

type Pair = [number, number];
type FixtureZone = {
  zoneId: string;
  hazard: Hazard;
  pattern?: "rectangular" | "staggered";
  outer: Pair[];
  holes?: { kind: "column" | "shaft"; ring: Pair[] }[];
  openEdges?: [Pair, Pair][];
  grid?: { angleDeg: number; pitchX: number; pitchY: number; originX: number; originY: number; mode: "off" | "preferred" | "required" };
  keepOuts?: ({ kind: string; ring: Pair[] } | { kind: string; circle: { x: number; y: number; r: number } })[];
};
export type Fixture = {
  slug: string;
  sample: { id: string; name: string; group: string; index: number; zone: number; zones: number };
  hazards: Hazard[];
  zone: FixtureZone;
  expected: Record<string, { hand?: number | null; lowerBound?: number }> & { error?: string };
};
export type Layout = { sample: string; hazard: Hazard; zones: { slug: string; zoneId: string; heads: { id: string; x: number; y: number }[] }[] };

const pts = (ring: Pair[]): Pt[] => ring.map(([x, y]) => ({ x, y }));

export function readFixtures(): Fixture[] {
  return readdirSync(ZONES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(ZONES_DIR, f), "utf8")) as Fixture)
    .sort((a, b) => a.sample.index - b.sample.index || a.sample.zone - b.sample.zone);
}

export function readLayouts(): Layout[] {
  const dir = path.join(ZONES_DIR, "layouts");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Layout);
}

export function inputOf(z: FixtureZone): PlaceInput {
  return {
    zoneId: z.zoneId,
    barriers: [{ kind: "wall", ring: pts(z.outer) }, ...(z.holes ?? []).map((h) => ({ kind: h.kind, ring: pts(h.ring) }))],
    openEdges: (z.openEdges ?? []).map(([a, b]) => ({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } })),
    keepOuts: (z.keepOuts ?? []).map((k) => ("ring" in k ? { ring: pts(k.ring) } : { circle: k.circle })),
    pattern: z.pattern ?? "rectangular",
    grid: z.grid ?? null,
  };
}

/** The fixtures grouped by sample (zones in order), with the hazards each sample is run at. */
export function samples(): { id: string; group: string; zones: Fixture[]; hazards: Hazard[]; error: string | null }[] {
  const out: { id: string; group: string; zones: Fixture[]; hazards: Hazard[]; error: string | null }[] = [];
  for (const f of readFixtures()) {
    let s = out.find((x) => x.id === f.sample.id);
    if (!s) {
      s = { id: f.sample.id, group: f.sample.group, zones: [], hazards: [], error: f.expected.error ?? null };
      out.push(s);
    }
    s.zones.push(f);
    if (f.sample.zones === 1) s.hazards = f.hazards.slice();
    else if (!s.hazards.length) s.hazards = [f.zone.hazard];
  }
  return out;
}
