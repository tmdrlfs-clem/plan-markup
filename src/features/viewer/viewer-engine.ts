// Viewer engine (Story 3.1; from the Story 2.3 spike engine). A plain class,
// no React state per tile: it owns the canvas stack (1 tiles, 2 static
// markups, 3 active), the view transform, the in-memory tile LRU and the
// render worker client, and redraws only on demand (one rAF per change).
//
// Open: file bytes -> render.open (bytes transferred) -> render.preview
// (whole page at the fit size, progressive snapshots) -> tiles of the current
// zoom bucket where the preview is not already sharp enough. The view is
// "fit page" on open and on resize; Story 3.2 adds input that calls setView().

import {
  DEFAULT_TILE_SIZE,
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
import type { PageInfo, TilePayload } from "@/workers/render-protocol";
import { WorkerRequestError, type RenderClient } from "@/workers/rpc";

import type { ViewerErrorCode, ViewerState } from "./viewer-store";

/** CSS px kept free around the page at fit. */
export const FIT_PADDING = 16;
/** Delay before tiles are requested after the view changed (a gesture settling). */
const SETTLE_MS = 150;
const BACKDROP = "#e5e7eb";
const PAGE = "#ffffff";

export type ViewerCanvases = { tiles: HTMLCanvasElement; markups: HTMLCanvasElement; active: HTMLCanvasElement };

export type ViewerEngineOptions = {
  tileSize?: number;
  /** In-memory tile budget in bytes (2.3 report: 256 MB). */
  budgetBytes?: number;
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
};

type Tile = { bitmap: ImageBitmap; x: number; y: number; width: number; height: number; scale: number };

/** The bitmap fields the engine needs (ImageBitmap in the app, plain objects in tests). */
const closeBitmap = (b: ImageBitmap) => {
  try {
    b.close();
  } catch {
    // Already closed or not closable.
  }
};

function viewerErrorOf(e: unknown): ViewerErrorCode {
  if (e instanceof WorkerRequestError && (e.code === "invalid-pdf" || e.code === "password-required")) return e.code;
  return "render-failed";
}

export class ViewerEngine {
  private readonly tileSize: number;
  private readonly cache: LruByteCache<Tile>;
  private readonly now: () => number;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrame: (id: number) => void;

  private viewport: Size = { width: 1, height: 1 };
  private dpr = 1;
  private page: PageInfo | null = null;
  private fit = 1;
  /** The view; `fitMode` keeps it fitted on resize until 3.2's input changes it. */
  view: View = { scale: 1, x: 0, y: 0 };
  private fitMode = true;

  private preview: Tile | null = null;
  private previewFinal = false;
  /** Bumped per open: replies for an older document are dropped. */
  private generation = 0;
  private openReq: number | null = null;
  private previewReq: number | null = null;
  private readonly inflight = new Map<string, number>(); // tile key -> reqId
  private readonly failed = new Set<string>();
  private settledBucket: number | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private openedAt = 0;
  private destroyed = false;

  constructor(
    private readonly canvases: ViewerCanvases,
    private readonly client: RenderClient,
    private readonly update: (patch: Partial<ViewerState>) => void,
    options: ViewerEngineOptions = {},
  ) {
    this.tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    this.cache = new LruByteCache<Tile>(options.budgetBytes ?? 256 * 1024 * 1024, (_k, t) => closeBitmap(t.bitmap));
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
  }

  // ---- lifecycle ----------------------------------------------------------

  destroy(): void {
    this.destroyed = true;
    if (this.frame !== null) this.cancelFrame(this.frame);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.resetDocument();
    this.client.terminate();
  }

  /** Sizes the canvases to the viewport (CSS px) x DPR; keeps "fit page" while in fit mode. */
  setViewport(width: number, height: number, dpr: number): void {
    this.viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    this.dpr = dpr > 0 ? dpr : 1;
    for (const c of Object.values(this.canvases)) {
      c.width = Math.max(1, Math.round(this.viewport.width * this.dpr));
      c.height = Math.max(1, Math.round(this.viewport.height * this.dpr));
    }
    if (this.page) {
      this.fit = fitScale(this.page, this.viewport, FIT_PADDING);
      if (this.fitMode) this.view = this.fitView();
      this.scheduleSettle(SETTLE_MS);
    }
    this.invalidate();
  }

  // ---- open ---------------------------------------------------------------

  /** Opens a file: reads it locally and hands the bytes to the render worker. */
  async open(file: File): Promise<void> {
    this.resetDocument();
    const generation = ++this.generation;
    this.openedAt = this.now();
    this.update({ status: "loading" });
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      if (generation === this.generation) this.update({ status: "error", error: "read-failed" });
      return;
    }
    if (generation !== this.generation) return;
    const open = this.client.request("render.open", { bytes }, { transfer: [bytes] });
    this.openReq = open.reqId;
    let opened;
    try {
      opened = await open.promise;
    } catch (e) {
      if (generation === this.generation && !(e instanceof WorkerRequestError && e.code === "cancelled")) {
        this.update({ status: "error", error: viewerErrorOf(e) });
      }
      return;
    } finally {
      if (this.openReq === open.reqId) this.openReq = null;
    }
    if (generation !== this.generation) return;
    this.page = opened.pages[0];
    this.fit = fitScale(this.page, this.viewport, FIT_PADDING);
    this.fitMode = true;
    this.view = this.fitView();
    this.update({ pageCount: opened.pageCount, pageIndex: 0 });
    this.invalidate();
    await this.loadPreview(generation);
  }

  private async loadPreview(generation: number): Promise<void> {
    const box = {
      maxWidth: Math.max(1, (this.viewport.width - 2 * FIT_PADDING) * this.dpr),
      maxHeight: Math.max(1, (this.viewport.height - 2 * FIT_PADDING) * this.dpr),
    };
    const call = this.client.request(
      "render.preview",
      { page: 1, ...box, progressive: true },
      {
        onProgress: ({ tile }) => {
          if (generation !== this.generation || this.previewFinal) return closeBitmap(tile.bitmap);
          this.setPreview(tile);
          if (this.timingsPartial === null) {
            this.timingsPartial = this.now() - this.openedAt;
            this.pendingPartial = true;
          }
        },
      },
    );
    this.previewReq = call.reqId;
    try {
      const { tile, content } = await call.promise;
      if (generation !== this.generation) return closeBitmap(tile.bitmap);
      this.setPreview(tile);
      this.previewFinal = true;
      this.pendingFirstFrame = true;
      this.update({ content });
      this.scheduleSettle(0);
    } catch (e) {
      if (generation !== this.generation || (e instanceof WorkerRequestError && e.code === "cancelled")) return;
      this.update({ status: "error", error: viewerErrorOf(e) });
    } finally {
      if (this.previewReq === call.reqId) this.previewReq = null;
    }
  }

  private timingsPartial: number | null = null;
  private pendingPartial = false;
  private pendingFirstFrame = false;

  private setPreview(t: TilePayload<ImageBitmap>): void {
    if (this.preview) closeBitmap(this.preview.bitmap);
    this.preview = { bitmap: t.bitmap, x: t.x, y: t.y, width: t.width, height: t.height, scale: t.scale };
    this.invalidate();
  }

  /** Drops everything of the current document (worker work, bitmaps, timers). */
  private resetDocument(): void {
    const ids = [...this.inflight.values()];
    if (this.openReq !== null) ids.push(this.openReq);
    if (this.previewReq !== null) ids.push(this.previewReq);
    this.client.cancel(ids);
    this.inflight.clear();
    this.failed.clear();
    this.cache.clear();
    if (this.preview) closeBitmap(this.preview.bitmap);
    this.preview = null;
    this.previewFinal = false;
    this.pendingFirstFrame = false;
    this.pendingPartial = false;
    this.timingsPartial = null;
    this.page = null;
    this.settledBucket = null;
    this.openReq = null;
    this.previewReq = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.invalidate();
  }

  // ---- view ---------------------------------------------------------------

  fitView(): View {
    if (!this.page) return { scale: 1, x: 0, y: 0 };
    const scale = this.fit;
    return {
      scale,
      x: -(this.viewport.width / scale - this.page.width) / 2,
      y: -(this.viewport.height / scale - this.page.height) / 2,
    };
  }

  /** Sets the view (Story 3.2's zoom and pan) and leaves fit mode. */
  setView(view: View): void {
    this.view = view;
    this.fitMode = false;
    this.invalidate();
    this.scheduleSettle(SETTLE_MS);
  }

  /** Back to "fit page" (Story 3.2's Fit page command). */
  fitPage(): void {
    this.fitMode = true;
    this.view = this.fitView();
    this.invalidate();
    this.scheduleSettle(SETTLE_MS);
  }

  get fitScale(): number {
    return this.fit;
  }

  // ---- tiles --------------------------------------------------------------

  private scheduleSettle(ms: number): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.requestTiles();
    }, ms);
  }

  /** Requests the visible tiles of the current bucket that the preview does not already cover. */
  requestTiles(): void {
    if (!this.page || !this.previewFinal || this.destroyed) return;
    const bucket = bucketForScale(this.view.scale, this.fit);
    const scale = bucketScale(this.fit, bucket, this.dpr);
    const grid = tileGrid(this.page, scale, this.tileSize);
    // The preview already holds this resolution (fit page): tiles would add nothing.
    const covered = this.preview !== null && this.preview.scale >= scale * 0.999;
    const needed = covered ? [] : visibleTiles(this.view, this.viewport, grid, 1);
    const neededKeys = new Set(needed.map((t) => tileKey(1, bucket, t.col, t.row)));
    const stale: number[] = [];
    for (const [key, reqId] of this.inflight) {
      if (!neededKeys.has(key)) {
        stale.push(reqId);
        this.inflight.delete(key);
      }
    }
    this.client.cancel(stale);
    for (const t of needed) {
      const key = tileKey(1, bucket, t.col, t.row);
      if (this.cache.has(key)) {
        this.cache.get(key);
        continue;
      }
      if (this.inflight.has(key) || this.failed.has(key)) continue;
      this.requestTile(key, { page: 1, bucket, scale, col: t.col, row: t.row, tileSize: this.tileSize });
    }
    this.settledBucket = bucket;
    this.invalidate();
  }

  private requestTile(key: string, payload: { page: number; bucket: number; scale: number; col: number; row: number; tileSize: number }): void {
    const generation = this.generation;
    const call = this.client.request("render.tile", payload);
    this.inflight.set(key, call.reqId);
    call.promise.then(
      ({ tile }) => {
        if (generation !== this.generation || this.inflight.get(key) !== call.reqId) return closeBitmap(tile.bitmap);
        this.inflight.delete(key);
        this.cache.set(key, { bitmap: tile.bitmap, x: tile.x, y: tile.y, width: tile.width, height: tile.height, scale: tile.scale }, bitmapBytes(tile.width, tile.height));
        this.invalidate();
      },
      (e: unknown) => {
        if (generation !== this.generation || this.inflight.get(key) !== call.reqId) return;
        this.inflight.delete(key);
        if (e instanceof WorkerRequestError && e.code === "cancelled") return;
        this.failed.add(key);
        this.update({ failedTiles: this.failed.size });
        this.invalidate();
      },
    );
  }

  /** Retries every failed tile (the render error state's Retry action). */
  retryFailedTiles(): void {
    this.failed.clear();
    this.update({ failedTiles: 0 });
    this.requestTiles();
  }

  /** Tiles waiting for the worker (tests, diagnostics). */
  get pendingTiles(): number {
    return this.inflight.size;
  }

  // ---- drawing ------------------------------------------------------------

  private invalidate(): void {
    if (this.destroyed || this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  /** Page rect (device px at tile.scale) -> canvas device px, edges rounded so tiles do not seam. */
  private placeTile(ctx: CanvasRenderingContext2D, t: Tile): void {
    const k = this.view.scale * this.dpr;
    const x0 = Math.round((t.x / t.scale - this.view.x) * k);
    const y0 = Math.round((t.y / t.scale - this.view.y) * k);
    const x1 = Math.round(((t.x + t.width) / t.scale - this.view.x) * k);
    const y1 = Math.round(((t.y + t.height) / t.scale - this.view.y) * k);
    if (x1 <= 0 || y1 <= 0 || x0 >= this.canvases.tiles.width || y0 >= this.canvases.tiles.height) return;
    ctx.drawImage(t.bitmap, x0, y0, x1 - x0, y1 - y0);
  }

  /** Grey hatched box for a failed tile (its Retry lives in the DOM overlay). */
  private drawFailed(ctx: CanvasRenderingContext2D, bucket: number, col: number, row: number): void {
    if (!this.page) return;
    const scale = bucketScale(this.fit, bucket, this.dpr);
    const grid = tileGrid(this.page, scale, this.tileSize);
    const k = (this.view.scale * this.dpr) / scale;
    const x = (col * grid.tileSize - this.view.x * scale) * k;
    const y = (row * grid.tileSize - this.view.y * scale) * k;
    const w = Math.min(grid.tileSize, grid.width - col * grid.tileSize) * k;
    const h = Math.min(grid.tileSize, grid.height - row * grid.tileSize) * k;
    ctx.save();
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.moveTo(x + w, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.restore();
  }

  private draw(): void {
    const ctx = this.canvases.tiles.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, this.canvases.tiles.width, this.canvases.tiles.height);
      if (this.page) {
        const k = this.view.scale * this.dpr;
        ctx.fillStyle = PAGE;
        ctx.fillRect(-this.view.x * k, -this.view.y * k, this.page.width * k, this.page.height * k);
        ctx.imageSmoothingEnabled = true;
        if (this.preview) this.placeTile(ctx, this.preview);
        // Settled bucket first (scaled during a gesture), then the target bucket on top.
        const target = bucketForScale(this.view.scale, this.fit);
        const buckets = this.settledBucket !== null && this.settledBucket !== target ? [this.settledBucket, target] : [target];
        for (const bucket of buckets) {
          const grid = tileGrid(this.page, bucketScale(this.fit, bucket, this.dpr), this.tileSize);
          for (const ref of visibleTiles(this.view, this.viewport, grid, 0)) {
            const key = tileKey(1, bucket, ref.col, ref.row);
            const t = this.cache.peek(key);
            if (t) this.placeTile(ctx, t);
            else if (this.failed.has(key)) this.drawFailed(ctx, bucket, ref.col, ref.row);
          }
        }
      }
    }
    // Layers 2 and 3 stay empty until markups arrive (Epic 5); cleared so a reopen never shows stale pixels.
    for (const layer of [this.canvases.markups, this.canvases.active]) {
      const c = layer.getContext("2d");
      if (!c) continue;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, layer.width, layer.height);
    }
    if (this.pendingPartial) {
      this.pendingPartial = false;
      this.update({ timings: { firstPartialMs: this.timingsPartial, firstFrameMs: null } });
    }
    if (this.pendingFirstFrame) {
      this.pendingFirstFrame = false;
      const firstFrameMs = this.now() - this.openedAt;
      try {
        performance.mark("viewer:first-frame");
      } catch {
        // performance.mark is unavailable in some test environments.
      }
      this.update({ status: "ready", timings: { firstPartialMs: this.timingsPartial, firstFrameMs } });
    }
  }
}
