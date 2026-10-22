import { describe, expect, it, vi } from "vitest";
import {
  LruByteCache,
  MAX_BUCKET,
  MIN_BUCKET,
  allBuckets,
  bitmapBytes,
  bucketForScale,
  bucketScale,
  fitScale,
  quantizeScale,
  scaleStep,
  stepScale,
  tileGrid,
  tileKey,
  tileRect,
  visibleTiles,
} from "./tiles";

const A1 = { width: 2384, height: 1684 };
const HD = { width: 1920, height: 1080 };

describe("fitScale", () => {
  it("fits the limiting dimension", () => {
    expect(fitScale(A1, HD)).toBeCloseTo(1080 / 1684, 10);
    expect(fitScale({ width: 1000, height: 100 }, HD)).toBeCloseTo(1.92, 10);
  });

  it("subtracts padding on both sides", () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 220, height: 220 }, 10)).toBe(2);
  });

  it("rejects an empty page", () => {
    expect(() => fitScale({ width: 0, height: 10 }, HD)).toThrow(RangeError);
  });
});

describe("scale quantisation", () => {
  it("rounds up to steps of 2^(1/16), keeping exact steps (and float noise) on their step", () => {
    expect(scaleStep(1)).toBe(0);
    expect(scaleStep(2)).toBe(16);
    expect(scaleStep(0.5)).toBe(-16);
    expect(scaleStep(2 * (1 + 1e-9))).toBe(16);
    expect(scaleStep(1.01)).toBe(1);
    expect(stepScale(16)).toBe(2);
    for (const s of [0.137, 0.5, 0.9, 1.3, 7.77]) {
      const q = quantizeScale(s);
      expect(q).toBeGreaterThanOrEqual(s);
      expect(q / s).toBeLessThan(2 ** (1 / 16) + 1e-9);
      expect(quantizeScale(q)).toBe(q);
    }
  });

  it("maps nearby scales (slightly different windows) to the same step", () => {
    expect(scaleStep(0.641)).toBe(scaleStep(0.645));
    expect(() => scaleStep(0)).toThrow(RangeError);
  });
});

describe("buckets", () => {
  const fit = 0.5;

  it("bucketScale is fit * 2^k * dpr", () => {
    expect(bucketScale(fit, 0, 1)).toBe(0.5);
    expect(bucketScale(fit, 2, 1.5)).toBe(3);
    expect(bucketScale(fit, -2, 1)).toBe(0.125);
  });

  it("picks the smallest bucket at or above the view scale", () => {
    expect(bucketForScale(0.5, fit)).toBe(0);
    expect(bucketForScale(0.51, fit)).toBe(1);
    expect(bucketForScale(1, fit)).toBe(1);
    expect(bucketForScale(1.9, fit)).toBe(2);
    expect(bucketForScale(0.3, fit)).toBe(0);
    expect(bucketForScale(0.25, fit)).toBe(-1);
  });

  it("keeps exact powers on their own bucket despite float noise", () => {
    expect(bucketForScale(fit * 2 ** 2 * (1 + 1e-9), fit)).toBe(2);
  });

  it("clamps to MIN_BUCKET and MAX_BUCKET", () => {
    expect(bucketForScale(0.0001, fit)).toBe(MIN_BUCKET);
    expect(bucketForScale(1000, fit)).toBe(MAX_BUCKET);
    expect(allBuckets()).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it("rejects non-positive scales", () => {
    expect(() => bucketForScale(0, fit)).toThrow(RangeError);
    expect(() => bucketForScale(1, Number.NaN)).toThrow(RangeError);
  });
});

describe("tileGrid / tileRect", () => {
  it("covers the page with whole tiles and clips edge tiles", () => {
    const grid = tileGrid({ width: 1000, height: 600 }, 1.5, 512);
    expect(grid).toMatchObject({ width: 1500, height: 900, cols: 3, rows: 2 });
    expect(tileRect(grid, 0, 0)).toEqual({ x: 0, y: 0, width: 512, height: 512 });
    expect(tileRect(grid, 2, 1)).toEqual({ x: 1024, y: 512, width: 476, height: 388 });
  });

  it("rounds fractional page sizes up", () => {
    const grid = tileGrid({ width: 10.2, height: 10 }, 1, 256);
    expect(grid.width).toBe(11);
    expect(grid.cols).toBe(1);
  });

  it("validates the tile size", () => {
    expect(() => tileGrid(A1, 1, 0)).toThrow(RangeError);
    expect(() => tileGrid(A1, 1, 256.5)).toThrow(RangeError);
  });
});

describe("visibleTiles", () => {
  const page = { width: 4096, height: 4096 };
  const grid = tileGrid(page, 1, 512); // 8 x 8 tiles, scale 1 device px per pt
  const viewport = { width: 1024, height: 1024 };

  it("returns the in-view tiles plus a 1-tile margin, clamped to the page", () => {
    const tiles = visibleTiles({ scale: 1, x: 0, y: 0 }, viewport, grid);
    // In view: cols/rows 0..1; margin adds col/row 2 (none below 0).
    expect(tiles).toHaveLength(9);
    expect(tiles.filter((t) => t.inView)).toHaveLength(4);
    expect(tiles.every((t) => t.col <= 2 && t.row <= 2)).toBe(true);
  });

  it("orders in-view tiles first, centre first", () => {
    const tiles = visibleTiles({ scale: 1, x: 1024 + 256, y: 1024 + 256 }, viewport, grid, 1);
    // Viewport covers px 1280..2304: cols/rows 2..4, centre at tile 3.5 => tile (3,3) first.
    expect(tiles[0]).toMatchObject({ col: 3, row: 3, inView: true });
    const firstMargin = tiles.findIndex((t) => !t.inView);
    expect(firstMargin).toBe(9);
    expect(tiles.slice(firstMargin).every((t) => !t.inView)).toBe(true);
    for (let i = 1; i < firstMargin; i++) expect(tiles[i].distance).toBeGreaterThanOrEqual(tiles[i - 1].distance);
  });

  it("maps the view scale to the grid scale", () => {
    // View at 2 CSS px/pt shows 512 x 512 pt; a grid at 2 device px/pt sees 1024 px => 2 x 2 tiles.
    const g2 = tileGrid(page, 2, 512);
    const tiles = visibleTiles({ scale: 2, x: 0, y: 0 }, viewport, g2, 0);
    expect(tiles.map((t) => [t.col, t.row])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it("returns nothing when the view is off the page", () => {
    expect(visibleTiles({ scale: 1, x: -5000, y: 0 }, viewport, grid, 1)).toEqual([]);
  });

  it("is stable for equal distances", () => {
    const a = visibleTiles({ scale: 1, x: 0, y: 0 }, viewport, grid, 0);
    expect(a.map((t) => `${t.col},${t.row}`)).toEqual(["0,0", "1,0", "0,1", "1,1"]);
  });
});

describe("tileKey / bitmapBytes", () => {
  it("formats the key and counts RGBA bytes", () => {
    expect(tileKey(1, -2, 3, 4)).toBe("1:-2:3:4");
    expect(bitmapBytes(512, 512)).toBe(1_048_576);
  });
});

describe("LruByteCache", () => {
  it("evicts least recently used entries by bytes", () => {
    const evicted: string[] = [];
    const cache = new LruByteCache<string>(300, (k) => evicted.push(k));
    cache.set("a", "A", 100);
    cache.set("b", "B", 100);
    cache.set("c", "C", 100);
    expect(cache.get("a")).toBe("A"); // a becomes most recent
    expect(cache.set("d", "D", 150)).toEqual(["b", "c"]);
    expect(evicted).toEqual(["b", "c"]);
    expect(cache.keys()).toEqual(["a", "d"]);
    expect(cache.bytes).toBe(250);
  });

  it("peek does not change recency", () => {
    const cache = new LruByteCache<number>(200);
    cache.set("a", 1, 100);
    cache.set("b", 2, 100);
    expect(cache.peek("a")).toBe(1);
    cache.set("c", 3, 100);
    expect(cache.has("a")).toBe(false);
  });

  it("replacing a key releases the old value and updates bytes", () => {
    const onEvict = vi.fn();
    const cache = new LruByteCache<string>(1000, onEvict);
    cache.set("a", "old", 400);
    cache.set("a", "new", 100);
    expect(onEvict).toHaveBeenCalledWith("a", "old");
    expect(cache.bytes).toBe(100);
    expect(cache.size).toBe(1);
  });

  it("does not keep an entry larger than the budget and keeps the others", () => {
    const onEvict = vi.fn();
    const cache = new LruByteCache<string>(100, onEvict);
    cache.set("a", "A", 50);
    expect(cache.set("huge", "H", 500)).toEqual(["huge"]);
    expect(onEvict).toHaveBeenCalledWith("huge", "H");
    expect(cache.keys()).toEqual(["a"]);
  });

  it("delete and clear release values", () => {
    const onEvict = vi.fn();
    const cache = new LruByteCache<string>(1000, onEvict);
    cache.set("a", "A", 1);
    cache.set("b", "B", 1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("missing")).toBe(false);
    cache.clear();
    expect(onEvict.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });

  it("rejects invalid budgets and sizes", () => {
    expect(() => new LruByteCache(-1)).toThrow(RangeError);
    expect(() => new LruByteCache(10).set("a", 1, -1)).toThrow(RangeError);
  });
});
