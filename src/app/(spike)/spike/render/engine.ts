// Render-spike viewer engine (Story 2.3; throwaway). Plain class, no React state
// per frame: a rAF loop redraws only the dirty layers of the canvas stack
// (1 tiles, 2 static markups, 3 active/hover). Tiles come from the render worker;
// during a gesture the existing tiles are scaled, new ones are requested once
// the view has been still for SETTLE_MS.
import {
  LruByteCache,
  bitmapBytes,
  bucketForScale,
  bucketScale,
  fitScale,
  tileGrid,
  tileKey,
  visibleTiles,
  type Size,
  type View,
} from "@/core/render/tiles";
import { renderOpenRequest, type PageInfo, type RenderWorkerReply, type TileReply } from "@/workers/render.worker";
import type RBush from "rbush";
import { drawHighlight, drawMarkups, generateMarkups, indexMarkups, type Markup } from "./markups";

const SETTLE_MS = 150;
const PAGE = 1;

export type EngineOptions = {
  tileSize: number;
  pdfjsWorker: "inline" | "nested";
  budgetBytes: number;
  markupCount: number;
  /** Ask the worker for progressive preview snapshots while the preview renders. */
  progressive: boolean;
};

type CachedTile = { bitmap: ImageBitmap; x: number; y: number; width: number; height: number; scale: number; bucket: number };

export type SpikeStats = {
  frameDeltas: number[];
  longTasks: { start: number; duration: number }[];
  tileRenders: { bucket: number; renderMs: number; waitMs: number; preview: boolean; partial: boolean; px: number }[];
  peakCacheBytes: number;
  peakHeapBytes: number;
  marks: Record<string, number>;
  markupDrawMs: number[];
  tilesDrawMs: number[];
};

const emptyStats = (): SpikeStats => ({
  frameDeltas: [],
  longTasks: [],
  tileRenders: [],
  peakCacheBytes: 0,
  peakHeapBytes: 0,
  marks: {},
  markupDrawMs: [],
  tilesDrawMs: [],
});

export class SpikeEngine {
  private readonly worker: Worker;
  private reqSeq = 1;
  private openReqId = 0;
  private page: PageInfo | null = null;
  private fit = 1;
  private dpr = 1;
  private viewport: Size = { width: 1, height: 1 };
  view: View = { scale: 1, x: 0, y: 0 };
  private preview: CachedTile | null = null;
  private previewFinal = false;
  private firstPartialAt: number | null = null;
  private readonly cache: LruByteCache<CachedTile>;
  private readonly inflight = new Map<string, number>(); // key -> reqId
  private readonly reqKey = new Map<number, string>(); // reqId -> key
  private settledBucket: number | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private markups: Markup[] = [];
  private tree: RBush<Markup> | null = null;
  private hover: Markup | null = null;
  private dirtyTiles = true;
  private dirtyMarkups = true;
  private dirtyActive = true;
  private raf = 0;
  private lastFrame = 0;
  private recording = false;
  private destroyed = false;
  private firstTileResolve: (() => void) | null = null;
  private openResolve: ((pages: PageInfo[]) => void) | null = null;
  private openReject: ((e: Error) => void) | null = null;
  private longTaskObserver: PerformanceObserver | null = null;
  stats: SpikeStats = emptyStats();
  status = "idle";
  onStatus: ((s: string) => void) | null = null;

  constructor(
    private readonly tilesCanvas: HTMLCanvasElement,
    private readonly markupsCanvas: HTMLCanvasElement,
    private readonly activeCanvas: HTMLCanvasElement,
    readonly options: EngineOptions,
  ) {
    this.cache = new LruByteCache<CachedTile>(options.budgetBytes, (_k, t) => t.bitmap.close());
    this.worker = new Worker(new URL("../../../../workers/render.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (e: MessageEvent<RenderWorkerReply<ImageBitmap>>) => this.onReply(e.data));
    this.worker.addEventListener("error", (e) => this.setStatus(`worker error: ${e.message}`));
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.stats.longTasks.push({ start: entry.startTime, duration: entry.duration });
      });
      this.longTaskObserver.observe({ type: "longtask", buffered: false });
    } catch {
      this.longTaskObserver = null;
    }
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  private setStatus(s: string): void {
    this.status = s;
    this.onStatus?.(s);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.longTaskObserver?.disconnect();
    this.worker.terminate();
    this.cache.clear();
    this.preview?.bitmap.close();
  }

  /** Sizes the three canvases to the viewport x DPR. */
  resize(): void {
    const rect = this.tilesCanvas.parentElement?.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.viewport = { width: Math.max(1, rect?.width ?? 1), height: Math.max(1, rect?.height ?? 1) };
    for (const c of [this.tilesCanvas, this.markupsCanvas, this.activeCanvas]) {
      c.width = Math.round(this.viewport.width * this.dpr);
      c.height = Math.round(this.viewport.height * this.dpr);
    }
    if (this.page) this.fit = fitScale(this.page, this.viewport, 16);
    this.invalidate(true);
  }

  // ---- open -------------------------------------------------------------

  /** Opens PDF bytes; resolves when the first (preview) tile has been painted. */
  async open(bytes: Uint8Array<ArrayBuffer>): Promise<{ openMs: number; firstTileMs: number; firstPartialMs: number | null }> {
    this.resetDocument();
    this.stats = emptyStats();
    performance.mark("spike:bytes");
    const t0 = performance.now();
    this.stats.marks.bytes = t0;
    this.setStatus("opening");
    const reqId = this.reqSeq++;
    this.openReqId = reqId;
    const opened = new Promise<PageInfo[]>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
    });
    const firstTile = new Promise<void>((resolve) => (this.firstTileResolve = resolve));
    // Preview: the whole page fitted into the viewport (fit bucket, device px).
    const box = { maxWidth: (this.viewport.width - 32) * this.dpr, maxHeight: (this.viewport.height - 32) * this.dpr };
    this.worker.postMessage(
      ...renderOpenRequest(
        reqId,
        bytes,
        { page: PAGE, bucket: 0, ...box, progressive: this.options.progressive },
        { pdfjsWorker: this.options.pdfjsWorker },
      ),
    );
    const pages = await opened;
    const openMs = performance.now() - t0;
    this.page = pages[0];
    this.fit = fitScale(this.page, this.viewport, 16);
    this.view = this.fitView();
    this.markups = generateMarkups(this.options.markupCount, this.page.width, this.page.height);
    this.tree = indexMarkups(this.markups);
    this.invalidate(true);
    await firstTile;
    const firstTileMs = performance.now() - t0;
    this.setStatus("ready");
    this.scheduleSettle(0);
    const firstPartialMs = this.firstPartialAt === null ? null : this.firstPartialAt - t0;
    return { openMs, firstTileMs, firstPartialMs };
  }

  fitView(): View {
    if (!this.page) return { scale: 1, x: 0, y: 0 };
    const scale = this.fit;
    return {
      scale,
      x: -(this.viewport.width / scale - this.page.width) / 2,
      y: -(this.viewport.height / scale - this.page.height) / 2,
    };
  }

  private resetDocument(): void {
    if (this.openReqId) this.worker.postMessage({ type: "cancel", all: true });
    this.cache.clear();
    this.inflight.clear();
    this.reqKey.clear();
    this.preview?.bitmap.close();
    this.preview = null;
    this.previewFinal = false;
    this.firstPartialAt = null;
    this.page = null;
    this.settledBucket = null;
    this.hover = null;
  }

  // ---- worker replies ---------------------------------------------------

  private onReply(reply: RenderWorkerReply<ImageBitmap>): void {
    if (this.destroyed) return;
    switch (reply.type) {
      case "opened":
        if (reply.reqId === this.openReqId) this.openResolve?.(reply.pages);
        break;
      case "tile":
        this.onTile(reply);
        break;
      case "cancelled": {
        const key = this.reqKey.get(reply.reqId);
        this.reqKey.delete(reply.reqId);
        if (key && this.inflight.get(key) === reply.reqId) this.inflight.delete(key);
        break;
      }
      case "error":
        if (reply.reqId === this.openReqId) this.openReject?.(new Error(reply.error.message));
        this.setStatus(`error: ${reply.error.message}`);
        if (reply.reqId !== null) {
          const key = this.reqKey.get(reply.reqId);
          if (key) this.inflight.delete(key);
          this.reqKey.delete(reply.reqId);
        }
        break;
      default:
        break;
    }
  }

  private onTile(t: TileReply<ImageBitmap>): void {
    this.stats.tileRenders.push({
      bucket: t.preview ? -99 : t.bucket,
      renderMs: t.renderMs,
      waitMs: t.waitMs,
      preview: t.preview,
      partial: t.partial,
      px: t.width * t.height,
    });
    const tile: CachedTile = { bitmap: t.bitmap, x: t.x, y: t.y, width: t.width, height: t.height, scale: t.scale, bucket: t.bucket };
    if (t.preview) {
      // Snapshots can resolve after the finished preview: never let one replace it.
      if (t.reqId !== this.openReqId || (t.partial && this.previewFinal)) {
        t.bitmap.close();
        return;
      }
      this.preview?.bitmap.close();
      this.preview = tile;
      this.invalidate(false);
      if (t.partial) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (this.firstPartialAt === null) {
              performance.mark("spike:first-partial");
              this.firstPartialAt = performance.now();
            }
          }),
        );
        return;
      }
      this.previewFinal = true;
      // Painted on the next frame: resolve after it.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this.stats.marks.firstTile) {
            performance.mark("spike:first-tile");
            this.stats.marks.firstTile = performance.now();
          }
          this.firstTileResolve?.();
          this.firstTileResolve = null;
        });
      });
      return;
    }
    const key = tileKey(PAGE, t.bucket, t.col, t.row);
    this.reqKey.delete(t.reqId);
    if (this.inflight.get(key) === t.reqId) this.inflight.delete(key);
    this.cache.set(key, tile, bitmapBytes(t.width, t.height));
    this.stats.peakCacheBytes = Math.max(this.stats.peakCacheBytes, this.cache.bytes);
    this.invalidate(false);
    if (this.inflight.size === 0) this.idleWaiters.splice(0).forEach((r) => r());
  }

  private readonly idleWaiters: (() => void)[] = [];

  /** Resolves when no tile request is in flight and the view has settled. */
  waitTilesIdle(timeoutMs = 60_000): Promise<boolean> {
    return new Promise((resolve) => {
      const start = performance.now();
      const check = () => {
        if (this.inflight.size === 0 && !this.settleTimer) return resolve(true);
        if (performance.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    });
  }

  // ---- view changes -----------------------------------------------------

  /** Pans by CSS px. */
  panBy(dx: number, dy: number): void {
    this.view = { ...this.view, x: this.view.x - dx / this.view.scale, y: this.view.y - dy / this.view.scale };
    this.onViewChange();
  }

  /** Zooms by `factor` keeping the page point under (cx, cy) CSS px fixed. */
  zoomAt(factor: number, cx: number, cy: number): void {
    const min = this.fit / 4;
    const max = this.fit * 8;
    const scale = Math.min(max, Math.max(min, this.view.scale * factor));
    const px = this.view.x + cx / this.view.scale;
    const py = this.view.y + cy / this.view.scale;
    this.view = { scale, x: px - cx / scale, y: py - cy / scale };
    this.onViewChange();
  }

  setView(view: View): void {
    this.view = view;
    this.onViewChange();
  }

  get fitScale(): number {
    return this.fit;
  }

  get viewportSize(): Size {
    return this.viewport;
  }

  private onViewChange(): void {
    this.invalidate(true);
    this.scheduleSettle(SETTLE_MS);
  }

  private scheduleSettle(ms: number): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.requestTiles();
    }, ms);
  }

  /** Requests the visible tiles of the current bucket and cancels stale requests. */
  private requestTiles(): void {
    if (!this.page) return;
    const bucket = bucketForScale(this.view.scale, this.fit);
    const scale = bucketScale(this.fit, bucket, this.dpr);
    const grid = tileGrid(this.page, scale, this.options.tileSize);
    const needed = visibleTiles(this.view, this.viewport, grid, 1);
    const neededKeys = new Set(needed.map((t) => tileKey(PAGE, bucket, t.col, t.row)));
    const stale: number[] = [];
    for (const [key, reqId] of this.inflight) {
      if (!neededKeys.has(key)) {
        stale.push(reqId);
        this.inflight.delete(key);
      }
    }
    if (stale.length > 0) this.worker.postMessage({ type: "cancel", reqIds: stale });
    for (const t of needed) {
      const key = tileKey(PAGE, bucket, t.col, t.row);
      if (this.cache.has(key)) {
        this.cache.get(key); // refresh recency
        continue;
      }
      if (this.inflight.has(key)) continue;
      const reqId = this.reqSeq++;
      this.inflight.set(key, reqId);
      this.reqKey.set(reqId, key);
      this.worker.postMessage({ type: "renderTile", reqId, page: PAGE, bucket, scale, col: t.col, row: t.row, tileSize: this.options.tileSize });
    }
    this.settledBucket = bucket;
    this.invalidate(false);
    if (this.inflight.size === 0) this.idleWaiters.splice(0).forEach((r) => r());
  }

  // ---- hover ------------------------------------------------------------

  hoverAt(cx: number, cy: number): void {
    if (!this.tree) return;
    const px = this.view.x + cx / this.view.scale;
    const py = this.view.y + cy / this.view.scale;
    const tol = 4 / this.view.scale;
    const hits = this.tree.search({ minX: px - tol, minY: py - tol, maxX: px + tol, maxY: py + tol });
    const top = hits.length > 0 ? hits.reduce((a, b) => (b.id > a.id ? b : a)) : null;
    if (top !== this.hover) {
      this.hover = top;
      this.dirtyActive = true;
    }
  }

  // ---- drawing ----------------------------------------------------------

  private invalidate(markups: boolean): void {
    this.dirtyTiles = true;
    if (markups) {
      this.dirtyMarkups = true;
      this.dirtyActive = true;
    }
  }

  private readonly frame = (now: number): void => {
    if (this.destroyed) return;
    if (this.recording && this.lastFrame > 0) this.stats.frameDeltas.push(now - this.lastFrame);
    this.lastFrame = now;
    this.tick?.(now);
    if (this.dirtyTiles) {
      const t0 = performance.now();
      this.drawTiles();
      if (this.recording) this.stats.tilesDrawMs.push(performance.now() - t0);
      this.dirtyTiles = false;
    }
    if (this.dirtyMarkups) {
      const t0 = performance.now();
      this.drawMarkupLayer();
      if (this.recording) this.stats.markupDrawMs.push(performance.now() - t0);
      this.dirtyMarkups = false;
    }
    if (this.dirtyActive) {
      this.drawActive();
      this.dirtyActive = false;
    }
    if (this.recording) {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) this.stats.peakHeapBytes = Math.max(this.stats.peakHeapBytes, mem.usedJSHeapSize);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Per-frame hook for scripted gestures (measurement). */
  tick: ((now: number) => void) | null = null;

  /** Page px (device px at `tileScale`) rectangle -> canvas device px, edges rounded so tiles do not seam. */
  private placeTile(ctx: CanvasRenderingContext2D, t: CachedTile): void {
    const k = this.view.scale * this.dpr;
    const x0 = Math.round((t.x / t.scale - this.view.x) * k);
    const y0 = Math.round((t.y / t.scale - this.view.y) * k);
    const x1 = Math.round(((t.x + t.width) / t.scale - this.view.x) * k);
    const y1 = Math.round(((t.y + t.height) / t.scale - this.view.y) * k);
    if (x1 <= 0 || y1 <= 0 || x0 >= this.tilesCanvas.width || y0 >= this.tilesCanvas.height) return;
    ctx.drawImage(t.bitmap, x0, y0, x1 - x0, y1 - y0);
  }

  private drawTiles(): void {
    const ctx = this.tilesCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(0, 0, this.tilesCanvas.width, this.tilesCanvas.height);
    if (!this.page) return;
    const k = this.view.scale * this.dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-this.view.x * k, -this.view.y * k, this.page.width * k, this.page.height * k);
    ctx.imageSmoothingEnabled = true;
    if (this.preview) this.placeTile(ctx, this.preview);
    // Settled bucket first (scaled during a gesture), then the target bucket on top.
    const target = bucketForScale(this.view.scale, this.fit);
    const buckets = this.settledBucket !== null && this.settledBucket !== target ? [this.settledBucket, target] : [target];
    for (const bucket of buckets) {
      const scale = bucketScale(this.fit, bucket, this.dpr);
      const grid = tileGrid(this.page, scale, this.options.tileSize);
      for (const ref of visibleTiles(this.view, this.viewport, grid, 0)) {
        const t = this.cache.peek(tileKey(PAGE, bucket, ref.col, ref.row));
        if (t) this.placeTile(ctx, t);
      }
    }
  }

  private visibleMarkups(): Markup[] {
    if (!this.tree) return [];
    const v = this.view;
    return this.tree.search({
      minX: v.x,
      minY: v.y,
      maxX: v.x + this.viewport.width / v.scale,
      maxY: v.y + this.viewport.height / v.scale,
    });
  }

  private pageTransform(ctx: CanvasRenderingContext2D): number {
    const k = this.view.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, -this.view.x * k, -this.view.y * k);
    return k;
  }

  private drawMarkupLayer(): void {
    const ctx = this.markupsCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.markupsCanvas.width, this.markupsCanvas.height);
    if (!this.tree) return;
    const k = this.pageTransform(ctx);
    drawMarkups(ctx, this.visibleMarkups(), k);
  }

  private drawActive(): void {
    const ctx = this.activeCanvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    if (!this.hover) return;
    const k = this.pageTransform(ctx);
    drawHighlight(ctx, this.hover, k);
  }

  // ---- measurement ------------------------------------------------------

  startRecording(): void {
    this.stats = { ...emptyStats(), marks: this.stats.marks, peakCacheBytes: this.cache.bytes };
    this.lastFrame = 0;
    this.recording = true;
  }

  stopRecording(): SpikeStats {
    this.recording = false;
    return this.stats;
  }

  get cacheBytes(): number {
    return this.cache.bytes;
  }

  get markupTotal(): number {
    return this.markups.length;
  }
}
