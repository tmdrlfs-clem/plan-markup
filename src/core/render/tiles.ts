// Tile math for the PDF viewer (Story 2.3 spike, kept for Epic 3). Framework-free.
//
// Spaces:
// - page space: PDF points with the origin at the page's top-left corner and y
//   pointing down (pdf.js viewport space at scale 1, rotation applied).
// - view: CSS pixels. `View.scale` is CSS px per point; (x, y) is the page-space
//   point shown at the viewport's top-left corner.
// - tile space: device pixels of the page rendered at a bucket's scale, cut
//   into square tiles of `tileSize` device px (edge tiles are smaller).
//
// Zoom buckets are absolute: bucket k renders at exactly 2^k device px per
// point, whatever the window size, fit or DPR (a view's device scale is
// zoom x dpr). A view between buckets uses the next bucket up (never upscale a
// tile at rest), clamped to [MIN_BUCKET, MAX_BUCKET]. Because the scales do not
// depend on the viewport, resizing the window, toggling a panel or moving to
// another monitor keeps every cached tile (in memory and in IndexedDB), and a
// view exactly at 2^k draws its tiles 1:1.

export type Size = { width: number; height: number };
export type View = { scale: number; x: number; y: number };

/** 1/256 device px per point (views at or below the fit preview's scale draw the preview instead). */
export const MIN_BUCKET = -8;
/**
 * 512 device px per point: the highest zoom (view.ts MAX_ZOOM, 6400 % = 85.3 CSS px
 * per point) at a DPR of up to 6,
 * within the worker's scale limit (render-protocol: 1000). Only the tiles in view
 * are ever requested, so a high bucket costs no more memory than a low one.
 */
export const MAX_BUCKET = 9;
export const DEFAULT_TILE_SIZE = 512;

/** CSS px per point that fits the whole page into the viewport, leaving `padding` CSS px around it. */
export function fitScale(page: Size, viewport: Size, padding = 0): number {
  const w = Math.max(1, viewport.width - 2 * padding);
  const h = Math.max(1, viewport.height - 2 * padding);
  if (page.width <= 0 || page.height <= 0) throw new RangeError("page size must be positive");
  return Math.min(w / page.width, h / page.height);
}

/** Device px per point at bucket `k`: exactly 2^k (a quantisation step of its own). */
export function bucketScale(bucket: number): number {
  return 2 ** bucket;
}

/**
 * Raster scales are quantised to steps of 2^(1/SCALE_STEPS_PER_OCTAVE) (≈ 0.07 %).
 * Bucket scales (2^k) are exact steps, so tiles are rendered at exactly their
 * bucket scale; the fit preview is rendered at its quantised fit scale and the
 * fit-page view snaps to that same scale, so both are drawn 1:1 (Story 3.2 AC 4).
 */
export const SCALE_STEPS_PER_OCTAVE = 1024;

/**
 * The quantisation step of a device scale: the smallest integer n with
 * 2^(n / SCALE_STEPS_PER_OCTAVE) >= scale (a 1e-4 step tolerance keeps exact steps on
 * their own step). Rasters are rendered at `stepScale(scaleStep(s))`, never below
 * `s`, so windows whose fit scales differ slightly still share cached rasters.
 */
export function scaleStep(scale: number): number {
  if (!(scale > 0)) throw new RangeError("scale must be positive");
  return Math.ceil(Math.log2(scale) * SCALE_STEPS_PER_OCTAVE - 1e-4) + 0;
}

/** The device scale of quantisation step `step`. */
export function stepScale(step: number): number {
  return 2 ** (step / SCALE_STEPS_PER_OCTAVE);
}

/** `scale` rounded up to its quantisation step. */
export function quantizeScale(scale: number): number {
  return stepScale(scaleStep(scale));
}

/**
 * The bucket for a view's device scale (zoom x dpr, device px per point): the
 * smallest k with 2^k >= deviceScale (a 1e-6 tolerance keeps exact powers on
 * their own bucket), clamped.
 */
export function bucketForScale(deviceScale: number): number {
  if (!(deviceScale > 0)) throw new RangeError("scale must be positive");
  const k = Math.ceil(Math.log2(deviceScale) - 1e-6);
  // "+ 0" turns -0 (ceil of a tiny negative) into 0.
  return Math.min(MAX_BUCKET, Math.max(MIN_BUCKET, k)) + 0;
}

export type TileGrid = {
  /** Device px per point. */
  scale: number;
  tileSize: number;
  /** The page in device px at this scale (rounded up). */
  width: number;
  height: number;
  cols: number;
  rows: number;
};

export function tileGrid(page: Size, scale: number, tileSize = DEFAULT_TILE_SIZE): TileGrid {
  if (!(scale > 0)) throw new RangeError("scale must be positive");
  if (!Number.isInteger(tileSize) || tileSize <= 0) throw new RangeError("tileSize must be a positive integer");
  const width = Math.max(1, Math.ceil(page.width * scale));
  const height = Math.max(1, Math.ceil(page.height * scale));
  return { scale, tileSize, width, height, cols: Math.ceil(width / tileSize), rows: Math.ceil(height / tileSize) };
}

/** Device-pixel rectangle of tile (col, row); edge tiles are clipped to the page. */
export function tileRect(grid: TileGrid, col: number, row: number): { x: number; y: number; width: number; height: number } {
  const x = col * grid.tileSize;
  const y = row * grid.tileSize;
  return { x, y, width: Math.min(grid.tileSize, grid.width - x), height: Math.min(grid.tileSize, grid.height - y) };
}

export type TileRef = {
  col: number;
  row: number;
  /** True when the tile intersects the viewport (false for margin tiles). */
  inView: boolean;
  /** Distance of the tile centre from the viewport centre, in tiles. */
  distance: number;
};

/** The tile columns and rows a view covers (inclusive; empty when c0 > c1 or r0 > r1). */
export type TileRange = {
  /** The viewport itself, not clamped to the page. */
  view: { c0: number; r0: number; c1: number; r1: number };
  /** With the margin ring, clamped to the grid: the tiles to visit. */
  c0: number;
  r0: number;
  c1: number;
  r1: number;
  /** The viewport centre in tiles. */
  cx: number;
  cy: number;
};

/**
 * The tile range of `view` at `grid` plus a `margin`-tile ring, clamped to the
 * page. Cheap (no allocation per tile): the per-frame draw loop uses it directly.
 */
export function tileRange(view: View, viewport: Size, grid: TileGrid, margin = 0): TileRange {
  if (!(view.scale > 0)) throw new RangeError("view.scale must be positive");
  // Viewport in page points, then in device px of this grid.
  const x0 = view.x * grid.scale;
  const y0 = view.y * grid.scale;
  const x1 = (view.x + viewport.width / view.scale) * grid.scale;
  const y1 = (view.y + viewport.height / view.scale) * grid.scale;
  const t = grid.tileSize;
  const c0 = Math.floor(x0 / t);
  const r0 = Math.floor(y0 / t);
  const c1 = Math.ceil(x1 / t) - 1;
  const r1 = Math.ceil(y1 / t) - 1;
  return {
    view: { c0, r0, c1, r1 },
    c0: Math.max(0, c0 - margin),
    r0: Math.max(0, r0 - margin),
    c1: Math.min(grid.cols - 1, c1 + margin),
    r1: Math.min(grid.rows - 1, r1 + margin),
    cx: (x0 + x1) / 2 / t,
    cy: (y0 + y1) / 2 / t,
  };
}

/**
 * Tiles needed for `view` at `grid`: those intersecting the viewport plus a
 * `margin`-tile ring (pre-fetch for panning), clamped to the page. Ordered by
 * priority: in-view tiles first, then by distance from the viewport centre
 * (centre first); ties break by row, then column, so the order is stable.
 */
export function visibleTiles(view: View, viewport: Size, grid: TileGrid, margin = 1): TileRef[] {
  const range = tileRange(view, viewport, grid, margin);
  const { c0, r0, c1, r1 } = range.view;
  const out: TileRef[] = [];
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      const inView = col >= c0 && col <= c1 && row >= r0 && row <= r1;
      const distance = Math.hypot(col + 0.5 - range.cx, row + 0.5 - range.cy);
      out.push({ col, row, inView, distance });
    }
  }
  out.sort((a, b) => Number(b.inView) - Number(a.inView) || a.distance - b.distance || a.row - b.row || a.col - b.col);
  return out;
}

/** Cache key of a tile: page (1-based), bucket, column, row. */
export function tileKey(page: number, bucket: number, col: number, row: number): string {
  return `${page}:${bucket}:${col}:${row}`;
}

/** Bytes of an RGBA bitmap. */
export function bitmapBytes(width: number, height: number): number {
  return width * height * 4;
}

/**
 * Least-recently-used cache with a byte budget. `get` refreshes an entry;
 * `set` inserts or replaces it and evicts the oldest entries until the total is
 * within budget. An entry larger than the whole budget is not kept (it is
 * evicted at once and the other entries stay).
 * `onEvict` runs for every value that leaves the cache (eviction, replacement,
 * delete, clear), so the owner can release it (ImageBitmap.close()).
 */
export class LruByteCache<V> {
  readonly budget: number;
  private readonly map = new Map<string, { value: V; bytes: number }>();
  private total = 0;
  private readonly onEvict?: (key: string, value: V) => void;

  constructor(budgetBytes: number, onEvict?: (key: string, value: V) => void) {
    if (!(budgetBytes >= 0)) throw new RangeError("budget must be >= 0");
    this.budget = budgetBytes;
    this.onEvict = onEvict;
  }

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Returns the value and marks it most recently used. */
  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** Returns the value without changing its recency. */
  peek(key: string): V | undefined {
    return this.map.get(key)?.value;
  }

  /** Inserts (most recently used) and evicts; returns the evicted keys in eviction order. */
  set(key: string, value: V, bytes: number): string[] {
    if (!(bytes >= 0)) throw new RangeError("bytes must be >= 0");
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.total -= old.bytes;
      if (old.value !== value) this.onEvict?.(key, old.value);
    }
    if (bytes > this.budget) {
      this.onEvict?.(key, value);
      return [key];
    }
    this.map.set(key, { value, bytes });
    this.total += bytes;
    const evicted: string[] = [];
    for (const [k, entry] of this.map) {
      if (this.total <= this.budget) break;
      this.map.delete(k);
      this.total -= entry.bytes;
      evicted.push(k);
      this.onEvict?.(k, entry.value);
    }
    return evicted;
  }

  /** Removes and returns the value without `onEvict`: the caller owns it again. */
  take(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.total -= entry.bytes;
    return entry.value;
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.total -= entry.bytes;
    this.onEvict?.(key, entry.value);
    return true;
  }

  clear(): void {
    for (const [k, entry] of this.map) this.onEvict?.(k, entry.value);
    this.map.clear();
    this.total = 0;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
