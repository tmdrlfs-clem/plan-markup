// Test helper (Story 9.6, tests only): seeded irregular zones (design §5.4). A fixed LCG, so every
// run sees the same shapes. Shapes: L, U, T, splayed (one wall off the frame), column grids and
// shafts, each rotated by a random angle and moved off the origin. Columns keep >= 1 m from walls
// and from each other, so every zone is feasible (no slot narrower than 2 x Wmin).

import type { Hazard } from "../rules/rules";

import type { PlaceInput, PlacerBarrier, Pt } from "../placer";

export type GenZone = Omit<PlaceInput, "neighbourHeads"> & { hazard: Hazard; shape: GenShape; area: number };
export type GenShape = "L" | "U" | "T" | "splayed" | "columns" | "shaft";

export const GEN_SHAPES: readonly GenShape[] = ["L", "U", "T", "splayed", "columns", "shaft"];
const HAZARDS: readonly Hazard[] = ["ELH", "OH1", "OH2"];

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const r100 = (v: number) => Math.round(v / 100) * 100;

/** One seeded irregular zone. `shape` defaults to a rotation through GEN_SHAPES by seed. */
export function irregularZone(seed: number, shape: GenShape = GEN_SHAPES[seed % GEN_SHAPES.length]): GenZone {
  const rnd = lcg(seed * 7919 + 17);
  const span = (a: number, b: number) => r100(a + rnd() * (b - a));
  let outer: Pt[];
  const holes: PlacerBarrier[] = [];
  switch (shape) {
    case "L": {
      const W = span(8_000, 18_000);
      const H = span(7_000, 15_000);
      const a = span(2_600, W - 3_000);
      const b = span(2_600, H - 3_000);
      outer = [p(0, 0), p(W, 0), p(W, b), p(a, b), p(a, H), p(0, H)];
      break;
    }
    case "U": {
      const W = span(10_000, 18_000);
      const H = span(7_000, 13_000);
      const arm = span(2_600, W / 3);
      const base = span(2_600, H - 3_000);
      outer = [p(0, 0), p(W, 0), p(W, H), p(W - arm, H), p(W - arm, base), p(arm, base), p(arm, H), p(0, H)];
      break;
    }
    case "T": {
      const W = span(10_000, 18_000);
      const top = span(2_600, 5_000);
      const stem = span(2_600, W / 2.5);
      const H = top + span(3_000, 9_000);
      const x0 = r100((W - stem) / 2);
      outer = [p(x0, 0), p(x0 + stem, 0), p(x0 + stem, H - top), p(W, H - top), p(W, H), p(0, H), p(0, H - top), p(x0, H - top)];
      break;
    }
    case "splayed": {
      // an L whose long outer wall is splayed, plus a chamfered corner
      const W = span(9_000, 17_000);
      const H = span(7_000, 13_000);
      const a = span(3_000, W - 3_500);
      const b = span(3_000, H - 3_500);
      const skew = span(500, 2_500);
      const ch = span(600, 1_800);
      outer = [p(0, 0), p(W - ch, 0), p(W, ch), p(W + skew, b), p(a, b), p(a, H), p(0, H)];
      break;
    }
    case "columns": {
      const W = span(10_000, 20_000);
      const H = span(8_000, 14_000);
      outer = [p(0, 0), p(W, 0), p(W, H), p(0, H)];
      const pitch = span(5_000, 8_000);
      const c = span(300, 600);
      for (let x = pitch; x < W - 1_000 - c; x += pitch)
        for (let y = pitch * 0.8; y < H - 1_000 - c; y += pitch * 0.8) holes.push({ kind: "column", ring: square(r100(x), r100(y), c) });
      break;
    }
    case "shaft": {
      const W = span(9_000, 16_000);
      const H = span(8_000, 13_000);
      outer = [p(0, 0), p(W, 0), p(W, H), p(0, H)];
      const sw = span(1_500, 3_000);
      const sh = span(1_500, 3_000);
      const sx = span(2_600, W - sw - 2_600);
      const sy = span(2_600, H - sh - 2_600);
      holes.push({ kind: "shaft", ring: [p(sx, sy), p(sx + sw, sy), p(sx + sw, sy + sh), p(sx, sy + sh)] });
      const c = span(300, 500);
      if (sx > 4_000) holes.push({ kind: "column", ring: square(r100(sx / 2), r100(H / 2), c) });
      break;
    }
  }
  const rot = rnd() * Math.PI;
  const ox = 10_000 + rnd() * 50_000;
  const oy = -20_000 + rnd() * 40_000;
  const move = (q: Pt): Pt => ({ x: ox + q.x * Math.cos(rot) - q.y * Math.sin(rot), y: oy + q.x * Math.sin(rot) + q.y * Math.cos(rot) });
  const area = Math.abs(ringArea(outer)) - holes.reduce((s, h) => s + Math.abs(ringArea(h.ring)), 0);
  return {
    zoneId: `G${seed}`,
    hazard: HAZARDS[Math.floor(seed / GEN_SHAPES.length) % HAZARDS.length],
    shape,
    area,
    barriers: [{ kind: "wall", ring: outer.map(move) }, ...holes.map((h) => ({ kind: h.kind, ring: h.ring.map(move) }))],
  };
}

function p(x: number, y: number): Pt {
  return { x, y };
}

function square(cx: number, cy: number, s: number): Pt[] {
  const h = s / 2;
  return [p(cx - h, cy - h), p(cx + h, cy - h), p(cx + h, cy + h), p(cx - h, cy + h)];
}

function ringArea(r: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const q = r[(i + 1) % r.length];
    a += r[i].x * q.y - q.x * r[i].y;
  }
  return a / 2;
}

/**
 * A 600 m² office floor of 15 zones (NFR6 floor budget): a 40 x 15 m plate, a 2 m corridor along
 * its length open to the rooms at the doorway ends, and rooms of varied widths either side.
 * Corridor-to-lobby edges are open edges shared by both zones.
 */
export function officeFloor(): GenZone[] {
  const zones: GenZone[] = [];
  const add = (id: string, ring: Pt[], hazard: Hazard, openEdges: { a: Pt; b: Pt }[] = []) =>
    zones.push({ zoneId: id, hazard, shape: "L", area: Math.abs(ringArea(ring)), barriers: [{ kind: "wall", ring }], openEdges });
  const rect = (x0: number, y0: number, x1: number, y1: number) => [p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)];
  // south rooms (y 0..6.5), north rooms (y 8.5..15), corridor (y 6.5..8.5) split at x = 20 m
  const south = [0, 5_500, 11_000, 15_000, 20_000, 26_500, 31_000, 35_500, 40_000];
  const north = [0, 8_000, 15_500, 24_000, 32_000, 40_000];
  for (let i = 0; i + 1 < south.length; i++) add(`S${i + 1}`, rect(south[i], 0, south[i + 1], 6_500), i === 3 ? "OH1" : "ELH");
  for (let i = 0; i + 1 < north.length; i++) add(`N${i + 1}`, rect(north[i], 8_500, north[i + 1], 15_000), "ELH");
  const seam = { a: p(20_000, 6_500), b: p(20_000, 8_500) };
  add("C1", rect(0, 6_500, 20_000, 8_500), "ELH", [seam]);
  add("C2", rect(20_000, 6_500, 40_000, 8_500), "ELH", [seam]);
  return zones;
}
