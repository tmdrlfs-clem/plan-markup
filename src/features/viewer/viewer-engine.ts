// Viewer engine (Story 3.1; from the Story 2.3 spike engine). A plain class,
// no React state per tile: it owns the canvas stack (1 tiles, 2 static
// markups, 3 active), the view, the in-memory tile LRU and the render worker
// client, and redraws only on demand (one rAF per change).
//
// Open: file bytes -> render.open (bytes transferred) -> render.preview
// (whole page at the fit size, progressive snapshots) -> tiles of the current
// zoom bucket where the preview is not already sharp enough.
//
// View (Story 3.2, src/core/render/view.ts): zoom, centre and a view rotation.
// During a gesture every change only redraws the bitmaps already held, with
// the live transform; once the view has been still for SETTLE_MS the tiles of
// the new bucket are requested (visible first, centre first) and stale
// requests cancelled. Tiles of other buckets stay drawn underneath until the
// new ones cover them. Zoom buckets are relative to the rotation-0 fit, so a
// view rotation never re-renders anything.

import {
  DEFAULT_TILE_SIZE,
  LruByteCache,
  MAX_BUCKET,
  MIN_BUCKET,
  bitmapBytes,
  bucketForScale,
  bucketScale,
  quantizeScale,
  scaleStep,
  tileGrid,
  tileKey,
  tileRect,
  visibleTiles,
  type Size,
  type TileRef,
} from "@/core/render/tiles";
import {
  clampView,
  fitPageView,
  fitWidthView,
  panBy,
  pageToScreenMatrix,
  rotateView,
  rotatedSize,
  stepZoom,
  visibleBounds,
  zoomAt,
  zoomPercent,
  zoomToRect,
  type Matrix,
  type Point,
  type Rect,
  type ViewState,
} from "@/core/render/view";
import type { PageInfo, TilePayload } from "@/workers/render-protocol";
import { WorkerRequestError, type RenderClient } from "@/workers/rpc";

import type { ViewerErrorCode, ViewerState } from "./viewer-store";

/** CSS px kept free around the page at fit. */
export const FIT_PADDING = 16;
/** Delay before tiles are requested after the view changed (a gesture settling). */
export const SETTLE_MS = 150;
/** Requests stop once the visible tiles would fill this share of the memory budget. */
const REQUEST_BUDGET_SHARE = 0.9;
const BACKDROP = "#e5e7eb";
const PAGE = "#ffffff";
const ZOOM_RECT = "#e8620c";

export type ViewerCanvases = { tiles: HTMLCanvasElement; markups: HTMLCanvasElement; active: HTMLCanvasElement };

export type ViewerEngineOptions = {
  tileSize?: number;
  /** In-memory tile budget in bytes (2.3 report: 256 MB). */
  budgetBytes?: number;
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
};

/** "page" / "width" keep the view fitted on resize until the user zooms or pans. */
export type FitMode = "page" | "width" | null;

type Tile = { bitmap: ImageBitmap; x: number; y: number; width: number; height: number; scale: number };

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

/** The view of each document opened in this session, by sha256 (kept in memory only, AC 6). */
const documentViews = new Map<string, { view: ViewState; fitMode: FitMode }>();

/** Forgets the remembered views (tests). */
export function clearDocumentViews(): void {
  documentViews.clear();
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
  private sha256: string | null = null;
  /** Fit-page zoom at rotation 0: the base of the zoom buckets. */
  private fit = 1;
  view: ViewState = { zoom: 1, centerX: 0, centerY: 0, rotation: 0 };
  private fitMode: FitMode = "page";

  private preview: Tile | null = null;
  private previewFinal = false;
  /** Bumped per open: replies for an older document are dropped. */
  private generation = 0;
  private openReq: number | null = null;
  private previewReq: number | null = null;
  private readonly inflight = new Map<string, number>(); // tile key -> reqId
  private readonly failed = new Set<string>();
  /** Keys of the tiles the current view needs (the memory warning watches their eviction). */
  private needed = new Set<string>();
  private memoryWarned = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private openedAt = 0;
  private destroyed = false;
  private zoomRect: Rect | null = null;
  private shownZoom: number | null = null;
  private shownView = "";

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
    this.rememberView();
    this.destroyed = true;
    if (this.frame !== null) this.cancelFrame(this.frame);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.resetDocument();
    this.client.terminate();
  }

  /** Sizes the canvases to the viewport (CSS px) x DPR; keeps a fit mode fitted, clamps otherwise. */
  setViewport(width: number, height: number, dpr: number): void {
    this.viewport = { width: Math.max(1, width), height: Math.max(1, height) };
    const before = { fit: this.fit, dpr: this.dpr };
    this.dpr = dpr > 0 ? dpr : 1;
    for (const c of Object.values(this.canvases)) {
      c.width = Math.max(1, Math.round(this.viewport.width * this.dpr));
      c.height = Math.max(1, Math.round(this.viewport.height * this.dpr));
    }
    if (this.page) {
      this.fit = this.baseFit(this.page);
      if (this.fit !== before.fit || this.dpr !== before.dpr) this.dropScaledWork();
      this.view = this.fitMode ? this.fittedView(this.fitMode) : clampView(this.view, this.page, this.viewport);
      this.scheduleSettle(SETTLE_MS);
    }
    this.invalidate();
  }

  get devicePixelRatio(): number {
    return this.dpr;
  }

  // ---- open ---------------------------------------------------------------

  /** Opens a file: reads it locally and hands the bytes to the render worker. */
  async open(file: File): Promise<void> {
    this.rememberView();
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
    this.sha256 = opened.sha256;
    this.fit = this.baseFit(this.page);
    // A document seen before in this session comes back where it was left.
    const saved = documentViews.get(opened.sha256);
    this.fitMode = saved ? saved.fitMode : "page";
    this.view = saved
      ? saved.fitMode
        ? this.fittedView(saved.fitMode, saved.view.rotation)
        : clampView(saved.view, this.page, this.viewport)
      : this.fittedView("page", 0);
    this.update({ pageCount: opened.pageCount, pageIndex: 0 });
    this.invalidate();
    await this.loadPreview(generation);
  }

  private async loadPreview(generation: number): Promise<void> {
    // The rotation-0 fit box: the preview is the bucket-0 raster whatever the view rotation.
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
    this.needed = new Set();
    this.memoryWarned = false;
    this.cache.clear();
    if (this.preview) closeBitmap(this.preview.bitmap);
    this.preview = null;
    this.previewFinal = false;
    this.pendingFirstFrame = false;
    this.pendingPartial = false;
    this.timingsPartial = null;
    this.page = null;
    this.sha256 = null;
    this.openReq = null;
    this.previewReq = null;
    this.zoomRect = null;
    this.shownZoom = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    this.invalidate();
  }

  private rememberView(): void {
    if (this.sha256 && this.page) documentViews.set(this.sha256, { view: this.view, fitMode: this.fitMode });
  }

  // ---- view ---------------------------------------------------------------

  private baseFit(page: PageInfo): number {
    return fitPageView(page, this.viewport, 0, FIT_PADDING).zoom;
  }

  private fittedView(mode: "page" | "width", rotation = this.view.rotation): ViewState {
    if (!this.page) return this.view;
    return mode === "page"
      ? fitPageView(this.page, this.viewport, rotation, FIT_PADDING)
      : fitWidthView(this.page, this.viewport, rotation, FIT_PADDING);
  }

  /** Sets the view (clamped) and leaves fit mode. */
  setView(view: ViewState): void {
    if (!this.page) return;
    this.applyView(clampView(view, this.page, this.viewport), null);
  }

  private applyView(view: ViewState, fitMode: FitMode): void {
    this.view = view;
    this.fitMode = fitMode;
    this.invalidate();
    this.scheduleSettle(SETTLE_MS);
  }

  /** Fit page (Ctrl+9): stays fitted on resize until the next zoom or pan. */
  fitPage(): void {
    if (this.page) this.applyView(this.fittedView("page"), "page");
  }

  /** Fit width (Ctrl+0). */
  fitWidth(): void {
    if (this.page) this.applyView(this.fittedView("width"), "width");
  }

  /** Zooms by `factor` about a viewport point (CSS px), the centre by default. */
  zoomBy(factor: number, at?: Point): void {
    const point = at ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    this.setView(zoomAt(this.view, this.viewport, point, factor));
  }

  /** One √2 step in (1) or out (-1). */
  zoomStep(direction: 1 | -1, at?: Point): void {
    this.zoomBy(stepZoom(this.view.zoom, direction) / this.view.zoom, at);
  }

  /** Moves the content by (dx, dy) CSS px. */
  panBy(dx: number, dy: number): void {
    this.setView(panBy(this.view, dx, dy));
  }

  /** Zoom tool drag: the viewport-relative rectangle fills the view. */
  zoomToRect(rect: Rect): void {
    this.setView(zoomToRect(this.view, this.viewport, rect));
  }

  /** Rotates the view 90° clockwise (90) or counter-clockwise (-90); the PDF is unchanged. */
  rotate(delta: 90 | -90): void {
    if (!this.page) return;
    const rotated = rotateView(this.view, delta);
    if (this.fitMode) this.applyView(this.fittedView(this.fitMode, rotated.rotation), this.fitMode);
    else this.setView(rotated);
  }

  /** The Zoom tool's rubber band on the active canvas (viewport CSS px), or null. */
  setZoomRect(rect: Rect | null): void {
    this.zoomRect = rect;
    this.invalidate();
  }

  get fitScale(): number {
    return this.fit;
  }

  get currentFitMode(): FitMode {
    return this.fitMode;
  }

  get viewportSize(): Size {
    return this.viewport;
  }

  // ---- tiles --------------------------------------------------------------

  /** Device scale tiles of `bucket` are rendered at (quantised, as the worker renders them). */
  private tileScale(bucket: number): number {
    return quantizeScale(bucketScale(this.fit, bucket, this.dpr));
  }

  /**
   * In-memory key of a tile: page, bucket, the quantised device scale step and
   * the tile size, so a fit or DPR change never mixes geometries.
   */
  private memKey(bucket: number, col: number, row: number): string {
    return `${tileKey(1, bucket, col, row)}@s${scaleStep(this.tileScale(bucket))}:${this.tileSize}`;
  }

  /** The bucket scales changed (fit or DPR): stale requests go, failed markers reset. */
  private dropScaledWork(): void {
    this.client.cancel([...this.inflight.values()]);
    this.inflight.clear();
    if (this.failed.size > 0) {
      this.failed.clear();
      this.update({ failedTiles: 0 });
    }
  }

  /** Tiles of `bucket` intersecting the viewport (plus a `margin` ring), priority-ordered. */
  private tilesInView(bucket: number, margin: number): TileRef[] {
    if (!this.page) return [];
    const grid = tileGrid(this.page, this.tileScale(bucket), this.tileSize);
    // visibleTiles works on axis-aligned page boxes: pass the viewport's page-space bounds.
    const b = visibleBounds(this.view, this.viewport);
    return visibleTiles({ scale: this.view.zoom, x: b.x, y: b.y }, rotatedSize(this.viewport, this.view.rotation), grid, margin);
  }

  private scheduleSettle(ms: number): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.rememberView();
      this.requestTiles();
    }, ms);
  }

  /** Requests the visible tiles of the current bucket that the preview does not already cover. */
  requestTiles(): void {
    if (!this.page || !this.previewFinal || this.destroyed) return;
    const bucket = bucketForScale(this.view.zoom, this.fit);
    const scale = this.tileScale(bucket);
    // The preview already holds this resolution (fit page or less): tiles would add nothing.
    const covered = this.preview !== null && this.preview.scale >= scale * 0.999;
    const grid = tileGrid(this.page, scale, this.tileSize);
    const needed: TileRef[] = [];
    let bytes = 0;
    if (!covered) {
      // Visible first, centre first; stop at the budget (the rest would only evict the first).
      for (const t of this.tilesInView(bucket, 1)) {
        const r = tileRect(grid, t.col, t.row);
        const size = bitmapBytes(r.width, r.height);
        if (bytes + size > this.cache.budget * REQUEST_BUDGET_SHARE) {
          if (t.inView) this.warnMemory();
          break;
        }
        bytes += size;
        needed.push(t);
      }
    }
    this.needed = new Set(needed.map((t) => this.memKey(bucket, t.col, t.row)));
    const stale: number[] = [];
    for (const [key, reqId] of this.inflight) {
      if (!this.needed.has(key)) {
        stale.push(reqId);
        this.inflight.delete(key);
      }
    }
    this.client.cancel(stale);
    for (const t of needed) {
      const key = this.memKey(bucket, t.col, t.row);
      if (this.cache.has(key)) {
        this.cache.get(key);
        continue;
      }
      if (this.inflight.has(key) || this.failed.has(key)) continue;
      this.requestTile(key, { page: 1, bucket, scale, col: t.col, row: t.row, tileSize: this.tileSize });
    }
    this.invalidate();
  }

  /** The memory warning (AC 5): once per document, only when the budget really ran out. */
  private warnMemory(): void {
    if (this.memoryWarned) return;
    this.memoryWarned = true;
    this.update({ memoryPressure: true });
  }

  private requestTile(key: string, payload: { page: number; bucket: number; scale: number; col: number; row: number; tileSize: number }): void {
    const generation = this.generation;
    const call = this.client.request("render.tile", payload);
    this.inflight.set(key, call.reqId);
    call.promise.then(
      ({ tile }) => {
        if (generation !== this.generation || this.inflight.get(key) !== call.reqId) return closeBitmap(tile.bitmap);
        this.inflight.delete(key);
        const evicted = this.cache.set(
          key,
          { bitmap: tile.bitmap, x: tile.x, y: tile.y, width: tile.width, height: tile.height, scale: tile.scale },
          bitmapBytes(tile.width, tile.height),
        );
        // Eviction had to drop a tile this view needs: the budget cannot hold the view.
        if (evicted.some((k) => this.needed.has(k))) this.warnMemory();
        this.invalidate();
      },
      (e: unknown) => {
        if (generation !== this.generation || this.inflight.get(key) !== call.reqId) return;
        this.inflight.delete(key);
        if (e instanceof WorkerRequestError && e.code === "cancelled") return;
        if (e instanceof WorkerRequestError && e.code === "worker-failed") {
          // The worker is gone (and with it the document): the whole view failed. Try again reopens.
          this.update({ status: "error", error: "render-failed" });
          return;
        }
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

  /** Page space -> canvas device px. */
  private deviceMatrix(): Matrix {
    const m = pageToScreenMatrix(this.view, this.viewport);
    const k = this.dpr;
    return [m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k];
  }

  /** A page-space rectangle on the canvas: device px, edges rounded so neighbours never seam. */
  private deviceRect(m: Matrix, x0: number, y0: number, x1: number, y1: number): { l: number; t: number; r: number; b: number } {
    const ax = m[0] * x0 + m[2] * y0 + m[4];
    const ay = m[1] * x0 + m[3] * y0 + m[5];
    const bx = m[0] * x1 + m[2] * y1 + m[4];
    const by = m[1] * x1 + m[3] * y1 + m[5];
    return {
      l: Math.round(Math.min(ax, bx)),
      t: Math.round(Math.min(ay, by)),
      r: Math.round(Math.max(ax, bx)),
      b: Math.round(Math.max(ay, by)),
    };
  }

  /**
   * Draws a raster at its page rectangle. At the raster's own scale the
   * destination is the bitmap's exact size at integer device px: a 1:1 copy.
   */
  private placeTile(ctx: CanvasRenderingContext2D, m: Matrix, t: Tile): void {
    const d = this.deviceRect(m, t.x / t.scale, t.y / t.scale, (t.x + t.width) / t.scale, (t.y + t.height) / t.scale);
    const w = d.r - d.l;
    const h = d.b - d.t;
    if (w <= 0 || h <= 0 || d.r <= 0 || d.b <= 0 || d.l >= this.canvases.tiles.width || d.t >= this.canvases.tiles.height) return;
    const rotation = this.view.rotation;
    if (rotation === 0) {
      ctx.drawImage(t.bitmap, d.l, d.t, w, h);
      return;
    }
    // Quarter turns: rotate about the destination centre; the box stays pixel-aligned.
    const sideways = rotation === 90 || rotation === 270;
    const bw = sideways ? h : w;
    const bh = sideways ? w : h;
    const cos = rotation === 180 ? -1 : 0;
    const sin = rotation === 90 ? 1 : rotation === 270 ? -1 : 0;
    ctx.setTransform(cos, sin, -sin, cos, (d.l + d.r) / 2, (d.t + d.b) / 2);
    ctx.drawImage(t.bitmap, -bw / 2, -bh / 2, bw, bh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Grey hatched box for a failed tile (its Retry lives in the DOM overlay). */
  private drawFailed(ctx: CanvasRenderingContext2D, m: Matrix, bucket: number, col: number, row: number): void {
    if (!this.page) return;
    const scale = this.tileScale(bucket);
    const r = tileRect(tileGrid(this.page, scale, this.tileSize), col, row);
    const d = this.deviceRect(m, r.x / scale, r.y / scale, (r.x + r.width) / scale, (r.y + r.height) / scale);
    const [x, y, w, h] = [d.l, d.t, d.r - d.l, d.b - d.t];
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

  /** Buckets to draw, the target last (on top): others stay underneath until it covers them. */
  private drawOrder(target: number): number[] {
    const order: number[] = [];
    for (let k = MIN_BUCKET; k <= MAX_BUCKET; k++) if (k !== target) order.push(k);
    order.sort((a, b) => Math.abs(b - target) - Math.abs(a - target));
    order.push(target);
    return order;
  }

  private draw(): void {
    const ctx = this.canvases.tiles.getContext("2d");
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, this.canvases.tiles.width, this.canvases.tiles.height);
      if (this.page) {
        const m = this.deviceMatrix();
        const paper = this.deviceRect(m, 0, 0, this.page.width, this.page.height);
        ctx.fillStyle = PAGE;
        ctx.fillRect(paper.l, paper.t, paper.r - paper.l, paper.b - paper.t);
        ctx.imageSmoothingEnabled = true;
        if (this.preview) this.placeTile(ctx, m, this.preview);
        const target = bucketForScale(this.view.zoom, this.fit);
        if (this.cache.size > 0 || this.failed.size > 0) {
          for (const bucket of this.drawOrder(target)) {
            for (const ref of this.tilesInView(bucket, 0)) {
              const key = this.memKey(bucket, ref.col, ref.row);
              const t = this.cache.peek(key);
              if (t) this.placeTile(ctx, m, t);
              else if (bucket === target && this.failed.has(key)) this.drawFailed(ctx, m, bucket, ref.col, ref.row);
            }
          }
        }
      }
    }
    // Layer 2 stays empty until markups arrive (Epic 5); layer 3 holds the Zoom tool's rubber band.
    for (const layer of [this.canvases.markups, this.canvases.active]) {
      const c = layer.getContext("2d");
      if (!c) continue;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, layer.width, layer.height);
    }
    if (this.zoomRect) this.drawZoomRect(this.zoomRect);
    this.publishView();
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

  private drawZoomRect(r: Rect): void {
    const c = this.canvases.active.getContext("2d");
    if (!c) return;
    const k = this.dpr;
    c.save();
    c.strokeStyle = ZOOM_RECT;
    c.lineWidth = Math.max(1, Math.round(k));
    c.setLineDash([4 * k, 3 * k]);
    c.strokeRect(Math.round(r.x * k) + 0.5, Math.round(r.y * k) + 0.5, Math.round(r.width * k), Math.round(r.height * k));
    c.restore();
  }

  /** Zoom % to the store (only when it changes) and the view to `data-view` (e2e, diagnostics). */
  private publishView(): void {
    if (!this.page) return;
    const zoom = zoomPercent(this.view.zoom);
    if (zoom !== this.shownZoom) {
      this.shownZoom = zoom;
      this.update({ zoom });
    }
    const v = this.view;
    const text = `${v.zoom.toFixed(6)} ${v.centerX.toFixed(3)} ${v.centerY.toFixed(3)} ${v.rotation}`;
    if (text !== this.shownView && this.canvases.active.dataset) {
      this.shownView = text;
      this.canvases.active.dataset.view = text;
    }
  }
}
