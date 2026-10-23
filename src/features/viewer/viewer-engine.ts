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
// new ones cover them. Zoom buckets are absolute (tiles.ts: bucket k is 2^k
// device px per point), so a view rotation, a window resize, a panel toggle or
// a DPR change at the same zoom never re-renders a tile.
//
// Crisp rasters (AC 4): a raster drawn at its own scale is copied 1:1 at
// integer device px. That is a tile whenever zoom x dpr is exactly 2^k, and the
// preview at fit page (fit page snaps to the preview's quantised scale; after a
// resize the preview is re-rendered for the new fit box).
//
// Pages (Story 3.3): one page is shown at a time. goToPage cancels the old
// page's work, keeps its finished preview in the tile LRU (tiles are keyed by
// page anyway), shows whatever the new page already has and requests its
// preview, then tiles. Each page keeps its own view; a page seen for the first
// time opens at the current fit mode. The sheet number of a page without a
// page label is detected in the worker on demand (render.sheetLabel), after
// the page's tiles are requested. On a multi-page document a page that cannot
// be drawn is a page-level failure (Retry; the other pages stay reachable).
//
// Thumbnails (Story 3.4): `thumbnail(index, box, listener)` hands the page
// fitted into a device-px box to the Thumbnails panel. Held in a small LRU of
// their own; made from the page's finished preview when it is large enough
// (createImageBitmap resize, off the main thread), otherwise rendered by the
// worker at the lowest priority (render.thumbnail, IndexedDB-cached). A
// listener that goes away cancels the request once nobody else waits for it.

import {
  DEFAULT_TILE_SIZE,
  LruByteCache,
  bitmapBytes,
  bucketForScale,
  bucketScale,
  quantizeScale,
  tileGrid,
  tileKey,
  tileRange,
  tileRect,
  visibleTiles,
  type Size,
  type TileGrid,
  type TileRef,
} from "@/core/render/tiles";
import {
  ACTUAL_SIZE,
  clampView,
  clampZoom,
  fitPageView,
  fitWidthView,
  applyMatrix,
  invertMatrix,
  panBy,
  pageToScreen,
  pageToScreenMatrix,
  pdfToPageMatrix,
  rotateView,
  rotatedSize,
  screenToPage,
  stepZoom,
  visibleBounds,
  zoomAt,
  zoomOutToRect,
  zoomPercent,
  zoomToRect,
  type Matrix,
  type Point,
  type Rect,
  type ViewState,
} from "@/core/render/view";
import { readCanvasTokens, subscribeCanvasTokens, type CanvasTokens } from "@/components/ui/tokens";
import type { Quad } from "@/core/search/page-text";
import type { ContentFlags, PageInfo, TilePayload } from "@/workers/render-protocol";
import { WorkerRequestError, type RenderClient } from "@/workers/rpc";

import { DocumentSearch } from "./document-search";
import { setCursor } from "./status/cursor-store";
import { searchUi } from "./search-ui";
import type { ViewerErrorCode, ViewerState } from "./viewer-store";

/** CSS px kept free around the page at fit. */
export const FIT_PADDING = 16;
/** Delay before tiles are requested after the view changed (a gesture settling). */
export const SETTLE_MS = 150;
/** Requests stop once the visible tiles would fill this share of the memory budget. */
const REQUEST_BUDGET_SHARE = 0.9;
/** A raster whose scale matches the view's device scale this closely (relative) is drawn 1:1. */
const ONE_TO_ONE = 1e-9;
const BACKDROP = "#e5e7eb";
const PAGE = "#ffffff";
const ZOOM_RECT = "#e8620c";
/**
 * Search highlights (Story 3.6), Revu/Acrobat-style yellow: the theme's
 * --canvas-search-* tokens; these when a token cannot be read (tests).
 */
const SEARCH_COLORS = { hit: "rgba(255, 214, 0, 0.4)", current: "rgba(255, 170, 0, 0.6)", outline: "#8a5a00" };
/** A hit smaller than this on screen (CSS px) is zoomed in to it when shown (3.6 AC 3). */
export const MIN_HIT_PX = 24;
/** Space kept around a hit brought into view (CSS px). */
const HIT_MARGIN = 32;

/** The search highlight colours of a theme (the defaults where a token is missing). */
function searchColorsOf(tokens: CanvasTokens): typeof SEARCH_COLORS {
  return {
    hit: tokens.searchHit || SEARCH_COLORS.hit,
    current: tokens.searchCurrent || SEARCH_COLORS.current,
    outline: tokens.searchOutline || SEARCH_COLORS.outline,
  };
}

export type ViewerCanvases = { tiles: HTMLCanvasElement; markups: HTMLCanvasElement; active: HTMLCanvasElement };

/** The canvas backing store in whole device px, as the host measured it. */
export type DeviceSize = { width: number; height: number };

export type ViewerEngineOptions = {
  tileSize?: number;
  /** In-memory tile budget in bytes (2.3 report: 256 MB). */
  budgetBytes?: number;
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
};

/** In-memory budget of the Thumbnails panel's rasters (bytes). */
export const THUMBNAIL_BUDGET = 48 * 1024 * 1024;

/** A device-px box a thumbnail is fitted into (render.thumbnail limits: 16…2048). */
export type ThumbnailBox = { width: number; height: number };

/** Called once per request: the bitmap (owned by the engine; draw it, do not close it) or a failure. */
export type ThumbnailListener = (result: { bitmap: ImageBitmap } | { error: true }) => void;

type PendingThumbnail = { reqId: number | null; listeners: Set<ThumbnailListener> };

/** A sheet-label lookup in flight: the panel rows holding it, and whether the engine needs it. */
type SheetLabelCall = { reqId: number; holders: number; pinned: boolean };

/** The thumbnail raster size of a page in a box: fitted, whole device px. */
export function thumbnailSize(page: { width: number; height: number }, box: ThumbnailBox): ThumbnailBox {
  const scale = Math.min(box.width / page.width, box.height / page.height);
  return {
    width: Math.max(1, Math.min(box.width, Math.round(page.width * scale))),
    height: Math.max(1, Math.min(box.height, Math.round(page.height * scale))),
  };
}

const clampThumbPx = (px: number) => Math.min(2048, Math.max(16, Math.round(px)));

/** "page" / "width" keep the view fitted on resize until the user zooms or pans. */
export type FitMode = "page" | "width" | null;

/** A raster held by the engine; `bucket` is null for a preview. `page` is 1-based. */
type Tile = { bitmap: ImageBitmap; page: number; bucket: number | null; x: number; y: number; width: number; height: number; scale: number };

type PageView = { view: ViewState; fitMode: FitMode };

/** A device-px box: left, top, right, bottom. */
type Box = { l: number; t: number; r: number; b: number };

/** One tile's timings for the opt-in local perf checks (e2e/perf-tiles.spec.ts). */
export type TilePerfEntry = { at: number; page: number; bucket: number; inView: boolean; fromCache: boolean; renderMs: number; waitMs: number };

/**
 * The tile timing log, only when a local perf check has set `window.__pmTilePerf`
 * to an array (never in normal use: no cost, nothing grows).
 */
function tilePerfLog(): TilePerfEntry[] | null {
  const log = (globalThis as { __pmTilePerf?: unknown }).__pmTilePerf;
  return Array.isArray(log) ? (log as TilePerfEntry[]) : null;
}

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

/** Each document's current page and per-page views this session, by sha256 (memory only; 3.2 AC 6, 3.3 AC 5). */
const documentViews = new Map<string, { pageIndex: number; views: Map<number, PageView> }>();

/** LRU key of a page's finished preview while another page is shown. */
const previewKey = (page: number) => `${page}:preview`;

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
  /** The shown page, or null before a document is open. */
  private page: PageInfo | null = null;
  private pages: PageInfo[] = [];
  /** 0-based index of the shown page. */
  private pageIndex = 0;
  /** Content flags per page, once its preview has rendered. */
  private contents: (ContentFlags | null)[] = [];
  /** The view of every page visited in this document. */
  private pageViews = new Map<number, PageView>();
  private pageLabels: string[] | null = null;
  /** Detected sheet numbers by 0-based page (null: none found). */
  private sheetLabels: Record<number, string | null> = {};
  private readonly sheetRequested = new Set<number>();
  /** Sheet-label lookups in flight, by 0-based page. */
  private readonly sheetCalls = new Map<number, SheetLabelCall>();
  /** The document's first complete frame has been reported (status ready). */
  private firstFrameShown = false;
  /** The shown page's preview failed (multi-page documents; Retry asks again). */
  private previewFailed = false;
  private sha256: string | null = null;
  /** Thumbnail rasters by `<page>:<w>x<h>` (1-based page), and the requests in flight. */
  private readonly thumbs = new LruByteCache<ImageBitmap>(THUMBNAIL_BUDGET, (_k, b) => closeBitmap(b));
  private readonly thumbPending = new Map<string, PendingThumbnail>();
  /** Bumped per document: thumbnail replies for an older one are dropped. */
  private documentGeneration = 0;
  view: ViewState = { zoom: 1, centerX: 0, centerY: 0, rotation: 0 };
  private fitMode: FitMode = "page";

  private preview: Tile | null = null;
  private previewFinal = false;
  /** Scale of the preview re-render in flight (fit page after a resize), if any. */
  private previewPending: number | null = null;
  /** Bumped per open and per page change: replies for an older document or page are dropped. */
  private generation = 0;
  private openReq: number | null = null;
  private previewReq: number | null = null;
  private readonly inflight = new Map<string, number>(); // tile key -> reqId
  /** Failed tiles (key -> bucket); only the target bucket's survive a settle. */
  private readonly failed = new Map<string, number>();
  /** Cached tiles per page and bucket, so drawing skips empty buckets. */
  private readonly bucketCounts = new Map<number, Map<number, number>>();
  /** Tile grid per bucket of the current page. */
  private readonly grids = new Map<number, TileGrid>();
  /** Keys of the tiles the current view needs (the memory warning watches their eviction). */
  private needed = new Set<string>();
  private memoryWarned = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private openedAt = 0;
  private destroyed = false;
  /** A background document tab (Story 3.5): no drawing and no tile work until resumed. */
  private suspended = false;
  private zoomRect: Rect | null = null;
  private shownZoom: number | null = null;
  private shownView = "";
  private shownPending = "";
  /** The pointer over the canvas (viewport CSS px), for the status bar's X/Y (Story 3.7). */
  private pointerScreen: Point | null = null;
  private cursorFrame: number | null = null;

  constructor(
    private readonly canvases: ViewerCanvases,
    private readonly client: RenderClient,
    private readonly update: (patch: Partial<ViewerState>) => void,
    options: ViewerEngineOptions = {},
  ) {
    this.tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    this.cache = new LruByteCache<Tile>(options.budgetBytes ?? 256 * 1024 * 1024, (_k, t) => {
      closeBitmap(t.bitmap);
      if (t.bucket !== null) this.countTile(t.page, t.bucket, -1);
    });
    this.now = options.now ?? (() => performance.now());
    this.requestFrame = options.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id));
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the search host's getters read this engine.
    const engine = this;
    this.search = new DocumentSearch(
      {
        get pageCount() {
          return engine.pages.length;
        },
        get currentPage() {
          return engine.pageIndex;
        },
        requestText: (page) => {
          const call = this.client.request("render.text", { page: page + 1 });
          return { promise: call.promise, cancel: () => this.client.cancel([call.reqId]) };
        },
        revealHit: (page, bounds, textHeight) => this.revealHit(page, bounds, textHeight),
        changed: () => this.invalidate(),
        highlightsAllowed: () => searchUi.getState().panelOpen,
      },
      this.now,
    );
    this.unsubscribeSearchUi = searchUi.subscribe((s, prev) => {
      if (s.panelOpen !== prev.panelOpen) this.invalidate();
    });
    // A theme change recolours the highlights.
    this.unsubscribeTokens = subscribeCanvasTokens((tokens) => {
      this.searchColors = searchColorsOf(tokens);
      this.invalidate();
    });
  }

  /** Text search in this document (Story 3.6): per engine, so per document tab. */
  readonly search: DocumentSearch;
  private readonly unsubscribeSearchUi: () => void;
  private readonly unsubscribeTokens: () => void;
  /** The search highlight colours (read from the theme on first use and on every theme change). */
  private searchColors: typeof SEARCH_COLORS | null = null;

  // ---- lifecycle ----------------------------------------------------------

  /**
   * The document's tab went to the background (Story 3.5): stop drawing (the
   * canvases now belong to another tab) and cancel tile and thumbnail work.
   * The parsed document, the preview, the views and the tiles within the tile
   * budget (the tab manager shrinks it) stay, so switching back is instant.
   * A preview still loading keeps loading.
   */
  suspend(): void {
    if (this.suspended || this.destroyed) return;
    this.rememberView();
    this.suspended = true;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    const ids = [...this.inflight.values()];
    for (const pending of this.thumbPending.values()) if (pending.reqId !== null) ids.push(pending.reqId);
    this.client.cancel(ids);
    this.inflight.clear();
    this.thumbPending.clear();
    this.thumbs.clear();
    // Not shown: evictions from here on are no memory warning.
    this.needed = new Set();
    this.zoomRect = null;
    // The status bar's X/Y belongs to the shown tab.
    if (this.cursorFrame !== null) this.cancelFrame(this.cursorFrame);
    this.cursorFrame = null;
    this.pointerScreen = null;
    setCursor(null);
    this.search.pause();
  }

  /** The tab is active again: the host has sized the canvases (setViewport); draw and settle. */
  resume(): void {
    if (!this.suspended || this.destroyed) return;
    this.suspended = false;
    // The canvases showed another document: publish this one's zoom and view again.
    this.shownZoom = null;
    this.shownView = "";
    this.shownPending = "";
    // Drawn now, not next frame: the canvases must never show the previous tab's drawing.
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.draw();
    if (this.page && this.previewFinal) this.scheduleSettle(0);
    this.search.resume();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** The in-memory tile budget (bytes): the tab manager gives background tabs a small one. */
  setTileBudget(bytes: number): void {
    this.cache.setBudget(bytes);
  }

  get tileBudget(): number {
    return this.cache.budget;
  }

  get tileBytes(): number {
    return this.cache.bytes;
  }

  destroy(): void {
    this.rememberView();
    this.destroyed = true;
    if (this.frame !== null) this.cancelFrame(this.frame);
    if (this.cursorFrame !== null) this.cancelFrame(this.cursorFrame);
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.resetDocument();
    this.search.destroy();
    this.unsubscribeSearchUi();
    this.unsubscribeTokens();
    this.client.terminate();
  }

  /**
   * Sizes the canvases. `device` is the backing store in whole device px as the
   * host measured it (ResizeObserver device-pixel-content-box, or the CSS size
   * snapped to device px): the viewport is then exactly device / dpr CSS px and
   * the compositor never rescales the canvas. Without it the backing store is
   * the CSS size x DPR, rounded. Keeps a fit mode fitted, clamps otherwise.
   * Cached tiles stay valid: bucket scales depend on neither the viewport nor the DPR.
   */
  setViewport(width: number, height: number, dpr: number, device?: DeviceSize): void {
    this.dpr = dpr > 0 ? dpr : 1;
    const dw = Math.max(1, Math.round(device ? device.width : Math.max(1, width) * this.dpr));
    const dh = Math.max(1, Math.round(device ? device.height : Math.max(1, height) * this.dpr));
    this.viewport = device ? { width: dw / this.dpr, height: dh / this.dpr } : { width: Math.max(1, width), height: Math.max(1, height) };
    for (const c of Object.values(this.canvases)) {
      // Assigning a canvas size clears it, even to the same value.
      if (c.width !== dw) c.width = dw;
      if (c.height !== dh) c.height = dh;
    }
    if (this.page) {
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
    this.pages = opened.pages;
    this.contents = opened.pages.map(() => null);
    this.pageLabels = opened.pageLabels ?? null;
    this.sha256 = opened.sha256;
    // A document seen before in this session comes back to the page and views it was left at.
    const saved = documentViews.get(opened.sha256);
    this.pageViews = new Map(saved?.views);
    this.pageIndex = Math.min(saved?.pageIndex ?? 0, this.pages.length - 1);
    this.page = this.pages[this.pageIndex];
    this.fitMode = "page";
    this.view = this.viewForPage(this.pageIndex, { zoom: 1, centerX: 0, centerY: 0, rotation: 0 });
    this.update({
      pageCount: opened.pageCount,
      pageIndex: this.pageIndex,
      pages: opened.pages,
      documentId: opened.sha256,
      pageLabels: this.pageLabels,
      sheetLabels: {},
    });
    this.search.reset(this.pages.length);
    this.invalidate();
    await this.loadPreview(generation);
  }

  /**
   * The view of page `index`: its own view when visited before, otherwise the
   * current fit mode (fit page by default) at the current view rotation.
   */
  private viewForPage(index: number, current: ViewState): ViewState {
    const saved = this.pageViews.get(index);
    if (saved) {
      this.fitMode = saved.fitMode;
      return saved.fitMode ? this.fittedView(saved.fitMode, saved.view.rotation) : clampView(saved.view, this.page!, this.viewport);
    }
    this.fitMode = this.fitMode ?? "page";
    return this.fittedView(this.fitMode, current.rotation);
  }

  // ---- pages --------------------------------------------------------------

  /** 0-based index of the shown page. */
  get currentPage(): number {
    return this.pageIndex;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /**
   * Shows page `index` (0-based; out of range or the current page does nothing).
   * The old page's tile and preview requests are cancelled, so rapid key
   * repeats only render the last page fully.
   */
  goToPage(index: number): void {
    if (!this.page || !Number.isInteger(index) || index < 0 || index >= this.pages.length || index === this.pageIndex) return;
    this.rememberView();
    const ids = [...this.inflight.values()];
    if (this.previewReq !== null) ids.push(this.previewReq);
    this.client.cancel(ids);
    this.inflight.clear();
    this.previewReq = null;
    this.previewPending = null;
    this.failed.clear();
    this.grids.clear();
    this.needed = new Set();
    this.previewFailed = false;
    this.generation++;
    // Keep the finished preview (the LRU's budget decides how long); drop an unfinished one.
    if (this.preview && this.previewFinal) {
      this.cache.set(previewKey(this.pageNo), this.preview, bitmapBytes(this.preview.width, this.preview.height));
    } else if (this.preview) {
      closeBitmap(this.preview.bitmap);
    }
    this.pageIndex = index;
    this.page = this.pages[index];
    this.preview = this.cache.take(previewKey(this.pageNo)) ?? null;
    this.previewFinal = this.preview !== null;
    this.view = this.viewForPage(index, this.view);
    this.update({ pageIndex: index, content: this.contents[index] ?? null, failedTiles: 0, pageFailed: false });
    this.invalidate();
    if (this.previewFinal) this.scheduleSettle(0);
    else void this.loadPreview(this.generation);
  }

  /** Moves the keyboard focus to the canvas (Escape in the page input). */
  focusCanvas(): void {
    this.canvases.active.focus?.({ preventScroll: true });
  }

  /** 1-based number of the shown page (worker requests and tile keys). */
  private get pageNo(): number {
    return this.pageIndex + 1;
  }

  /**
   * Asks the worker for the sheet number of a page without a page label (once
   * per page). The engine's own lookup for the shown page is pinned: it is
   * never cancelled.
   */
  requestSheetLabel(index: number): void {
    const call = this.startSheetLabel(index);
    if (call) call.pinned = true;
  }

  /**
   * The Thumbnails panel's lookup for a row it shows. Returns a release: when
   * every row that asked has gone and the engine did not pin it, the worker job
   * is cancelled (a later visit asks again), so a fling through a long set does
   * not queue text extraction for every page it passed (3.4 review).
   */
  sheetLabel(index: number): () => void {
    const call = this.startSheetLabel(index);
    if (!call) return () => undefined;
    call.holders++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      call.holders--;
      if (call.holders > 0 || call.pinned || this.sheetCalls.get(index) !== call) return;
      this.sheetCalls.delete(index);
      this.sheetRequested.delete(index);
      this.client.cancel([call.reqId]);
    };
  }

  /** Lookups in flight (tests, diagnostics). */
  get pendingSheetLabels(): number {
    return this.sheetCalls.size;
  }

  /** Starts the lookup of a page once; the call in flight, or null when none is needed or it is answered. */
  private startSheetLabel(index: number): SheetLabelCall | null {
    if (!this.page || !Number.isInteger(index) || index < 0 || index >= this.pages.length) return null;
    const label = this.pageLabels?.[index];
    if (label && label !== String(index + 1)) return null;
    const inFlight = this.sheetCalls.get(index);
    if (inFlight) return inFlight;
    if (this.sheetRequested.has(index)) return null;
    this.sheetRequested.add(index);
    const sha = this.sha256;
    const request = this.client.request("render.sheetLabel", { page: index + 1 });
    const call: SheetLabelCall = { reqId: request.reqId, holders: 0, pinned: false };
    this.sheetCalls.set(index, call);
    const done = () => {
      if (this.sheetCalls.get(index) === call) this.sheetCalls.delete(index);
    };
    request.promise.then(
      ({ label: found }) => {
        if (this.sha256 !== sha || this.destroyed) return;
        done();
        this.sheetLabels = { ...this.sheetLabels, [index]: found };
        this.update({ sheetLabels: this.sheetLabels });
      },
      () => {
        // Cancelled or failed: no label; a later visit may ask again.
        if (this.sha256 !== sha) return;
        done();
        if (!this.sheetCalls.has(index)) this.sheetRequested.delete(index);
      },
    );
    return call;
  }

  /** The rotation-0 fit box in device px: the preview is the fit-page raster whatever the view rotation. */
  private previewBox(): { maxWidth: number; maxHeight: number } {
    return {
      maxWidth: Math.max(1, (this.viewport.width - 2 * FIT_PADDING) * this.dpr),
      maxHeight: Math.max(1, (this.viewport.height - 2 * FIT_PADDING) * this.dpr),
    };
  }

  /** The scale the worker renders the current fit box's preview at (render.worker: quantised fit). */
  private previewScale(): number {
    if (!this.page) return 1;
    const box = this.previewBox();
    return quantizeScale(Math.min(box.maxWidth / this.page.width, box.maxHeight / this.page.height));
  }

  private async loadPreview(generation: number): Promise<void> {
    const index = this.pageIndex;
    // This document's flags: a late reply after another open must not touch the new document's.
    const contents = this.contents;
    const call = this.client.request(
      "render.preview",
      { page: index + 1, ...this.previewBox(), progressive: true },
      {
        onProgress: ({ tile }) => {
          if (generation !== this.generation || this.previewFinal) return closeBitmap(tile.bitmap);
          this.setPreview(tile);
          if (this.timingsPartial === null && !this.firstFrameShown) {
            this.timingsPartial = this.now() - this.openedAt;
            this.pendingPartial = true;
          }
        },
      },
    );
    this.previewReq = call.reqId;
    try {
      const { tile, content } = await call.promise;
      if (contents.length > index) contents[index] = content;
      if (generation !== this.generation) return closeBitmap(tile.bitmap);
      this.setPreview(tile);
      this.previewFinal = true;
      if (!this.firstFrameShown) this.pendingFirstFrame = true;
      // A background tab draws nothing, but its document is ready to show (its tab stops loading).
      this.update(this.suspended && !this.firstFrameShown ? { content, status: "ready" } : { content });
      this.scheduleSettle(0);
    } catch (e) {
      if (generation !== this.generation || (e instanceof WorkerRequestError && e.code === "cancelled")) return;
      if (this.pages.length > 1 && !(e instanceof WorkerRequestError && e.code === "worker-failed")) {
        // One bad page must not lock the set: the pager, the keys and the other pages keep working.
        this.previewFailed = true;
        this.update({ status: "ready", content: null, failedTiles: 1, pageFailed: true });
        this.invalidate();
        return;
      }
      this.update({ status: "error", error: viewerErrorOf(e) });
    } finally {
      if (this.previewReq === call.reqId) this.previewReq = null;
    }
  }

  /**
   * Fit page after a resize or DPR change: re-renders the preview for the new
   * fit box (cached in IndexedDB by its own scale), so fit page stays a 1:1
   * copy. The old preview stays drawn, scaled, until the new one arrives; a
   * failure keeps it.
   */
  private refreshPreview(scale: number): void {
    if (this.previewReq !== null) {
      if (this.previewPending === scale) return;
      this.client.cancel([this.previewReq]);
    }
    const generation = this.generation;
    const call = this.client.request("render.preview", { page: this.pageNo, ...this.previewBox(), progressive: false });
    this.previewReq = call.reqId;
    this.previewPending = scale;
    const settle = (): boolean => {
      if (this.previewReq !== call.reqId) return false;
      this.previewReq = null;
      this.previewPending = null;
      return true;
    };
    call.promise.then(
      ({ tile }) => {
        if (generation !== this.generation || !settle()) return closeBitmap(tile.bitmap);
        this.setPreview(tile);
      },
      () => void settle(),
    );
  }

  private timingsPartial: number | null = null;
  private pendingPartial = false;
  private pendingFirstFrame = false;

  private setPreview(t: TilePayload<ImageBitmap>): void {
    if (this.preview) closeBitmap(this.preview.bitmap);
    this.preview = { bitmap: t.bitmap, page: t.page, bucket: null, x: t.x, y: t.y, width: t.width, height: t.height, scale: t.scale };
    this.invalidate();
  }

  // ---- thumbnails ---------------------------------------------------------

  /**
   * The thumbnail of page `index` (0-based) fitted into `box` (device px).
   * `listener` is called once: at once when the raster is held in memory,
   * otherwise when it is ready or failed. Returns a function that drops the
   * listener (and cancels the request when nobody else waits for it).
   */
  thumbnail(index: number, box: ThumbnailBox, listener: ThumbnailListener): () => void {
    const none = () => undefined;
    if (!this.page || !Number.isInteger(index) || index < 0 || index >= this.pages.length) return none;
    const fit = { width: clampThumbPx(box.width), height: clampThumbPx(box.height) };
    const key = `${index + 1}:${fit.width}x${fit.height}`;
    const held = this.thumbs.get(key);
    if (held) {
      listener({ bitmap: held });
      return none;
    }
    let pending = this.thumbPending.get(key);
    if (!pending) {
      pending = { reqId: null, listeners: new Set() };
      this.thumbPending.set(key, pending);
      this.loadThumbnail(key, index, fit, pending);
    }
    const entry = pending;
    entry.listeners.add(listener);
    return () => {
      if (!entry.listeners.delete(listener) || entry.listeners.size > 0 || this.thumbPending.get(key) !== entry) return;
      this.thumbPending.delete(key);
      if (entry.reqId !== null) this.client.cancel([entry.reqId]);
    };
  }

  /** Thumbnail requests waiting for a raster (tests, diagnostics). */
  get pendingThumbnails(): number {
    return this.thumbPending.size;
  }

  /** The page's finished preview, shown or kept in the tile LRU, if any. */
  private finishedPreview(index: number): Tile | null {
    if (index === this.pageIndex) return this.preview && this.previewFinal ? this.preview : null;
    return this.cache.peek(previewKey(index + 1)) ?? null;
  }

  private loadThumbnail(key: string, index: number, box: ThumbnailBox, pending: PendingThumbnail): void {
    const generation = this.documentGeneration;
    const size = thumbnailSize(this.pages[index], box);
    const source = this.finishedPreview(index);
    // The preview is the whole page: reuse it when it holds at least the thumbnail's pixels.
    if (source && source.width >= size.width && source.height >= size.height && typeof createImageBitmap === "function") {
      createImageBitmap(source.bitmap, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" }).then(
        (bitmap) => this.settleThumbnail(key, pending, generation, bitmap),
        // The preview went away meanwhile (page change, eviction): render it instead.
        () => {
          if (generation === this.documentGeneration && this.thumbPending.get(key) === pending) this.requestThumbnail(key, index, box, pending);
        },
      );
      return;
    }
    this.requestThumbnail(key, index, box, pending);
  }

  private requestThumbnail(key: string, index: number, box: ThumbnailBox, pending: PendingThumbnail): void {
    const generation = this.documentGeneration;
    const call = this.client.request("render.thumbnail", { page: index + 1, widthPx: box.width, heightPx: box.height });
    pending.reqId = call.reqId;
    call.promise.then(
      ({ tile }) => this.settleThumbnail(key, pending, generation, tile.bitmap),
      (e: unknown) => {
        if (generation !== this.documentGeneration || this.thumbPending.get(key) !== pending) return;
        this.thumbPending.delete(key);
        if (e instanceof WorkerRequestError && e.code === "cancelled") return;
        for (const listener of pending.listeners) listener({ error: true });
      },
    );
  }

  private settleThumbnail(key: string, pending: PendingThumbnail, generation: number, bitmap: ImageBitmap): void {
    if (generation !== this.documentGeneration || this.thumbPending.get(key) !== pending || this.destroyed) {
      closeBitmap(bitmap);
      return;
    }
    this.thumbPending.delete(key);
    this.thumbs.set(key, bitmap, bitmapBytes(bitmap.width, bitmap.height));
    for (const listener of pending.listeners) listener({ bitmap });
  }

  /** Drops everything of the current document (worker work, bitmaps, timers). */
  private resetDocument(): void {
    if (!this.suspended) setCursor(null);
    const ids = [...this.inflight.values()];
    for (const pending of this.thumbPending.values()) if (pending.reqId !== null) ids.push(pending.reqId);
    for (const call of this.sheetCalls.values()) ids.push(call.reqId);
    this.sheetCalls.clear();
    this.thumbPending.clear();
    this.thumbs.clear();
    this.documentGeneration++;
    if (this.openReq !== null) ids.push(this.openReq);
    if (this.previewReq !== null) ids.push(this.previewReq);
    this.client.cancel(ids);
    this.inflight.clear();
    this.failed.clear();
    this.grids.clear();
    this.needed = new Set();
    this.memoryWarned = false;
    this.cache.clear();
    this.bucketCounts.clear();
    if (this.preview) closeBitmap(this.preview.bitmap);
    this.preview = null;
    this.previewFinal = false;
    this.previewPending = null;
    this.pendingFirstFrame = false;
    this.pendingPartial = false;
    this.timingsPartial = null;
    this.page = null;
    this.pages = [];
    this.pageIndex = 0;
    this.contents = [];
    this.pageViews = new Map();
    this.pageLabels = null;
    this.sheetLabels = {};
    this.sheetRequested.clear();
    this.firstFrameShown = false;
    this.previewFailed = false;
    this.sha256 = null;
    this.openReq = null;
    this.previewReq = null;
    this.zoomRect = null;
    this.shownZoom = null;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    // Texts and hits belong to the document (the query stays). Not after destroy: the search is gone.
    if (!this.destroyed) this.search.reset(0);
    this.invalidate();
  }

  private rememberView(): void {
    if (!this.sha256 || !this.page) return;
    this.pageViews.set(this.pageIndex, { view: this.view, fitMode: this.fitMode });
    documentViews.set(this.sha256, { pageIndex: this.pageIndex, views: new Map(this.pageViews) });
  }

  // ---- view ---------------------------------------------------------------

  private fittedView(mode: "page" | "width", rotation = this.view.rotation): ViewState {
    if (!this.page) return this.view;
    if (mode === "width") return fitWidthView(this.page, this.viewport, rotation, FIT_PADDING);
    // Fit page snaps up to the quantised raster scale the preview is rendered at (at most
    // 0.07 % larger, inside the padding), so the preview is drawn 1:1 (AC 4).
    const fitted = fitPageView(this.page, this.viewport, rotation, FIT_PADDING);
    return { ...fitted, zoom: clampZoom(quantizeScale(fitted.zoom * this.dpr) / this.dpr) };
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

  /** Zoom to `percent` (Revu-style: 100 % = actual size) about the viewport centre (the status bar's zoom menu). */
  zoomToPercent(percent: number): void {
    if (!this.page || !(percent > 0)) return;
    this.zoomBy(((percent / 100) * ACTUAL_SIZE) / this.view.zoom);
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

  /** Zoom tool Alt+drag: the current view shrinks into the rectangle. */
  zoomOutToRect(rect: Rect): void {
    this.setView(zoomOutToRect(this.view, this.viewport, rect));
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

  get currentFitMode(): FitMode {
    return this.fitMode;
  }

  get viewportSize(): Size {
    return this.viewport;
  }

  // ---- tiles --------------------------------------------------------------

  /** The view's device scale (device px per point). */
  private deviceZoom(): number {
    return this.view.zoom * this.dpr;
  }

  /** The bucket the current view wants at rest. */
  private targetBucket(): number {
    return bucketForScale(this.deviceZoom());
  }

  /** The tile grid of `bucket` (2^k device px per point) on the current page, computed once per page. */
  private grid(bucket: number): TileGrid | null {
    if (!this.page) return null;
    let grid = this.grids.get(bucket);
    if (!grid) {
      grid = tileGrid(this.page, bucketScale(bucket), this.tileSize);
      this.grids.set(bucket, grid);
    }
    return grid;
  }

  /**
   * In-memory key of a tile: page, bucket, column, row. A bucket is one fixed
   * scale (2^k) and the tile size is fixed per engine, so the key never mixes
   * geometries.
   */
  private memKey(bucket: number, col: number, row: number): string {
    return tileKey(this.pageNo, bucket, col, row);
  }

  private countTile(page: number, bucket: number, delta: 1 | -1): void {
    let counts = this.bucketCounts.get(page);
    if (!counts) this.bucketCounts.set(page, (counts = new Map()));
    const n = (counts.get(bucket) ?? 0) + delta;
    if (n > 0) counts.set(bucket, n);
    else counts.delete(bucket);
  }

  /** Tiles of `bucket` intersecting the viewport (plus a `margin` ring), priority-ordered. */
  private tilesInView(bucket: number, margin: number): TileRef[] {
    const grid = this.grid(bucket);
    if (!grid) return [];
    // visibleTiles works on axis-aligned page boxes: pass the viewport's page-space bounds.
    const b = visibleBounds(this.view, this.viewport);
    return visibleTiles({ scale: this.view.zoom, x: b.x, y: b.y }, rotatedSize(this.viewport, this.view.rotation), grid, margin);
  }

  private scheduleSettle(ms: number): void {
    if (this.suspended) return;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.rememberView();
      this.requestTiles();
      // After the tiles: text extraction is never urgent (the worker also runs it last).
      if (this.page && this.previewFinal) this.requestSheetLabel(this.pageIndex);
    }, ms);
  }

  /** Requests the visible tiles of the current bucket that the preview does not already cover. */
  requestTiles(): void {
    if (!this.page || !this.previewFinal || this.destroyed || this.suspended) return;
    const bucket = this.targetBucket();
    const deviceZoom = this.deviceZoom();
    // Fit page whose fit box changed (resize, DPR): a new preview, not tiles.
    const previewScale = this.previewScale();
    const fitPreview = this.fitMode === "page" && Math.abs(deviceZoom / previewScale - 1) < ONE_TO_ONE;
    if (fitPreview && this.preview && this.preview.scale !== previewScale) this.refreshPreview(previewScale);
    // The preview already holds this resolution (fit page or less): tiles would add nothing.
    const covered = fitPreview || (this.preview !== null && this.preview.scale >= deviceZoom * 0.999);
    const grid = this.grid(bucket);
    const needed: TileRef[] = [];
    let bytes = 0;
    if (!covered && grid) {
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
    // Failures are scoped to the target bucket: other buckets' are forgotten (retried on return).
    const failedBefore = this.failed.size;
    for (const [key, b] of this.failed) if (b !== bucket) this.failed.delete(key);
    if (this.failed.size !== failedBefore) this.update({ failedTiles: this.failed.size });
    for (const t of needed) {
      const key = this.memKey(bucket, t.col, t.row);
      if (this.cache.has(key)) {
        this.cache.get(key);
        continue;
      }
      if (this.inflight.has(key) || this.failed.has(key)) continue;
      this.requestTile(key, { page: this.pageNo, bucket, scale: bucketScale(bucket), col: t.col, row: t.row, tileSize: this.tileSize }, t.inView);
    }
    this.invalidate();
  }

  /** The memory warning (AC 5): once per document, only when the budget really ran out. */
  private warnMemory(): void {
    if (this.memoryWarned) return;
    this.memoryWarned = true;
    this.update({ memoryPressure: true });
  }

  private requestTile(
    key: string,
    payload: { page: number; bucket: number; scale: number; col: number; row: number; tileSize: number },
    inView = true,
  ): void {
    const generation = this.generation;
    const call = this.client.request("render.tile", payload);
    this.inflight.set(key, call.reqId);
    call.promise.then(
      ({ tile }) => {
        if (generation !== this.generation || this.inflight.get(key) !== call.reqId) return closeBitmap(tile.bitmap);
        this.inflight.delete(key);
        tilePerfLog()?.push({
          at: this.now(),
          page: payload.page,
          bucket: payload.bucket,
          inView,
          fromCache: tile.fromCache,
          renderMs: tile.renderMs,
          waitMs: tile.waitMs,
        });
        // Counted before set: set's onEvict (replacement or over-budget) uncounts it.
        this.countTile(payload.page, payload.bucket, 1);
        const evicted = this.cache.set(
          key,
          { bitmap: tile.bitmap, page: payload.page, bucket: payload.bucket, x: tile.x, y: tile.y, width: tile.width, height: tile.height, scale: tile.scale },
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
        // A reply for a bucket the view has left is not this view's failure.
        if (payload.bucket !== this.targetBucket()) return;
        this.failed.set(key, payload.bucket);
        this.update({ failedTiles: this.failed.size });
        this.invalidate();
      },
    );
  }

  /** Retries every failed tile, or the page's failed preview (the render error state's Retry action). */
  retryFailedTiles(): void {
    this.failed.clear();
    this.update({ failedTiles: 0, pageFailed: false });
    if (this.previewFailed && this.page) {
      this.previewFailed = false;
      void this.loadPreview(this.generation);
      return;
    }
    this.requestTiles();
  }

  /** Tiles waiting for the worker (tests, diagnostics). */
  get pendingTiles(): number {
    return this.inflight.size;
  }

  // ---- drawing ------------------------------------------------------------

  private invalidate(): void {
    if (this.destroyed || this.suspended || this.frame !== null) return;
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
  private deviceRect(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
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
   * The device box of a raster drawn at its own scale: the page origin rounded
   * once to a whole device px, plus the raster's integer offset turned by the
   * view rotation. Every raster of that scale lands on whole device px with its
   * exact pixel size, and neighbours abut exactly.
   */
  private oneToOneBox(m: Matrix, t: Tile): Box {
    const ox = Math.round(m[4]);
    const oy = Math.round(m[5]);
    const { x, y, width: w, height: h } = t;
    switch (this.view.rotation) {
      case 0:
        return { l: ox + x, t: oy + y, r: ox + x + w, b: oy + y + h };
      case 90: // page (x, y) -> device (o.x - y, o.y + x)
        return { l: ox - y - h, t: oy + x, r: ox - y, b: oy + x + w };
      case 180: // -> (o.x - x, o.y - y)
        return { l: ox - x - w, t: oy - y - h, r: ox - x, b: oy - y };
      case 270: // -> (o.x + y, o.y - x)
        return { l: ox + y, t: oy - x - w, r: ox + y + h, b: oy - x };
    }
  }

  /**
   * Draws a raster at its page rectangle. At the raster's own scale it is a
   * 1:1 copy at whole device px (no resampling: hairlines stay one device px);
   * otherwise it is scaled into its rounded device rectangle.
   */
  private placeTile(ctx: CanvasRenderingContext2D, m: Matrix, t: Tile): void {
    const d =
      Math.abs(this.deviceZoom() / t.scale - 1) < ONE_TO_ONE
        ? this.oneToOneBox(m, t)
        : this.deviceRect(m, t.x / t.scale, t.y / t.scale, (t.x + t.width) / t.scale, (t.y + t.height) / t.scale);
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
  private drawFailed(ctx: CanvasRenderingContext2D, m: Matrix, grid: TileGrid, col: number, row: number): void {
    const r = tileRect(grid, col, row);
    const scale = grid.scale;
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

  /** The shown page's buckets holding tiles, farthest from `target` first and `target` last (on top). */
  private drawBuckets(target: number): number[] {
    const counts = this.bucketCounts.get(this.pageNo);
    const order: number[] = [];
    if (counts) for (const bucket of counts.keys()) if (bucket !== target) order.push(bucket);
    order.sort((a, b) => Math.abs(b - target) - Math.abs(a - target));
    if (counts?.has(target) || this.failed.size > 0) order.push(target);
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
        const target = this.targetBucket();
        // The viewport's page-space box, once per frame; per bucket only the tile range (no sort).
        const b = visibleBounds(this.view, this.viewport);
        const box = { scale: this.view.zoom, x: b.x, y: b.y };
        const size = rotatedSize(this.viewport, this.view.rotation);
        for (const bucket of this.drawBuckets(target)) {
          const grid = this.grid(bucket);
          if (!grid) continue;
          const range = tileRange(box, size, grid, 0);
          const hatch = bucket === target && this.failed.size > 0;
          for (let row = range.r0; row <= range.r1; row++) {
            for (let col = range.c0; col <= range.c1; col++) {
              const key = this.memKey(bucket, col, row);
              const t = this.cache.peek(key);
              if (t) this.placeTile(ctx, m, t);
              else if (hatch && this.failed.has(key)) this.drawFailed(ctx, m, grid, col, row);
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
    this.drawSearchHighlights();
    if (this.zoomRect) this.drawZoomRect(this.zoomRect);
    this.publishView();
    // The view moved under a still pointer: the page point under it changed.
    if (this.pointerScreen) this.publishCursor();
    if (this.pendingPartial) {
      this.pendingPartial = false;
      this.update({ timings: { firstPartialMs: this.timingsPartial, firstFrameMs: null } });
    }
    if (this.pendingFirstFrame) {
      this.pendingFirstFrame = false;
      this.firstFrameShown = true;
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

  /**
   * Search highlights on the active layer (Story 3.6 AC 3): vector quads in
   * page space under the view transform, so they stay crisp at every zoom and
   * follow the view rotation. Every hit is a translucent accent fill; the
   * current hit is stronger and outlined.
   */
  private drawSearchHighlights(): void {
    const marks = this.search.highlights(this.pageIndex);
    // The highlights shown, on the canvas element (e2e, diagnostics; like data-view).
    const data = this.canvases.active.dataset as DOMStringMap | undefined;
    if (data) {
      const shown = marks ? `${marks.hits.length}${marks.current ? " current" : ""}` : undefined;
      if (shown === undefined) delete data.highlights;
      else if (data.highlights !== shown) data.highlights = shown;
    }
    if (!marks) return;
    const c = this.canvases.active.getContext("2d");
    if (!c) return;
    const colors = (this.searchColors ??= this.readSearchColors());
    const m = this.deviceMatrix();
    const path = (quads: readonly Quad[]) => {
      for (const q of quads) {
        c.moveTo(m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]);
        for (let i = 2; i < 8; i += 2) c.lineTo(m[0] * q[i] + m[2] * q[i + 1] + m[4], m[1] * q[i] + m[3] * q[i + 1] + m[5]);
        c.closePath();
      }
    };
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = colors.hit;
    c.beginPath();
    for (const quads of marks.hits) if (quads !== marks.current) path(quads);
    c.fill();
    if (marks.current) {
      c.fillStyle = colors.current;
      c.strokeStyle = colors.outline;
      c.beginPath();
      path(marks.current);
      c.fill();
      c.lineWidth = Math.max(1, Math.round(1.5 * this.dpr));
      c.stroke();
    }
    c.restore();
  }

  private readSearchColors(): typeof SEARCH_COLORS {
    try {
      return searchColorsOf(readCanvasTokens(this.canvases.active));
    } catch {
      return SEARCH_COLORS;
    }
  }

  /** Shows page `page` (0-based) and brings a page-space rectangle into view (a search hit of text `textHeight` points tall). */
  revealHit(page: number, bounds: Rect, textHeight?: number): void {
    if (page !== this.pageIndex) this.goToPage(page);
    this.revealRect(bounds, textHeight);
  }

  /**
   * Brings a page-space rectangle into view with HIT_MARGIN around it. The zoom
   * only increases, and only when the text (`textHeight` points tall; without
   * it, the rectangle's smaller side on screen) would be under MIN_HIT_PX on
   * screen; otherwise the view pans only when the rectangle is not already
   * fully in view (centred on it).
   */
  revealRect(rect: Rect, textHeight?: number): void {
    if (!this.page) return;
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((p) => pageToScreen(this.view, this.viewport, p));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const size = textHeight !== undefined && textHeight > 0 ? textHeight * this.view.zoom : Math.min(x1 - x0, y1 - y0);
    const zoom = size > 0 && size < MIN_HIT_PX ? clampZoom((this.view.zoom * MIN_HIT_PX) / size) : this.view.zoom;
    const { width, height } = this.viewport;
    const inView = x0 >= HIT_MARGIN && y0 >= HIT_MARGIN && x1 <= width - HIT_MARGIN && y1 <= height - HIT_MARGIN;
    if (zoom === this.view.zoom && inView) {
      this.invalidate();
      return;
    }
    this.setView({ ...this.view, zoom, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 });
  }

  /**
   * The pointer moved over the canvas (viewport CSS px), or left it (null).
   * The status bar's X/Y follows at most once per animation frame (Story 3.7 AC 5).
   */
  pointerAt(point: Point | null): void {
    this.pointerScreen = point;
    if (this.cursorFrame !== null || this.suspended || this.destroyed) return;
    this.cursorFrame = this.requestFrame(() => {
      this.cursorFrame = null;
      this.publishCursor();
    });
  }

  /**
   * The point under the pointer in PDF units: points, origin at the bottom-left
   * corner of the unrotated page, whatever the view; null off the page.
   */
  cursorPoint(): Point | null {
    const page = this.page;
    const at = this.pointerScreen;
    if (!page || !at) return null;
    const p = screenToPage(this.view, this.viewport, at);
    if (!(p.x >= 0 && p.y >= 0 && p.x <= page.width && p.y <= page.height)) return null;
    return applyMatrix(invertMatrix(pdfToPageMatrix(page)), p);
  }

  private publishCursor(): void {
    if (this.suspended || this.destroyed) return;
    setCursor(this.cursorPoint());
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
    const text = `${v.zoom.toFixed(9)} ${v.centerX.toFixed(3)} ${v.centerY.toFixed(3)} ${v.rotation}`;
    if (text !== this.shownView && this.canvases.active.dataset) {
      this.shownView = text;
      this.canvases.active.dataset.view = text;
    }
    // Tiles still being rendered for this view (e2e and diagnostics: "has the view settled?").
    const pending = String(this.inflight.size + (this.previewFinal ? 0 : 1));
    if (pending !== this.shownPending && this.canvases.active.dataset) {
      this.shownPending = pending;
      this.canvases.active.dataset.pendingTiles = pending;
    }
  }
}
