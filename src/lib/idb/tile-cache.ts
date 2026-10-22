// IndexedDB raster cache (Story 3.1, NFR1 reopen): encoded tiles and previews,
// and per-document page sizes, so a reopen paints before pdf.js has parsed
// anything. Used from the render worker.
//
// Best effort by design: every storage call is wrapped and no error reaches
// the user. A failed call is a miss (reads) or is skipped (writes); a quota
// error on a write evicts and retries once. Only a database that cannot be
// opened in time, or that must close for another tab (versionchange) or was
// terminated by the browser, disables the cache. Bounded by a byte budget with
// least-recently-used eviction. Writes that change the byte total (put and
// evict) run one at a time on a promise chain.
//
// Key format (built by src/workers/render.worker.ts):
//   tiles:   `<sha256>:<page>:s<step>:<tileSize>:<col>:<row>`
//   preview: `<sha256>:<page>:preview:s<step>`
// <page> is 1-based; <step> is the quantised device scale step
// (src/core/render/tiles.ts scaleStep: 2^(step/1024) device px per point). The
// stored pixels therefore always match the key's geometry. Tiles belong to an
// absolute zoom bucket k (2^k device px per point, step = 1024 k), so they do
// not depend on the window size, fit or DPR: any window at the same device
// scale hits them. The preview is keyed by its own (fit box) scale, so only
// windows whose fit lands on the same step share it. Documents are keyed by sha256.
//
// The storage is behind `TileCacheBackend`, so the policy (budget, LRU, error
// handling) is tested with the in-memory backend; IndexedDB is the browser one.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DEFAULT_TILE_CACHE_BUDGET = 512 * 1024 * 1024;
/** Eviction stops once the total is back under this share of the budget. */
const EVICT_TO = 0.9;
/** A read refreshes an entry's recency at most this often (avoids a write per read). */
const TOUCH_AFTER_MS = 60_000;
/** On a quota error, evict down to this share of the current total, then retry once. */
const QUOTA_EVICT_TO = 0.5;
/** openTileCache gives up (no cache) when IndexedDB has not opened by then. */
export const OPEN_TIMEOUT_MS = 2000;

function isQuotaError(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === "QuotaExceededError";
}

export type TileRecord = { key: string; blob: Blob; size: number; lastAccess: number };
export type TileAge = { key: string; size: number; lastAccess: number };

export interface TileCacheBackend {
  getTile(key: string): Promise<TileRecord | undefined>;
  putTile(record: TileRecord): Promise<void>;
  touchTile(key: string, lastAccess: number): Promise<void>;
  deleteTiles(keys: readonly string[]): Promise<void>;
  /** Every tile's key, size and last access, oldest first. */
  tilesByAge(): Promise<TileAge[]>;
  getDoc(sha256: string): Promise<unknown>;
  putDoc(sha256: string, meta: unknown): Promise<void>;
}

export type TileCacheOptions = { budgetBytes?: number; now?: () => number };

export class TileCache {
  readonly budget: number;
  private readonly now: () => number;
  /** Known total bytes, computed lazily inside the write chain (null = unknown). */
  private total: number | null = null;
  private disabled = false;
  /** Serialises put/evict so concurrent writes never race on `total`. */
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: TileCacheBackend,
    { budgetBytes = DEFAULT_TILE_CACHE_BUDGET, now = () => Date.now() }: TileCacheOptions = {},
  ) {
    this.budget = budgetBytes;
    this.now = now;
  }

  /** False once the cache was disabled: it then answers misses and stores nothing. */
  get usable(): boolean {
    return !this.disabled;
  }

  /** Stops using the storage for good (the database closed or must close). */
  disable(): void {
    this.disabled = true;
  }

  /** Runs one storage call; its failure is that call's miss or no-op, never fatal. */
  private async guard<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
    if (this.disabled) return fallback;
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  async getTile(key: string): Promise<Blob | null> {
    return this.guard(null, async () => {
      const record = await this.backend.getTile(key);
      if (!record) return null;
      const now = this.now();
      // Recency is a hint: refresh it off the hot path and ignore failures.
      if (now - record.lastAccess >= TOUCH_AFTER_MS) void this.backend.touchTile(key, now).catch(() => undefined);
      return record.blob;
    });
  }

  putTile(key: string, blob: Blob): Promise<void> {
    if (this.disabled || blob.size > this.budget) return Promise.resolve();
    const run = this.writes.then(() => this.guard(undefined, () => this.write(key, blob)));
    this.writes = run;
    return run;
  }

  /** One serialised put: lazy total, the write (quota: evict, retry once), then budget eviction. */
  private async write(key: string, blob: Blob): Promise<void> {
    const size = blob.size;
    try {
      this.total ??= await this.measure();
      const old = await this.backend.getTile(key);
      const record = { key, blob, size, lastAccess: this.now() };
      try {
        await this.backend.putTile(record);
        this.total += size - (old?.size ?? 0);
      } catch (e) {
        if (!isQuotaError(e)) throw e;
        await this.evict(this.total * QUOTA_EVICT_TO);
        await this.backend.putTile(record);
        this.total = await this.measure();
      }
      if (this.total > this.budget) await this.evict(this.budget * EVICT_TO);
    } catch (e) {
      this.total = null; // unknown after a partial failure: measured again on the next write
      throw e;
    }
  }

  private async measure(): Promise<number> {
    return (await this.backend.tilesByAge()).reduce((n, t) => n + t.size, 0);
  }

  /** Drops the least recently used tiles until the total is at most `target` (inside `writes`). */
  private async evict(target: number): Promise<void> {
    const tiles = await this.backend.tilesByAge();
    let total = tiles.reduce((n, t) => n + t.size, 0);
    const drop: string[] = [];
    for (const tile of tiles) {
      if (total <= target) break;
      drop.push(tile.key);
      total -= tile.size;
    }
    this.total = null; // unknown until the delete has landed
    await this.backend.deleteTiles(drop);
    this.total = total;
  }

  async getDoc(sha256: string): Promise<unknown> {
    return this.guard(null, async () => (await this.backend.getDoc(sha256)) ?? null);
  }

  async putDoc(sha256: string, meta: unknown): Promise<void> {
    await this.guard(undefined, () => this.backend.putDoc(sha256, meta));
  }
}

/** In-memory backend (tests; also a reference for the IndexedDB one). */
export function memoryTileBackend(): TileCacheBackend {
  const tiles = new Map<string, TileRecord>();
  const docs = new Map<string, unknown>();
  return {
    getTile: async (key) => tiles.get(key),
    putTile: async (record) => void tiles.set(record.key, record),
    touchTile: async (key, lastAccess) => {
      const t = tiles.get(key);
      if (t) t.lastAccess = lastAccess;
    },
    deleteTiles: async (keys) => keys.forEach((k) => tiles.delete(k)),
    tilesByAge: async () =>
      [...tiles.values()]
        .map(({ key, size, lastAccess }) => ({ key, size, lastAccess }))
        .sort((a, b) => a.lastAccess - b.lastAccess),
    getDoc: async (sha) => docs.get(sha),
    putDoc: async (sha, meta) => void docs.set(sha, meta),
  };
}

const DB_NAME = "plan-markup-raster";
const DB_VERSION = 1;

interface RasterDb extends DBSchema {
  tiles: { key: string; value: TileRecord; indexes: { lastAccess: number } };
  docs: { key: string; value: { sha256: string; meta: unknown } };
}

/** IndexedDB backend over `db`. */
export function idbTileBackend(db: IDBPDatabase<RasterDb>): TileCacheBackend {
  return {
    getTile: (key) => db.get("tiles", key),
    putTile: async (record) => void (await db.put("tiles", record)),
    touchTile: async (key, lastAccess) => {
      const tx = db.transaction("tiles", "readwrite");
      const record = await tx.store.get(key);
      if (record) await tx.store.put({ ...record, lastAccess });
      await tx.done;
    },
    deleteTiles: async (keys) => {
      if (keys.length === 0) return;
      const tx = db.transaction("tiles", "readwrite");
      await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
    },
    tilesByAge: async () => {
      const out: TileAge[] = [];
      let cursor = await db.transaction("tiles").store.index("lastAccess").openCursor();
      while (cursor) {
        const { key, size, lastAccess } = cursor.value;
        out.push({ key, size, lastAccess });
        cursor = await cursor.continue();
      }
      return out;
    },
    getDoc: async (sha) => (await db.get("docs", sha))?.meta,
    putDoc: async (sha256, meta) => void (await db.put("docs", { sha256, meta })),
  };
}

export type OpenTileCacheOptions = TileCacheOptions & {
  timeoutMs?: number;
  /** The IndexedDB opener (tests pass a fake; defaults to idb's openDB). */
  open?: typeof openDB<RasterDb>;
};

/**
 * Opens the IndexedDB cache, or null when IndexedDB is unavailable, refuses
 * (private mode), is blocked by an older connection, or has not opened within
 * `timeoutMs`. A database that another tab needs to upgrade (`blocking`) is
 * closed and the cache disabled; so is one the browser terminates.
 */
export async function openTileCache(options: OpenTileCacheOptions = {}): Promise<TileCache | null> {
  const { timeoutMs = OPEN_TIMEOUT_MS, open = openDB<RasterDb>, ...cacheOptions } = options;
  if (options.open === undefined && typeof indexedDB === "undefined") return null;
  let cache: TileCache | null = null;
  let gaveUp = false;
  let giveUp!: () => void;
  const givenUp = new Promise<null>((resolve) => {
    giveUp = () => {
      gaveUp = true;
      resolve(null);
    };
  });
  const timer = setTimeout(() => giveUp(), timeoutMs);
  try {
    const raw = open(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const tiles = database.createObjectStore("tiles", { keyPath: "key" });
        tiles.createIndex("lastAccess", "lastAccess");
        database.createObjectStore("docs", { keyPath: "sha256" });
      },
      // An older connection elsewhere holds the database: stop waiting (no cache).
      blocked() {
        giveUp();
      },
      // Another tab wants to upgrade: let it, and stop using ours.
      blocking() {
        cache?.disable();
        void raw.then((db) => db.close(), () => undefined);
      },
      terminated() {
        cache?.disable();
      },
    });
    const opening = raw.then((db) => {
      if (gaveUp) {
        db.close(); // opened after we stopped waiting
        return null;
      }
      cache = new TileCache(idbTileBackend(db), cacheOptions);
      return cache;
    });
    return await Promise.race([opening, givenUp]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
