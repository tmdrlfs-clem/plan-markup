// Snapping on the main thread (Story 4.1, FR29, UX-DR14).
//
// Each page's segments and index are built in the render worker
// (snap.buildIndex) and arrive as transferred buffers; queries run here,
// synchronously, inside the pointer's animation frame (p95 < 0.1 ms on L17).
// Indices are kept per document (sha256) and page in a small memory cache
// shared by the tabs, within a byte budget. The status bar's snap toggles
// (3.7 snap-settings) choose the sources: content = the drawing's linework,
// markup and grid = their sources (empty until markups and a grid exist).

import { SnapIndex, indexSource, snapIndexBytes } from "@/core/snap/index";
import { resolveSnap, type Point, type SnapResult, type SnapSource } from "@/core/snap/resolve";
import type { SnapIndexResult } from "@/workers/render-protocol";

import { snapSettings, type SnapSettings } from "./status/snap-settings";
import type { ViewerTool } from "./viewer-store";

/**
 * Tools that place points (drawing and measuring): they snap; Select, Pan and Zoom never do,
 * nor Count (Story 4.8, D8: a count marks where it is clicked).
 */
const SNAPPING_TOOLS: ReadonlySet<ViewerTool> = new Set<ViewerTool>([
  "length",
  "polylength",
  "area",
  "angle",
  "radius",
  "diameter",
  "calibrate",
  // Story 5.4: the straight-line markups.
  "line",
  "arrow",
  "polyline",
  "polygon",
  // Story 5.5: the box tools and Cloud.
  "rectangle",
  "ellipse",
  "cloud",
  // Story 5.6: the text tools.
  "text",
  "callout",
  "typewriter",
  "note",
  "cloudplus",
  // Story 5.8: Dimension (Image's click is where its centre goes, unsnapped).
  "dimension",
]);

export function isSnappingTool(tool: ViewerTool): boolean {
  return SNAPPING_TOOLS.has(tool);
}

/** Snap distance on screen (CSS px), as in the prototype and Revu. */
export const SNAP_TOLERANCE_PX = 12;

/** Memory for page indices across documents and tabs (L17's is ~15 MB). */
export const SNAP_CACHE_BUDGET = 160 * 1024 * 1024;

type Entry = { index: SnapIndex; bytes: number; stats: SnapIndexStats };
export type SnapIndexStats = { count: number; truncated: boolean; opListMs: number; extractMs: number; buildMs: number; bytes: number };

/** Indices by `${sha256}:${page}`, least recently used first. */
const cache = new Map<string, Entry>();
let cacheBytes = 0;

function remember(key: string, entry: Entry): void {
  const old = cache.get(key);
  if (old) cacheBytes -= old.bytes;
  cache.delete(key);
  cache.set(key, entry);
  cacheBytes += entry.bytes;
  for (const [k, e] of cache) {
    if (cacheBytes <= SNAP_CACHE_BUDGET || k === key) break;
    cache.delete(k);
    cacheBytes -= e.bytes;
  }
}

/** Engines showing each document (review S2): its indices go when the last one leaves. */
const openDocuments = new Map<string, number>();

function holdDocument(sha: string): void {
  openDocuments.set(sha, (openDocuments.get(sha) ?? 0) + 1);
}

function releaseDocument(sha: string): void {
  const n = (openDocuments.get(sha) ?? 1) - 1;
  if (n > 0) {
    openDocuments.set(sha, n);
    return;
  }
  openDocuments.delete(sha);
  for (const [key, entry] of cache) {
    if (!key.startsWith(`${sha}:`)) continue;
    cache.delete(key);
    cacheBytes -= entry.bytes;
  }
}

/** Forgets every index (tests). */
export function clearSnapCache(): void {
  cache.clear();
  cacheBytes = 0;
  openDocuments.clear();
}

export function snapCacheBytes(): number {
  return cacheBytes;
}

/** Sources besides the drawing (Story 4.1 AC 5): markups (Epic 5) and the grid register here. */
export const extraSnapSources: { markup: SnapSource | null; grid: SnapSource | null } = { markup: null, grid: null };

export type SnapRequest = (page: number) => { promise: Promise<SnapIndexResult>; cancel: () => void };

/** One document's snapping (one per ViewerEngine, so per tab). */
export class SnapController {
  private sha: string | null = null;
  private readonly pending = new Map<number, () => void>();
  private failed = new Set<number>();

  constructor(
    private readonly request: SnapRequest,
    private readonly onReady: (page: number) => void = () => undefined,
  ) {}

  /** A new document (or none). */
  setDocument(sha: string | null): void {
    this.cancel();
    this.failed = new Set();
    if (sha === this.sha) return;
    if (this.sha !== null) releaseDocument(this.sha);
    this.sha = sha;
    if (sha !== null) holdDocument(sha);
  }

  /**
   * Makes sure the index of `page` (0-based) is built or being built and,
   * with `neighbours`, then the pages next to it, one at a time (lowest
   * priority in the worker). Neighbours are only worth it while a snapping
   * tool is armed: pdf.js reads their operator lists in its one parser
   * worker, where they would delay the preview of a page the user goes to
   * (review S1).
   */
  ensure(page: number, pageCount: number, neighbours = false): void {
    if (this.sha === null) return;
    const order = (neighbours ? [page, page + 1, page - 1] : [page]).filter((p) => p >= 0 && p < pageCount);
    const next = order.find((p) => !this.has(p) && !this.failed.has(p));
    if (next === undefined || this.pending.has(next)) return;
    // Only one build at a time: a neighbour waits for the current page.
    if (this.pending.size > 0 && next !== page) return;
    const sha = this.sha;
    const call = this.request(next + 1);
    this.pending.set(next, call.cancel);
    call.promise.then(
      (result) => {
        if (this.pending.get(next) !== call.cancel) return;
        this.pending.delete(next);
        if (this.sha !== sha) return;
        const bytes = snapIndexBytes(result);
        remember(`${sha}:${next}`, {
          index: new SnapIndex(result),
          bytes,
          stats: { count: result.count, truncated: result.truncated, opListMs: result.opListMs, extractMs: result.extractMs, buildMs: result.buildMs, bytes },
        });
        this.onReady(next);
        this.ensure(page, pageCount, neighbours);
      },
      () => {
        if (this.pending.get(next) !== call.cancel) return;
        this.pending.delete(next);
        // A cancelled build is asked again later; a failed page is not retried this session.
        if (this.sha === sha) this.failed.add(next);
      },
    );
  }

  /** Stops every build in flight (page change, background tab, close). */
  cancel(): void {
    for (const cancel of this.pending.values()) cancel();
    this.pending.clear();
  }

  /** Builds in flight (tests, diagnostics). */
  get building(): number {
    return this.pending.size;
  }

  has(page: number): boolean {
    return this.sha !== null && cache.has(`${this.sha}:${page}`);
  }

  /** Story 4.10: the page's linework (Dynamic fill's walls), null until its index is built. */
  segments(page: number): { coords: Float64Array; count: number } | null {
    const entry = this.sha === null ? undefined : cache.get(`${this.sha}:${page}`);
    return entry ? { coords: entry.index.data.coords, count: entry.index.data.count } : null;
  }

  stats(page: number): SnapIndexStats | null {
    return this.sha === null ? null : (cache.get(`${this.sha}:${page}`)?.stats ?? null);
  }

  /**
   * The snap for the cursor at `point` (user space) on `page`, with the
   * tolerance in user units; null when nothing is near or every source is off.
   */
  resolve(page: number, point: Point, tolerance: number, from: Point | null, settings: SnapSettings = snapSettings.getState()): SnapResult | null {
    const sources: SnapSource[] = [];
    if (settings.content && this.sha !== null) {
      const entry = cache.get(`${this.sha}:${page}`);
      if (entry) {
        // Recently used.
        cache.delete(`${this.sha}:${page}`);
        cache.set(`${this.sha}:${page}`, entry);
        sources.push(indexSource(entry.index));
      }
    }
    if (settings.markup && extraSnapSources.markup) sources.push(extraSnapSources.markup);
    if (settings.grid && extraSnapSources.grid) sources.push(extraSnapSources.grid);
    if (sources.length === 0) return null;
    return resolveSnap({ point, tolerance, sources, from });
  }
}
