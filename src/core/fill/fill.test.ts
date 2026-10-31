import { describe, expect, it } from "vitest";

import { burnPolyline, burnSegment, cellAt, createGrid, type FillGrid } from "./grid";
import { fillRings, offsetRing, signedArea2, simplifyRing } from "./polygon";
import { FillSpread } from "./spread";

type Point = { x: number; y: number };

/** A room (user space, cell 1) with walls along its outline; an optional gap in the bottom wall. */
function room(x0: number, y0: number, x1: number, y1: number, gap?: [number, number]): FillGrid {
  const grid = createGrid({ x0: 0, y0: 0, x1: 120, y1: 100 }, 1);
  if (gap) {
    burnSegment(grid, x0, y0, gap[0], y0);
    burnSegment(grid, gap[1], y0, x1, y0);
  } else burnSegment(grid, x0, y0, x1, y0);
  burnPolyline(grid, [
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ]);
  return grid;
}

function grow(spread: FillSpread, at: Point): void {
  const c = cellAt(spread.grid, at)!;
  spread.beginStroke("grow");
  spread.seed(c.x, c.y);
  for (let i = 0; i < 10_000 && spread.growing; i++) spread.step(70);
  spread.endStroke();
}

const area = (ring: readonly Point[]) => Math.abs(signedArea2(ring)) / 2;

describe("grid (Story 4.10)", () => {
  it("sizes cells to the window and coarsens past the cell budget", () => {
    const g = createGrid({ x0: 10, y0: 20, x1: 110, y1: 70 }, 0.5);
    expect([g.w, g.h, g.cell]).toEqual([200, 100, 0.5]);
    const coarse = createGrid({ x0: 0, y0: 0, x1: 1000, y1: 1000 }, 0.1, 10_000);
    expect(coarse.cell).toBeCloseTo(10, 9);
    expect(cellAt(g, { x: 10.2, y: 20.9 })).toEqual({ x: 0, y: 1 });
    expect(cellAt(g, { x: 9, y: 30 })).toBeNull();
  });

  it("burns lines 4-connected: a diagonal wall stops an 8-connected spread", () => {
    const g = createGrid({ x0: 0, y0: 0, x1: 40, y1: 40 }, 1);
    burnSegment(g, 0, 0.3, 40, 40.3);
    const s = new FillSpread(g);
    grow(s, { x: 30.5, y: 5.5 });
    // Below the diagonal only: nothing above it is filled.
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (s.filled[y * 40 + x]) expect(y).toBeLessThan(x + 1);
  });
});

describe("FillSpread (Story 4.10)", () => {
  it("fills a closed room in steps, stopped by its walls, without leaking", () => {
    const s = new FillSpread(room(10, 10, 90, 70));
    const c = cellAt(s.grid, { x: 50, y: 40 })!;
    s.beginStroke("grow");
    s.seed(c.x, c.y);
    const first = s.step(80);
    // One band: a near circle of radius about 8 cells around the seed.
    expect(first).not.toBeNull();
    expect(first!.x1 - first!.x0).toBeLessThanOrEqual(18);
    while (s.growing) s.step(80);
    s.endStroke();
    expect(s.leaked).toBe(false);
    // The open cells strictly inside the walls (cells 11..89 × 11..69).
    expect(s.count).toBe(79 * 59);
  });

  it("leaks through a door gap; a barrier line across it closes the room", () => {
    const open = new FillSpread(room(10, 10, 90, 70, [40, 50]));
    grow(open, { x: 50, y: 40 });
    expect(open.leaked).toBe(true);
    const closed = room(10, 10, 90, 70, [40, 50]);
    burnPolyline(closed, [
      { x: 38, y: 10 },
      { x: 52, y: 10 },
    ]);
    const s = new FillSpread(closed);
    grow(s, { x: 50, y: 40 });
    expect(s.leaked).toBe(false);
    // Undoing the stroke that leaked clears the leak.
    expect(open.undoStroke()).toBe(true);
    expect(open.leaked).toBe(false);
    expect(open.count).toBe(0);
  });

  it("paints across a wall (the spread carries on), erases, and undoes stroke by stroke", () => {
    const g = room(10, 10, 50, 50);
    burnSegment(g, 30, 10, 30, 50); // splits the room in two
    const s = new FillSpread(g);
    grow(s, { x: 20, y: 30 });
    const left = s.count;
    // The spread carries on while the paint stroke is held (it belongs to that stroke).
    s.beginStroke("paint");
    s.paint(30, 30, 2);
    for (let i = 0; i < 1000 && s.growing; i++) s.step(70);
    s.endStroke();
    expect(s.count).toBeGreaterThan(2 * left);
    s.beginStroke("erase");
    expect(s.erase(20, 30, 3)).not.toBeNull();
    s.endStroke();
    const erased = s.count;
    expect(s.undoStroke()).toBe(true); // the erase
    expect(s.count).toBeGreaterThan(erased);
    expect(s.undoStroke()).toBe(true); // the paint (and what spread from it in that stroke)
    expect(s.count).toBe(left);
    expect(s.undoStroke()).toBe(true); // the hold
    expect(s.count).toBe(0);
    expect(s.undoStroke()).toBe(false);
  });
});

describe("fillRings (Story 4.10)", () => {
  it("traces a rectangle within about one cell per side of its walls", () => {
    // Walls off the grid lines: 10.3..90.7 × 10.4..70.6 (80.4 × 60.2 user units).
    const s = new FillSpread(room(10.3, 10.4, 90.7, 70.6));
    grow(s, { x: 50, y: 40 });
    const r = fillRings(s.grid, s.filled, s.erased)!;
    expect(r.holes).toEqual([]);
    expect(r.stray).toBe(0);
    expect(r.outer).toHaveLength(4);
    const truth = 80.4 * 60.2;
    expect(Math.abs(area(r.outer) - truth)).toBeLessThan((2 * (80.4 + 60.2)) * 0.6);
  });

  it("counts enclosed furniture as room; an erased island becomes a hole", () => {
    const g = room(10, 10, 90, 70);
    // A table inside the room: the fill flows round it.
    burnPolyline(g, [
      { x: 30, y: 30 },
      { x: 40, y: 30 },
      { x: 40, y: 40 },
      { x: 30, y: 40 },
      { x: 30, y: 30 },
    ]);
    const s = new FillSpread(g);
    grow(s, { x: 70, y: 50 });
    const r = fillRings(s.grid, s.filled, s.erased)!;
    expect(r.holes).toEqual([]);
    expect(area(r.outer)).toBeGreaterThan(79 * 59);
    s.beginStroke("erase");
    s.erase(70, 50, 4);
    s.endStroke();
    const cut = fillRings(s.grid, s.filled, s.erased)!;
    expect(cut.holes).toHaveLength(1);
    expect(area(cut.holes[0])).toBeGreaterThan(20);
  });

  it("merges rooms filled across a thin wall; counts a patch beyond a thick one as stray; nothing filled is null", () => {
    const thin = room(10, 10, 90, 70);
    burnSegment(thin, 60, 10, 60, 70);
    const both = new FillSpread(thin);
    grow(both, { x: 30, y: 40 });
    grow(both, { x: 80, y: 40 });
    expect(fillRings(both.grid, both.filled, both.erased)!.stray).toBe(0);
    const g = room(10, 10, 90, 70);
    // A partition 8 cells thick (two walls with a closed void between).
    burnSegment(g, 56, 10, 56, 70);
    burnSegment(g, 64, 10, 64, 70);
    const s = new FillSpread(g);
    grow(s, { x: 30, y: 40 });
    grow(s, { x: 80, y: 40 });
    expect(fillRings(s.grid, s.filled, s.erased)!.stray).toBe(1);
    expect(fillRings(g, new Uint8Array(g.w * g.h), new Uint8Array(g.w * g.h))).toBeNull();
  });
});

describe("ring helpers (Story 4.10)", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it("offsets outward for either winding, by the ring's own area", () => {
    expect(area(offsetRing(square, 0.5))).toBeCloseTo(121, 9);
    expect(area(offsetRing([...square].reverse(), 0.5))).toBeCloseTo(121, 9);
    expect(area(offsetRing(square, -0.5))).toBeCloseTo(81, 9);
  });
  it("simplifies a staircase-free ring to its corners", () => {
    const dense: Point[] = [];
    for (let x = 0; x < 10; x++) dense.push({ x, y: 0 });
    for (let y = 0; y < 10; y++) dense.push({ x: 10, y });
    for (let x = 10; x > 0; x--) dense.push({ x, y: 10 });
    for (let y = 10; y > 0; y--) dense.push({ x: 0, y });
    expect(simplifyRing(dense, 0.75)).toHaveLength(4);
  });
});
