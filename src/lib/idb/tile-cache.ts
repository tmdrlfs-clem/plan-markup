// IndexedDB raster cache (Story 3.1, NFR1 reopen): encoded tiles keyed by
// sha256 + page + bucket + tile, and per-document page sizes, so a reopen
// paints before pdf.js has parsed anything. Used from the render worker.
//
// Best effort by design: every storage call is wrapped, and any failure
// (private mode, quota, a blocked or broken database) turns into "no cache"
// without an error reaching the user. Bounded by a byte budget with
// least-recently-used eviction.
//
// The storage is behind `TileCacheBackend`, so the policy (budget, LRU, error
// swallowing) is tested with the in-memory backend; IndexedDB is the browser one.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DEFAULT_TILE_CACHE_BUDGET = 512 * 1024 * 1024;
/** Eviction stops once the total is back under this share of the budget. */
const EVICT_TO = 0.9;
/** A read refreshes an entry's recency at most this often (avoids a write per read). */
const TOUCH_AFTER_MS = 60_000;

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
  /** Known total bytes, computed on the first write. */
  private total: number | null = null;
  private broken = false;

  constructor(
    private readonly backend: TileCacheBackend,
    { budgetBytes = DEFAULT_TILE_CACHE_BUDGET, now = () => Date.now() }: TileCacheOptions = {},
  ) {
    this.budget = budgetBytes;
    this.now = now;
  }

  /** False once a storage call failed: the cache then answers misses and stores nothing. */
  get usable(): boolean {
    return !this.broken;
  }

  private async guard<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
    if (this.broken) return fallback;
    try {
      return await fn();
    } catch {
      this.broken = true;
      return fallback;
    }
  }

  async getTile(key: string): Promise<Blob | null> {
    return this.guard(null, async () => {
      const record = await this.backend.getTile(key);
      if (!record) return null;
      const now = this.now();
      if (now - record.lastAccess >= TOUCH_AFTER_MS) await this.backend.touchTile(key, now);
      return record.blob;
    });
  }

  async putTile(key: string, blob: Blob): Promise<void> {
    await this.guard(undefined, async () => {
      const size = blob.size;
      if (size > this.budget) return;
      if (this.total === null) this.total = (await this.backend.tilesByAge()).reduce((n, t) => n + t.size, 0);
      const old = await this.backend.getTile(key);
      await this.backend.putTile({ key, blob, size, lastAccess: this.now() });
      this.total += size - (old?.size ?? 0);
      if (this.total > this.budget) await this.evict();
    });
  }

  /** Drops the least recently used tiles until the total is under EVICT_TO x budget. */
  private async evict(): Promise<void> {
    const target = this.budget * EVICT_TO;
    const drop: string[] = [];
    let total = this.total ?? 0;
    for (const tile of await this.backend.tilesByAge()) {
      if (total <= target) break;
      drop.push(tile.key);
      total -= tile.size;
    }
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

/** Opens the IndexedDB cache, or null when IndexedDB is unavailable or refuses (private mode). */
export async function openTileCache(options: TileCacheOptions = {}): Promise<TileCache | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const db = await openDB<RasterDb>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const tiles = database.createObjectStore("tiles", { keyPath: "key" });
        tiles.createIndex("lastAccess", "lastAccess");
        database.createObjectStore("docs", { keyPath: "sha256" });
      },
    });
    return new TileCache(idbTileBackend(db), options);
  } catch {
    return null;
  }
}
