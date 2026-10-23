import { describe, expect, it, vi } from "vitest";
import {
  MEASURE_EVERY_MS,
  TileCache,
  memoryTileBackend,
  openTileCache,
  type OpenTileCacheOptions,
  type TileCacheBackend,
} from "./tile-cache";

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

  it("a failed call is a miss or a skipped write, and the cache stays usable", async () => {
    let calls = 0;
    const failing: TileCacheBackend = new Proxy({} as TileCacheBackend, {
      get: () => async () => {
        calls++;
        throw new DOMException("transient", "UnknownError");
      },
    });
    const cache = new TileCache(failing);
    await expect(cache.getTile("a")).resolves.toBeNull();
    await expect(cache.putTile("a", blob(1))).resolves.toBeUndefined();
    await expect(cache.getDoc("x")).resolves.toBeNull();
    await expect(cache.putDoc("x", {})).resolves.toBeUndefined();
    expect(cache.usable).toBe(true);
    await cache.getTile("b");
    expect(calls).toBe(5);
    cache.disable();
    await cache.getTile("c");
    expect(calls).toBe(5);
    expect(cache.usable).toBe(false);
  });

  it("serialises concurrent writes so the byte total and eviction stay exact", async () => {
    let t = 0;
    const backend = memoryTileBackend();
    const cache = new TileCache(backend, { budgetBytes: 100, now: () => (t += 1) });
    await Promise.all(["a", "b", "c", "d", "e"].map((k) => cache.putTile(k, blob(30))));
    // 150 > 100 -> evicted oldest-first down to <= 90.
    const left = await backend.tilesByAge();
    expect(left.map((x) => x.key)).toEqual(["c", "d", "e"]);
    await cache.putTile("f", blob(30)); // 120 -> 90: exact total, so exactly one more eviction
    expect((await backend.tilesByAge()).map((x) => x.key)).toEqual(["d", "e", "f"]);
  });

  it("two caches on one store (two render workers) keep it within the budget: the total is measured again", async () => {
    let t = 0;
    const now = () => t;
    const backend = memoryTileBackend();
    const a = new TileCache(backend, { budgetBytes: 100, now });
    const b = new TileCache(backend, { budgetBytes: 100, now });
    const total = async () => (await backend.tilesByAge()).reduce((n, x) => n + x.size, 0);
    t = 1;
    await a.putTile("a1", blob(40)); // a measures 0: 40
    await b.putTile("b1", blob(40)); // b measures 40: 80
    t = 2;
    await a.putTile("a2", blob(40)); // within MEASURE_EVERY_MS a counts only its own writes (80): over for a moment
    expect(await total()).toBe(120);
    // The next write after the interval measures the real total and evicts.
    t = 2 + MEASURE_EVERY_MS;
    await a.putTile("a3", blob(20));
    expect(await total()).toBeLessThanOrEqual(100);
    // Many writes from both, each past the interval: the store never ends far over the budget.
    for (let i = 0; i < 10; i++) {
      t += MEASURE_EVERY_MS;
      await (i % 2 ? a : b).putTile(`x${i}`, blob(30));
      expect(await total()).toBeLessThanOrEqual(100);
    }
  });

  it("on a quota error evicts old tiles and retries the write once", async () => {
    let t = 0;
    const backend = memoryTileBackend();
    const cache = new TileCache(backend, { budgetBytes: 1000, now: () => (t += 1) });
    await cache.putTile("a", blob(40));
    await cache.putTile("b", blob(40));
    const put = backend.putTile.bind(backend);
    let quota = 1;
    backend.putTile = async (record) => {
      if (quota-- > 0) throw new DOMException("full", "QuotaExceededError");
      return put(record);
    };
    await cache.putTile("c", blob(40));
    expect((await backend.tilesByAge()).map((x) => x.key)).toEqual(["b", "c"]);
    expect(cache.usable).toBe(true);
    quota = 2; // fails again after the eviction: skipped, still usable
    await cache.putTile("d", blob(40));
    expect((await backend.tilesByAge()).map((x) => x.key)).not.toContain("d");
    expect(cache.usable).toBe(true);
  });

  it("refreshes recency without making the read wait for the write", async () => {
    let t = 0;
    const backend = memoryTileBackend();
    const cache = new TileCache(backend, { now: () => (t += 100_000) });
    await cache.putTile("a", blob(1));
    let touched = false;
    backend.touchTile = () =>
      new Promise((_, reject) =>
        setTimeout(() => {
          touched = true;
          reject(new Error("touch failed"));
        }, 20),
      );
    expect((await cache.getTile("a"))?.size).toBe(1);
    expect(touched).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(touched).toBe(true);
    expect(cache.usable).toBe(true);
  });

  it("openTileCache gives up after the timeout, when blocked, or when open fails", async () => {
    const never = (() => new Promise(() => undefined)) as unknown as OpenTileCacheOptions["open"];
    await expect(openTileCache({ open: never, timeoutMs: 10 })).resolves.toBeNull();
    const blocked = ((_n: string, _v: number, cbs: { blocked?: () => void }) => {
      setTimeout(() => cbs.blocked?.(), 0);
      return new Promise(() => undefined);
    }) as unknown as OpenTileCacheOptions["open"];
    await expect(openTileCache({ open: blocked, timeoutMs: 60_000 })).resolves.toBeNull();
    const failing = (async () => {
      throw new DOMException("no", "InvalidStateError");
    }) as unknown as OpenTileCacheOptions["open"];
    await expect(openTileCache({ open: failing })).resolves.toBeNull();
  });

  it("openTileCache disables the cache when another tab needs the database", async () => {
    const close = vi.fn();
    let callbacks: { blocking?: () => void; terminated?: () => void } = {};
    const open = ((_n: string, _v: number, cbs: typeof callbacks) => {
      callbacks = cbs;
      return Promise.resolve({ close });
    }) as unknown as OpenTileCacheOptions["open"];
    const cache = await openTileCache({ open });
    expect(cache?.usable).toBe(true);
    callbacks.blocking?.();
    await Promise.resolve();
    expect(cache?.usable).toBe(false);
    expect(close).toHaveBeenCalled();
  });

  it("openTileCache returns null without IndexedDB (Node, private mode)", async () => {
    expect(await openTileCache()).toBeNull();
  });
});
