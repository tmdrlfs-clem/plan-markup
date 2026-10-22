import { describe, expect, it } from "vitest";
import { TileCache, memoryTileBackend, openTileCache, type TileCacheBackend } from "./tile-cache";

const blob = (bytes: number) => new Blob([new Uint8Array(bytes)]);

describe("TileCache", () => {
  it("stores and returns tiles and document metadata", async () => {
    const cache = new TileCache(memoryTileBackend());
    await cache.putTile("a", blob(10));
    expect((await cache.getTile("a"))?.size).toBe(10);
    expect(await cache.getTile("missing")).toBeNull();
    await cache.putDoc("sha", { pages: [] });
    expect(await cache.getDoc("sha")).toEqual({ pages: [] });
    expect(await cache.getDoc("other")).toBeNull();
  });

  it("evicts the least recently used tiles past the budget, down to 90 %", async () => {
    let t = 0;
    const backend = memoryTileBackend();
    const cache = new TileCache(backend, { budgetBytes: 100, now: () => (t += 100_000) });
    await cache.putTile("a", blob(40));
    await cache.putTile("b", blob(40));
    await cache.getTile("a"); // refreshes a (older than the touch interval)
    await cache.putTile("c", blob(40)); // 120 > 100: evict b (oldest), 80 <= 90
    expect((await backend.tilesByAge()).map((x) => x.key)).toEqual(["a", "c"]);
  });

  it("replacing a tile counts its new size only once", async () => {
    const backend = memoryTileBackend();
    const cache = new TileCache(backend, { budgetBytes: 100 });
    await cache.putTile("a", blob(60));
    await cache.putTile("a", blob(60));
    expect((await backend.tilesByAge()).map((x) => x.key)).toEqual(["a"]);
  });

  it("never stores a tile larger than the whole budget", async () => {
    const backend = memoryTileBackend();
    await new TileCache(backend, { budgetBytes: 10 }).putTile("big", blob(11));
    expect(await backend.tilesByAge()).toEqual([]);
  });

  it("turns every storage failure into a miss and stops using the backend", async () => {
    let calls = 0;
    const failing: TileCacheBackend = new Proxy({} as TileCacheBackend, {
      get: () => async () => {
        calls++;
        throw new DOMException("QuotaExceededError");
      },
    });
    const cache = new TileCache(failing);
    await expect(cache.getTile("a")).resolves.toBeNull();
    expect(cache.usable).toBe(false);
    await expect(cache.putTile("a", blob(1))).resolves.toBeUndefined();
    await expect(cache.getDoc("x")).resolves.toBeNull();
    await expect(cache.putDoc("x", {})).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("openTileCache returns null without IndexedDB (Node, private mode)", async () => {
    expect(await openTileCache()).toBeNull();
  });
});
