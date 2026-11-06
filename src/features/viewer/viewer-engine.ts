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
  panBy,
  pageToScreen,
  pageToScreenMatrix,
  applyMatrix,
  pageToUser,
  rotateView,
  userToPageMatrix,
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
import { readCanvasTokens, subscribeCanvasTokens, viewerPalette, type ViewerPalette } from "@/components/ui/tokens";
import type { Quad } from "@/core/search/page-text";
import type { ContentFlags, PageInfo, TextResult, TilePayload } from "@/workers/render-protocol";
import type { PageText } from "@/core/markup/text-select";
import { WorkerRequestError, type RenderClient } from "@/workers/rpc";

import { DocumentSearch } from "./document-search";
import { SNAP_TOLERANCE_PX, SnapController, isSnappingTool } from "./snap-controller";
import { constraintFor, projectOnto } from "@/core/snap/constrain";
import type { SnapResult, SnapType } from "@/core/snap/resolve";
import type { SnapModifiers } from "./viewer-input";
import type { PageScales } from "@/core/scale/detect";
import { setCursor } from "./status/cursor-store";
import { searchUi } from "./search-ui";
import type { AlignTo, OrderStep } from "@/core/markup/arrange";
import { markupPainter, onMarkupsChanged, type LayerView, type PressBrush, type SelectContext, type SelectionCommand } from "./markup-layer";
import { isDrawTool, isTextMarkTool, setTool, viewerStore, type ViewerErrorCode, type ViewerState, type ViewerTool } from "./viewer-store";

/** Story 4.6: a click this close (CSS px) to the last vertex repeats it (a double-click's second click). */
const DOUBLE_CLICK_SLOP_PX = 3;

/** CSS px kept free around the page at fit. */
export const FIT_PADDING = 16;
/** Delay before tiles are requested after the view changed (a gesture settling). */
export const SETTLE_MS = 150;
/** Requests stop once the visible tiles would fill this share of the memory budget. */
const REQUEST_BUDGET_SHARE = 0.9;
/** A raster whose scale matches the view's device scale this closely (relative) is drawn 1:1. */
const ONE_TO_ONE = 1e-9;
/** The PDF sheet is never recoloured: white in every theme (Story 3.8 AC 2). Every other canvas colour is a theme token. */
const SHEET = "#ffffff";
/** A hit smaller than this on screen (CSS px) is zoomed in to it when shown (3.6 AC 3). */
export const MIN_HIT_PX = 24;
/** Space kept around a hit brought into view (CSS px). */
const HIT_MARGIN = 32;
/** Story 4.11: a measurement shown from the Measurements panel: at most this zoom (400 %), and at least this box in points (a count marker). */
const REVEAL_MAX_ZOOM = 4 * ACTUAL_SIZE;
const REVEAL_MIN_PT = 72;
/** Story 5.1: a Select click hits a markup within this many CSS px. */
const SELECT_TOLERANCE_PX = 5;

/** Story 5.7: `highlights`, between the tiles and the markups, is multiplied over the sheet (CSS). */
export type ViewerCanvases = { tiles: HTMLCanvasElement; highlights?: HTMLCanvasElement; markups: HTMLCanvasElement; active: HTMLCanvasElement };

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

/** Story 4.2: detected scales by `${sha256}:${page}` (small; the most recent 500 pages). */
const scaleCache = new Map<string, PageScales>();
function rememberScales(key: string, scales: PageScales): void {
  scaleCache.delete(key);
  scaleCache.set(key, scales);
  while (scaleCache.size > 500) scaleCache.delete(scaleCache.keys().next().value!);
}
/** Forgets detected scales (tests). */
export function clearScaleCache(): void {
  scaleCache.clear();
}

/**
 * Story 4.3: two points picked for a calibration (user space), how far apart
 * they are on the page (points, UserUnit applied) and on screen (CSS px, at
 * the zoom they were picked at).
 */
export type CalibrationPick = {
  a: Point;
  b: Point;
  distancePt: number;
  /** Story 4.4: the line along user space x and y, in points (UserUnit applied), for separate X / Y factors. */
  dxPt: number;
  dyPt: number;
  screenPx: number;
};

/** Story 4.3: what a calibration pick reports: the next point to click (1 or 2), then the result (null: cancelled). */
export type CalibrationPickListener = { step(next: 1 | 2): void; done(pick: CalibrationPick | null): void };

/** Snap types whose name was already shown next to the glyph this session (UX-DR14: first use only). */
const snapLabelsShown = new Set<SnapType>();
export const SNAP_LABELS: Readonly<Record<SnapType, string>> = {
  endpoint: "Endpoint",
  intersection: "Intersection",
  midpoint: "Midpoint",
  perpendicular: "Perpendicular",
  "on-line": "On line",
};
/** Forgets which snap names were shown (tests). */
export function resetSnapLabels(): void {
  snapLabelsShown.clear();
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
  /** Story 5.9: the pages' text in user space, by page index, as Underline and Strikethrough read it. */
  private readonly userTexts = new Map<number, PageText | "pending">();
  /** Story 5.9: where an Underline or Strikethrough drag is (viewport CSS px), while it lasts. */
  private lastTextMark: Point | null = null;
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
  /** Story 4.2: scale detection in flight by page, and the results so far (published as pageScales). */
  private readonly scaleCalls = new Map<number, number>();
  private pageScales: Record<number, PageScales> = {};
  /** The document's first complete frame has been reported (status ready). */
  private firstFrameShown = false;
  /** The shown page's preview failed (multi-page documents; Retry asks again). */
  private previewFailed = false;
  private sha256: string | null = null;
  /**
   * Story 6.6: the document id markups use. The file's sha256, or the markup
   * set's when blank pages stand in for a PDF that is not at hand.
   */
  private documentId: string | null = null;
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
  /** Story 4.6: a caption being moved: its markup and where the drag started (user space). */
  private captionDrag: { id: string; documentId: string; start: Point; pending: Point | null } | null = null;
  /** 4.6 review R1: the frame that previews the latest caption move (one layer 2 paint per frame). */
  private captionMoveFrame: number | null = null;
  private cursorFrame: number | null = null;
  /** Story 4.1: Alt / Shift as last seen, the tool's "from" point (user space), the snap shown and its first-use label. */
  private snapMods: SnapModifiers = { alt: false, shift: false };
  private snapFrom: Point | null = null;
  /** Story 4.3: a calibration's two-point pick in progress (the tool before it comes back after). */
  private pick: { points: Point[]; listener: CalibrationPickListener; tool: ViewerTool } | null = null;
  /** Story 4.3: the picked dimension line, shown while the dialog asks for its real distance. */
  private pickLine: { a: Point; b: Point } | null = null;
  private snapShown: SnapResult | null = null;
  /**
   * The point the tools place (4.3 review R1): snapped, else held to the Shift
   * direction, else raw; what the status bar shows. null off the page.
   */
  private toolPoint: Point | null = null;
  private snapLabel: SnapType | null = null;
  private snapPartialShown = false;

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
    this.snap = new SnapController(
      (page) => {
        const call = this.client.request("snap.buildIndex", { page });
        return { promise: call.promise, cancel: () => this.client.cancel([call.reqId]) };
      },
      (page) => {
        if (page === this.pageIndex && this.pointerScreen) this.pointerAt(this.pointerScreen, this.snapMods);
        this.publishSnapStats();
      },
    );
    // Leaving a snapping tool drops its "from" point and glyph.
    this.unsubscribeTool = viewerStore.subscribe((s, prev) => {
      if (s.tool === prev.tool) return;
      // Story 4.3: another tool chosen while picking calibration points cancels the pick.
      if (this.pick && s.tool !== "calibrate") this.cancelCalibrationPick();
      // Story 5.9: Underline or Strikethrough armed: read the page's text now.
      if (isTextMarkTool(s.tool) && this.page && !this.suspended) this.userText(this.pageIndex);
      if (!isSnappingTool(s.tool)) this.clearSnapFrom();
      // A snapping tool armed: now the neighbours are worth building too (review S1).
      else if (this.page && this.previewFinal && !this.suspended) this.snap.ensure(this.pageIndex, this.pages.length, true);
    });
    // A theme change (Story 3.8) recolours the canvas: backdrop, highlights, rubber band,
    // failed tiles. Re-read from the canvas (the workspace root carries the theme) and redraw
    // from the bitmaps in memory; no tile is rendered again.
    // Story 4.5: markups or the drawing changed: paint layers 2 and 3 now (NFR3: within 50 ms).
    this.unsubscribeMarkups = onMarkupsChanged((change) => {
      if (this.destroyed || this.suspended) return;
      if (change.drawingEnded && this.snapFrom) this.clearSnapFrom();
      else this.followDrawing();
      if (!change.activeOnly) this.paintMarkups(true);
      this.paintOverlay();
    });
    this.unsubscribeTokens = subscribeCanvasTokens(() => {
      this.palette = null;
      this.invalidate();
    });
  }

  /** Text search in this document (Story 3.6): per engine, so per document tab. */
  readonly search: DocumentSearch;
  private readonly unsubscribeSearchUi: () => void;
  private readonly unsubscribeTool: () => void;
  /** Story 4.1: this document's snapping (indices built in the worker, queried here). */
  readonly snap: SnapController;
  private readonly unsubscribeTokens: () => void;
  private readonly unsubscribeMarkups: () => void;
  /** The theme's canvas colours (read on first use and again after every theme change). */
  private palette: ViewerPalette | null = null;

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
    this.snap.cancel();
    this.snapShown = null;
    this.toolPoint = null;
    this.cancelCalibrationPick();
    this.pickLine = null;
    // The canvas element is shared by the tabs: its snap attributes belong to the shown one.
    this.clearSnapData();
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
    this.publishSnapStats();
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
    this.unsubscribeTool();
    this.resetDocument();
    this.search.destroy();
    this.unsubscribeSearchUi();
    this.unsubscribeTokens();
    this.unsubscribeMarkups();
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

  /**
   * Opens a file: reads it locally and hands the bytes to the render worker.
   * `documentId` (Story 6.6) shows the file as that document's pages: blank
   * pages for a markup set whose PDF is not open.
   */
  async open(file: File, documentId?: string): Promise<void> {
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
    this.documentId = documentId ?? opened.sha256;
    this.snap.setDocument(opened.sha256);
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
      documentId: this.documentId,
      standIn: this.documentId !== opened.sha256,
      pageLabels: this.pageLabels,
      sheetLabels: {},
      pageScales: {},
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
    this.snap.cancel();
    // Story 4.3: picked points belong to their page.
    this.cancelCalibrationPick();
    this.pickLine = null;
    this.snapFrom = null;
    this.snapShown = null;
    this.toolPoint = null;
    this.clearSnapData();
    if (this.snapPartialShown) {
      this.snapPartialShown = false;
      this.update({ snapPartial: false });
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
    ids.push(...this.scaleCalls.values());
    this.scaleCalls.clear();
    this.pageScales = {};
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
    this.userTexts.clear();
    this.lastTextMark = null;
    this.pageIndex = 0;
    this.contents = [];
    this.pageViews = new Map();
    this.pageLabels = null;
    this.sheetLabels = {};
    this.sheetRequested.clear();
    this.firstFrameShown = false;
    this.previewFailed = false;
    this.sha256 = null;
    this.documentId = null;
    this.snap.setDocument(null);
    this.cancelCalibrationPick();
    this.pickLine = null;
    this.snapFrom = null;
    this.snapShown = null;
    this.toolPoint = null;
    if (!this.suspended) this.clearSnapData();
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
      // Story 4.2: the shown page's printed scales (after its text, which they read).
      if (this.page && this.previewFinal) this.requestScales(this.pageIndex);
      // Story 4.1: the page's snap index, then its neighbours (last in the worker's queue).
      if (this.page && this.previewFinal) {
        this.snap.ensure(this.pageIndex, this.pages.length, isSnappingTool(viewerStore.getState().tool));
        this.publishSnapStats();
      }
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
    const palette = this.colors();
    ctx.fillStyle = palette.failedFill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = palette.failedStroke;
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
      ctx.fillStyle = this.colors().backdrop;
      ctx.fillRect(0, 0, this.canvases.tiles.width, this.canvases.tiles.height);
      if (this.page) {
        const m = this.deviceMatrix();
        const paper = this.deviceRect(m, 0, 0, this.page.width, this.page.height);
        ctx.fillStyle = SHEET;
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
    // Layer 2: the page's markups (Story 4.5); layer 3 (paintOverlay) holds the search
    // highlights, the Zoom tool's rubber band, the snap glyph and the drawing in progress.
    this.paintMarkups(false);
    this.publishView();
    // The view moved under a still pointer: the page point under it changed.
    if (this.pointerScreen) this.updateCursor();
    this.paintOverlay();
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
    c.strokeStyle = this.colors().zoomRect;
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
    const palette = this.colors();
    const colors = { hit: palette.searchHit, current: palette.searchCurrent, outline: palette.searchOutline };
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

  /** The theme's canvas colours, read from the canvas element's tokens (Blueprint's where unreadable). */
  private colors(): ViewerPalette {
    if (!this.palette) {
      try {
        this.palette = viewerPalette(readCanvasTokens(this.canvases.active));
      } catch {
        this.palette = viewerPalette(null);
      }
    }
    return this.palette;
  }

  /** Shows page `page` (0-based) and brings a page-space rectangle into view (a search hit of text `textHeight` points tall). */
  revealHit(page: number, bounds: Rect, textHeight?: number): void {
    if (page !== this.pageIndex) this.goToPage(page);
    this.revealRect(bounds, textHeight);
  }

  /**
   * Story 4.11: shows page `page` (0-based) and fits a user-space rectangle (a measurement)
   * with HIT_MARGIN around it (at least REVEAL_MIN_PT a side). The zoom goes up to the fit
   * but not past REVEAL_MAX_ZOOM, and never down while the rectangle is already fully in view.
   */
  revealUserRect(page: number, rect: Rect): void {
    if (page !== this.pageIndex) this.goToPage(page);
    const geometry = this.page;
    if (!geometry || page !== this.pageIndex) return;
    const m = userToPageMatrix(geometry);
    const corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
    ].map((p) => applyMatrix(m, p));
    const px = corners.map((p) => p.x);
    const py = corners.map((p) => p.y);
    const cx = (Math.min(...px) + Math.max(...px)) / 2;
    const cy = (Math.min(...py) + Math.max(...py)) / 2;
    const w = Math.max(REVEAL_MIN_PT, Math.max(...px) - Math.min(...px));
    const h = Math.max(REVEAL_MIN_PT, Math.max(...py) - Math.min(...py));
    const screen = [
      { x: cx - w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy + h / 2 },
      { x: cx - w / 2, y: cy + h / 2 },
    ].map((p) => pageToScreen(this.view, this.viewport, p));
    const xs = screen.map((p) => p.x);
    const ys = screen.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { width, height } = this.viewport;
    const fit = this.view.zoom * Math.min(Math.max(1, width - 2 * HIT_MARGIN) / (x1 - x0), Math.max(1, height - 2 * HIT_MARGIN) / (y1 - y0));
    const inView = x0 >= HIT_MARGIN && y0 >= HIT_MARGIN && x1 <= width - HIT_MARGIN && y1 <= height - HIT_MARGIN;
    const zoom = clampZoom(Math.min(fit, inView ? Math.max(this.view.zoom, REVEAL_MAX_ZOOM) : REVEAL_MAX_ZOOM));
    this.setView({ ...this.view, zoom, centerX: cx, centerY: cy });
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
  pointerAt(point: Point | null, modifiers?: SnapModifiers): void {
    this.pointerScreen = point;
    if (modifiers) this.snapMods = modifiers;
    if (this.cursorFrame !== null || this.suspended || this.destroyed) return;
    this.cursorFrame = this.requestFrame(() => {
      this.cursorFrame = null;
      this.publishCursor();
    });
  }

  /**
   * The point under the pointer in PDF user space (the page's own box and
   * UserUnit, as markups and snapping use it), whatever the view; null off the
   * page. The status bar shows it from the page's bottom-left corner (fromPageCorner).
   */
  cursorPoint(): Point | null {
    const page = this.page;
    const at = this.pointerScreen;
    if (!page || !at) return null;
    const p = screenToPage(this.view, this.viewport, at);
    if (!(p.x >= 0 && p.y >= 0 && p.x <= page.width && p.y <= page.height)) return null;
    return pageToUser(page, p);
  }

  private publishCursor(): void {
    if (this.suspended || this.destroyed) return;
    // A calibration pick's rubber band follows every move.
    if (this.updateCursor() || this.pick?.points.length === 1 || markupPainter()?.tracking) this.paintOverlay();
  }

  /**
   * The cursor for the status bar and the tools (Story 4.1): the raw point, or
   * with a snapping tool the snapped one (Alt held: not snapped; Shift with a
   * "from" point: held to 45° steps on screen, snap candidates projected onto
   * that line). Returns true when the overlay must be painted again.
   */
  private updateCursor(): boolean {
    const raw = this.cursorPoint();
    let point = raw;
    let shown: SnapResult | null = null;
    if (raw && this.page && isSnappingTool(viewerStore.getState().tool)) {
      const linear = this.userToScreenLinear();
      const constraint = this.snapMods.shift && this.snapFrom ? constraintFor(this.snapFrom, raw, linear) : null;
      if (constraint) point = projectOnto(constraint, raw);
      if (!this.snapMods.alt) {
        const scale = Math.hypot(linear[0], linear[1]) || 1; // CSS px per user unit
        const hit = this.snap.resolve(this.pageIndex, point ?? raw, SNAP_TOLERANCE_PX / scale, this.snapFrom);
        if (hit) {
          const at = constraint ? projectOnto(constraint, hit) : hit;
          shown = { ...hit, x: at.x, y: at.y };
          point = { x: at.x, y: at.y };
        }
      }
    }
    setCursor(point);
    this.toolPoint = point ? { x: point.x, y: point.y } : null;
    const before = this.snapShown;
    this.snapShown = shown;
    if (shown && (!before || before.type !== shown.type)) {
      // The name shows the first time each type appears this session, while that snap lasts.
      this.snapLabel = snapLabelsShown.has(shown.type) ? null : shown.type;
      snapLabelsShown.add(shown.type);
    } else if (!shown) {
      this.snapLabel = null;
    }
    const data = this.canvases.active.dataset as DOMStringMap | undefined;
    if (data) {
      const text = shown ? `${shown.type} ${shown.x.toFixed(2)} ${shown.y.toFixed(2)}` : "";
      if ((data.snap ?? "") !== text) {
        if (text) data.snap = text;
        else delete data.snap;
      }
    }
    return before?.type !== shown?.type || before?.x !== shown?.x || before?.y !== shown?.y;
  }

  /** The linear part of user space → screen (CSS px): the page box, UserUnit, zoom and view rotation. */
  private userToScreenLinear(): [number, number, number, number] {
    const u = this.page ? userToPageMatrix(this.page) : [1, 0, 0, 1, 0, 0];
    const v = pageToScreenMatrix(this.view, this.viewport);
    return [v[0] * u[0] + v[2] * u[1], v[1] * u[0] + v[3] * u[1], v[0] * u[2] + v[2] * u[3], v[1] * u[2] + v[3] * u[3]];
  }

  /** Story 4.1: Alt / Shift changed without a move. */
  setSnapModifiers(modifiers: SnapModifiers): void {
    if (modifiers.alt === this.snapMods.alt && modifiers.shift === this.snapMods.shift) return;
    this.snapMods = modifiers;
    if (this.pointerScreen) this.pointerAt(this.pointerScreen, modifiers);
  }

  /** Story 4.1: a snapping tool's click: the point it placed becomes the "from" point. */
  snapClick(): void {
    // Story 4.8: Count places points without snapping (the raw point).
    const tool = viewerStore.getState().tool;
    if (!(isSnappingTool(tool) || isDrawTool(tool)) || !this.pointerScreen || !this.page) return;
    this.updateCursor();
    // The snapped point, else the Shift-held one (review R1: never the raw pointer while Shift holds a direction).
    const point = this.toolPoint;
    this.snapFrom = point ? { x: point.x, y: point.y } : null;
    if (this.pick && point) this.pickPoint({ x: point.x, y: point.y });
    else if (point && this.documentId && isDrawTool(viewerStore.getState().tool)) {
      // Story 4.5 / 4.6 (5.4: and the markup tools): the measuring tool places the point; a finished measurement starts the next one afresh.
      const linear = this.userToScreenLinear();
      const tolerance = DOUBLE_CLICK_SLOP_PX / (Math.hypot(linear[0], linear[1]) || 1);
      const placed = markupPainter()?.place({ x: point.x, y: point.y }, { documentId: this.documentId, pageIndex: this.pageIndex, tolerance });
      if (placed === "done") this.snapFrom = null;
    }
    this.paintOverlay();
  }

  /** Story 4.6: Enter or a double-click finishes the measurement in progress (a polylength). */
  finishTool(): boolean {
    if (markupPainter()?.finish() !== "done") return false;
    this.clearSnapFrom();
    return true;
  }

  /** Story 5.5: a drawing is in progress. */
  toolTracking(): boolean {
    return markupPainter()?.tracking ?? false;
  }

  /** Story 4.6: Backspace removes the drawing's last vertex; Shift's steps then go from the one before. */
  removeToolPoint(): boolean {
    return markupPainter()?.removeLastPoint() ?? false;
  }

  /**
   * Story 4.6: Shift + drag with Select on a measurement's caption (viewport
   * CSS px): starts moving it; false when no caption is there.
   */
  startCaptionDrag(at: Point): boolean {
    const painter = markupPainter();
    const view = this.layerView();
    const start = this.screenToUser(at);
    if (!painter || !view || !start) return false;
    const id = painter.captionAt(view, { x: at.x * this.dpr, y: at.y * this.dpr });
    if (!id) return false;
    this.captionDrag = { id, documentId: view.documentId, start, pending: null };
    painter.dragCaption(id, view.documentId, { x: 0, y: 0 });
    return true;
  }

  /** Story 4.6: the caption follows the pointer (a live preview, review R1: at most once a frame). */
  moveCaptionDrag(at: Point): void {
    const drag = this.captionDrag;
    const p = this.screenToUser(at);
    if (!drag || !p) return;
    drag.pending = { x: p.x - drag.start.x, y: p.y - drag.start.y };
    if (this.captionMoveFrame !== null || this.destroyed) return;
    this.captionMoveFrame = this.requestFrame(() => {
      this.captionMoveFrame = null;
      this.flushCaptionMove();
    });
  }

  /** Story 4.6: the drag ends: `commit` keeps the move ("Move caption"), otherwise (Esc) the caption goes back. */
  endCaptionDrag(commit: boolean): void {
    if (!this.captionDrag) return;
    // The last move counts even when its frame has not come yet.
    if (commit) this.flushCaptionMove();
    this.captionDrag = null;
    markupPainter()?.endCaptionDrag(commit);
  }

  private flushCaptionMove(): void {
    const drag = this.captionDrag;
    if (!drag?.pending) return;
    markupPainter()?.dragCaption(drag.id, drag.documentId, drag.pending);
    drag.pending = null;
  }

  /** Story 5.1: the Select context at a viewport point (CSS px); null without a page. */
  private selectContext(at: Point, mods: { shift: boolean; alt: boolean; ctrl: boolean }): { point: Point; context: SelectContext } | null {
    const view = this.layerView();
    const point = this.screenToUser(at);
    if (!view || !point) return null;
    const linear = this.userToScreenLinear();
    const px = 1 / (Math.hypot(linear[0], linear[1]) || 1);
    return {
      point,
      context: {
        documentId: view.documentId,
        pageIndex: view.pageIndex,
        view,
        device: { x: at.x * this.dpr, y: at.y * this.dpr },
        px,
        tolerance: SELECT_TOLERANCE_PX * px,
        ...mods,
      },
    };
  }

  /** Story 5.1: a Select press, drag, release or cancel (viewport CSS px); false when there is no page to select on. */
  selectGesture(phase: "start" | "move" | "end" | "cancel", at: Point, mods: { shift: boolean; alt: boolean; ctrl: boolean }): boolean {
    const painter = markupPainter();
    const s = this.selectContext(at, mods);
    if (!painter?.select || !s) return false;
    painter.select(phase, s.point, s.context);
    return true;
  }

  /** Story 5.1 / 5.2: the Select cursor at the pointer (viewport CSS px); null: the default. */
  selectCursor(at: Point, mods: { ctrl: boolean } = { ctrl: false }): string | null {
    const painter = markupPainter();
    const s = this.selectContext(at, { shift: false, alt: false, ctrl: mods.ctrl });
    return painter?.cursorAt && s ? painter.cursorAt(s.point, s.context) : null;
  }

  /**
   * Story 5.3: a right-click at `at` (viewport CSS px) with Select, or the menu key (`keyboard`:
   * the pointer when it is over the canvas, else the view's centre); `client`: where the menu opens.
   */
  selectContextMenu(at: Point | null, client: Point, keyboard: boolean): boolean {
    const painter = markupPainter();
    const s = this.selectContext(at ?? this.pointerScreen ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 }, {
      shift: false,
      alt: false,
      ctrl: false,
    });
    return !!painter?.contextMenu && !!s && painter.contextMenu(s.point, s.context, client, keyboard);
  }

  /**
   * Story 5.1 / 5.2: a selection key; a nudge comes in screen px and goes to the painter in user
   * space; a paste goes to the pointer (the view's centre when it is off the canvas).
   */
  selectionKey(key: SelectionCommand): boolean {
    const painter = markupPainter();
    const view = this.layerView();
    if (!painter?.selectionKey || !view) return false;
    const at = { documentId: view.documentId, pageIndex: view.pageIndex, view };
    if (key === "paste" || key === "paste-in-place") {
      const where = this.screenToUser(this.pointerScreen ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 });
      return !!where && painter.selectionKey({ kind: "paste", inPlace: key === "paste-in-place", at: where }, at);
    }
    // Story 5.3: lock / unlock, the drawing order, align.
    if (key === "lock" || key === "unlock") return painter.selectionKey({ kind: "lock", locked: key === "lock" }, at);
    if (typeof key === "string" && key.startsWith("order:")) return painter.selectionKey({ kind: "order", step: key.slice(6) as OrderStep }, at);
    if (typeof key === "string" && key.startsWith("align:")) return painter.selectionKey({ kind: "align", to: key.slice(6) as AlignTo }, at);
    if (typeof key === "string") return painter.selectionKey({ kind: key as "delete" | "all" | "nudge-end" | "copy" | "group" | "ungroup" }, at);
    const a = this.screenToUser({ x: 0, y: 0 });
    const b = this.screenToUser({ x: key.dx, y: key.dy });
    if (!a || !b) return false;
    return painter.selectionKey({ kind: "nudge", dx: b.x - a.x, dy: b.y - a.y }, at);
  }

  /**
   * Story 4.10: Dynamic fill's press, drag and release (viewport CSS px): the painter gets the
   * point in user space, the page's linework and the part of the page in view.
   */
  pressTool(phase: "start" | "move" | "end", at: Point, brush: PressBrush): void {
    const painter = markupPainter();
    const view = this.layerView();
    const point = this.screenToUser(at);
    if (!painter?.press || !view || !point) return;
    const w = this.canvases.markups.width / this.dpr;
    const h = this.canvases.markups.height / this.dpr;
    const corners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: 0, y: h },
      { x: w, y: h },
    ]
      .map((c) => this.screenToUser(c))
      .filter((p): p is Point => p !== null);
    if (corners.length < 4) return;
    const linear = this.userToScreenLinear();
    painter.press(
      phase,
      point,
      {
        documentId: view.documentId,
        pageIndex: view.pageIndex,
        view,
        window: {
          x0: Math.min(...corners.map((p) => p.x)),
          y0: Math.min(...corners.map((p) => p.y)),
          x1: Math.max(...corners.map((p) => p.x)),
          y1: Math.max(...corners.map((p) => p.y)),
        },
        cell: 1 / (Math.hypot(linear[0], linear[1]) || 1),
        segments: this.snap.segments(this.pageIndex),
      },
      brush,
    );
  }

  /** Story 5.7: a Pen or Highlight stroke's press, drag, release or cancel (viewport CSS px). */
  inkTool(phase: "start" | "move" | "end" | "cancel", at: Point, straight: boolean): void {
    const painter = markupPainter();
    const view = this.layerView();
    const point = this.screenToUser(at);
    if (!painter || !view || !point) return;
    const where = { documentId: view.documentId, pageIndex: view.pageIndex, view };
    // Story 5.9: Underline and Strikethrough select the page's text (read once a page, in user space).
    if (isTextMarkTool(viewerStore.getState().tool)) {
      this.lastTextMark = phase === "start" || phase === "move" ? at : null;
      painter.textMark?.(phase, point, { ...where, text: this.userText(this.pageIndex) });
      return;
    }
    painter.ink?.(phase, point, where, straight);
  }

  /** Story 5.9: the page's text in user space; null until the worker has read it (it is asked for then). */
  private userText(index: number): PageText | null {
    const known = this.userTexts.get(index);
    if (known !== undefined) return known === "pending" ? null : known;
    const page = this.pages[index];
    if (!page) return null;
    this.userTexts.set(index, "pending");
    const generation = this.documentGeneration;
    const call = this.client.request("render.text", { page: index + 1 });
    void (call.promise as Promise<TextResult>).then(
      (result) => {
        if (generation !== this.documentGeneration) return;
        const toUser = (x: number, y: number) => pageToUser(page, { x, y });
        const items = result.items.map((item) => {
          const q = item.quad;
          const c = [toUser(q[0], q[1]), toUser(q[2], q[3]), toUser(q[4], q[5]), toUser(q[6], q[7])];
          return { ...item, quad: [c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y] as Quad };
        });
        this.userTexts.set(index, { items, index: result.index });
        // A drag waiting for it goes on with it.
        if (this.lastTextMark && index === this.pageIndex) this.inkTool("move", this.lastTextMark, false);
      },
      () => {
        if (generation === this.documentGeneration) this.userTexts.delete(index);
      },
    );
    return null;
  }

  /** A viewport point in PDF user space, on the page or off it. */
  private screenToUser(at: Point): Point | null {
    return this.page ? pageToUser(this.page, screenToPage(this.view, this.viewport, at)) : null;
  }

  /** The "from" point follows the drawing's last vertex (a vertex removed by Backspace or Ctrl+Z). */
  private followDrawing(): void {
    const last = markupPainter()?.lastPoint;
    if (!last || (this.snapFrom && this.snapFrom.x === last.x && this.snapFrom.y === last.y)) return;
    this.snapFrom = { x: last.x, y: last.y };
    if (this.pointerScreen) this.updateCursor();
  }

  /**
   * Story 4.5: Esc with a measuring tool: cancels the drawing in progress
   * (its "from" point too); with nothing drawn, back to Select.
   */
  escapeTool(leave = true): void {
    if (markupPainter()?.escape()) {
      this.clearSnapFrom();
      return;
    }
    if (this.snapFrom) return this.clearSnapFrom();
    if (leave) setTool("select");
  }

  /**
   * Story 4.3: picks two points for a calibration with the snapping tool's
   * rules (snap glyph, Shift 45° steps, Alt no snap). The tool is
   * "calibrate" until the second click (or a cancel), then the previous tool
   * comes back. The picked line stays drawn until clearCalibrationLine.
   */
  startCalibrationPick(listener: CalibrationPickListener): void {
    this.cancelCalibrationPick();
    if (!this.page || this.suspended) return listener.done(null);
    this.pickLine = null;
    const tool = viewerStore.getState().tool;
    this.pick = { points: [], listener, tool: tool === "calibrate" ? "select" : tool };
    this.snapFrom = null;
    setTool("calibrate");
    listener.step(1);
    this.paintOverlay();
  }

  /** Story 4.3: ends a pick in progress (Esc, another page, tab or tool); its listener gets null. */
  cancelCalibrationPick(): void {
    const pick = this.pick;
    if (!pick) return;
    this.pick = null;
    this.snapFrom = null;
    if (viewerStore.getState().tool === "calibrate") setTool(pick.tool);
    this.paintOverlay();
    pick.listener.done(null);
  }

  /** Story 4.3: the dialog is done with the picked line. */
  clearCalibrationLine(): void {
    if (!this.pickLine) return;
    this.pickLine = null;
    this.paintOverlay();
  }

  private pickPoint(point: Point): void {
    const pick = this.pick!;
    pick.points.push(point);
    if (pick.points.length < 2) return pick.listener.step(2);
    const [a, b] = pick.points;
    const u = this.page!.userUnit && this.page!.userUnit > 0 ? this.page!.userUnit : 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = this.userToScreenLinear();
    const result: CalibrationPick = {
      a,
      b,
      distancePt: Math.hypot(dx * u, dy * u),
      dxPt: dx * u,
      dyPt: dy * u,
      screenPx: Math.hypot(l[0] * dx + l[2] * dy, l[1] * dx + l[3] * dy),
    };
    this.pick = null;
    this.snapFrom = null;
    this.pickLine = { a, b };
    if (viewerStore.getState().tool === "calibrate") setTool(pick.tool);
    pick.listener.done(result);
  }

  /** Story 4.1: Esc, or another tool: no "from" point, no glyph. */
  clearSnapFrom(): void {
    if (!this.snapFrom && !this.snapShown) return;
    this.snapFrom = null;
    if (this.pointerScreen) this.updateCursor();
    else this.snapShown = null;
    this.paintOverlay();
  }

  /** The "from" point of the snapping tool (user space), if one was placed. */
  get snapFromPoint(): Point | null {
    return this.snapFrom;
  }

  /** The point the tools use (Story 4.5+): the status bar's point, snapped when snapping. */
  getSnappedPoint(): (Point & { type: SnapType | null }) | null {
    const shown = this.snapShown;
    if (shown) return { x: shown.x, y: shown.y, type: shown.type };
    const point = this.toolPoint;
    return point ? { ...point, type: null } : null;
  }

  /**
   * Story 4.2: detects the printed scales of page `index` (0-based) once per
   * document (cached by sha256 + page, shared by tabs) and publishes them.
   */
  requestScales(index: number): void {
    const sha = this.sha256;
    if (!sha || index in this.pageScales || this.scaleCalls.has(index)) return;
    const cached = scaleCache.get(`${sha}:${index}`);
    if (cached) return this.publishScales(index, cached);
    const call = this.client.request("scale.detect", { page: index + 1 });
    this.scaleCalls.set(index, call.reqId);
    call.promise.then(
      (result) => {
        if (this.scaleCalls.get(index) !== call.reqId || this.sha256 !== sha) return;
        this.scaleCalls.delete(index);
        rememberScales(`${sha}:${index}`, result);
        this.publishScales(index, result);
      },
      (e: unknown) => {
        if (this.scaleCalls.get(index) !== call.reqId || this.sha256 !== sha) return;
        this.scaleCalls.delete(index);
        // 4.2 review D8: a page whose detection failed is not asked again for this document
        // (it shows "Scale not set"); not cached across documents. A cancellation is not a failure.
        if (!(e instanceof WorkerRequestError && e.code === "cancelled")) this.publishScales(index, { scales: [], pageSheet: null });
      },
    );
  }

  private publishScales(index: number, scales: PageScales): void {
    this.pageScales = { ...this.pageScales, [index]: scales };
    this.update({ pageScales: this.pageScales });
  }

  /** Drops the snap attributes from the (shared) canvas element. */
  private clearSnapData(): void {
    const data = this.canvases.active.dataset as DOMStringMap | undefined;
    if (!data) return;
    delete data.snapIndex;
    delete data.snapBuild;
    delete data.snap;
  }

  /** The current page's index facts on the canvas (e2e, diagnostics). */
  private publishSnapStats(): void {
    if (this.suspended) return;
    const stats = this.snap.stats(this.pageIndex);
    if ((stats?.truncated ?? false) !== this.snapPartialShown) {
      this.snapPartialShown = stats?.truncated ?? false;
      this.update({ snapPartial: this.snapPartialShown });
    }
    const data = this.canvases.active.dataset as DOMStringMap | undefined;
    if (!data || !stats) return;
    data.snapIndex = `${stats.count}${stats.truncated ? " truncated" : ""}`;
    // Diagnostics (local perf checks): operator list, extraction and build (ms), index bytes.
    data.snapBuild = `${Math.round(stats.opListMs)} ${Math.round(stats.extractMs)} ${Math.round(stats.buildMs)} ${stats.bytes}`;
  }

  /** Layer 3: search highlights, the Zoom rubber band, the "from" point and the snap glyph. */
  private paintOverlay(): void {
    if (this.destroyed || this.suspended) return;
    const c = this.canvases.active.getContext("2d");
    if (c) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvases.active.width, this.canvases.active.height);
    }
    this.drawSearchHighlights();
    if (this.zoomRect) this.drawZoomRect(this.zoomRect);
    if (c && this.page) this.drawPickLine(c);
    if (c && this.page) this.drawActiveMarkup(c);
    if (c && this.page) this.drawSnap(c);
  }

  /** Story 4.5: how the markup painter sees this page on the canvases. */
  private layerView(): LayerView | null {
    const page = this.page;
    const documentId = this.documentId;
    if (!page || !documentId) return null;
    const k = this.dpr;
    const userUnit = page.userUnit && page.userUnit > 0 ? page.userUnit : 1;
    const linear = this.userToScreenLinear();
    const palette = this.colors();
    return {
      documentId,
      pageIndex: this.pageIndex,
      userUnit,
      toDevice: (p) => {
        const s = pageToScreen(this.view, this.viewport, applyMatrix(userToPageMatrix(page), p));
        return { x: s.x * k, y: s.y * k };
      },
      // CSS px per user unit, over UserUnit: per page point.
      devicePerPt: (Math.hypot(linear[0], linear[1]) / userUnit) * k,
      dpr: k,
      width: this.canvases.markups.width,
      height: this.canvases.markups.height,
      colors: { halo: palette.halo, warning: palette.canvasWarning, selection: palette.selection, fontFamily: palette.fontFamily },
    };
  }

  /**
   * Layer 2 (Story 4.5): the shown page's markups, painted by the registered
   * painter. `changed`: a markups change (not a view frame) stamps the paint
   * time (e2e: NFR3); review R6: a frame writes the attributes only when they change.
   */
  private paintMarkups(changed: boolean): void {
    if (this.destroyed || this.suspended) return;
    const canvas = this.canvases.markups;
    const c = canvas.getContext("2d");
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
    const painter = markupPainter();
    const view = this.layerView();
    // Story 5.7: the highlights under the markups, multiplied over the sheet.
    const under = this.canvases.highlights?.getContext("2d");
    if (under) {
      under.setTransform(1, 0, 0, 1, 0, 0);
      under.clearRect(0, 0, canvas.width, canvas.height);
      if (painter?.paintUnder && view) painter.paintUnder(under, view);
    }
    const captions = painter && view ? painter.paintStatic(c, view) : [];
    const data = canvas.dataset as DOMStringMap | undefined;
    if (!data) return;
    // e2e and diagnostics: what layer 2 shows and when it was last painted.
    const text = captions.join(" | ");
    if ((data.captions ?? "") !== text) {
      if (text) data.captions = text;
      else delete data.captions;
    }
    const count = String(captions.length);
    if (data.markupCount !== count) data.markupCount = count;
    if (changed) data.paintedAt = String(performance.now());
  }

  /** Layer 3 (Story 4.5): the drawing in progress and its live value beside the pointer. */
  private drawActiveMarkup(c: CanvasRenderingContext2D): void {
    const painter = markupPainter();
    const view = this.layerView();
    const live = painter && view ? painter.paintActive(c, view, this.pointerScreen ? this.toolPoint : null) : null;
    const data = this.canvases.active.dataset as DOMStringMap | undefined;
    if (!data) return;
    if ((data.measure ?? null) === live) return;
    if (live) data.measure = live;
    else delete data.measure;
  }

  /**
   * Story 4.3: the temporary dimension line of a calibration pick: from the
   * first point to the pointer while picking, then the picked line, with end
   * ticks across it, in the snap colour over a halo.
   */
  private drawPickLine(c: CanvasRenderingContext2D): void {
    const pending = this.pick?.points.length === 1 ? { a: this.pick.points[0], b: this.toolPoint } : null;
    const ends = this.pickLine ?? pending;
    if (!ends || !ends.b) return;
    const palette = this.colors();
    const k = this.dpr;
    const page = this.page!;
    const toDevice = (p: Point) => {
      const s = pageToScreen(this.view, this.viewport, applyMatrix(userToPageMatrix(page), p));
      return { x: s.x * k, y: s.y * k };
    };
    const a = toDevice(ends.a);
    const b = toDevice(ends.b);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = length > 1e-6 ? -(b.y - a.y) / length : 0;
    const ny = length > 1e-6 ? (b.x - a.x) / length : 0;
    const tick = 6 * k;
    const path = () => {
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      for (const p of [a, b]) {
        c.moveTo(p.x - nx * tick, p.y - ny * tick);
        c.lineTo(p.x + nx * tick, p.y + ny * tick);
      }
    };
    c.save();
    path();
    c.lineWidth = 3.5 * k;
    c.strokeStyle = palette.halo;
    c.stroke();
    path();
    c.lineWidth = 1.5 * k;
    c.strokeStyle = palette.snap;
    c.stroke();
    c.restore();
  }

  /**
   * The snap glyph (UX-DR14): □ endpoint, ✕ intersection, △ midpoint, ⊥
   * perpendicular, ○ on line, in the theme's snap blue (never the selection
   * orange) over a white halo, at whole device px so it stays crisp at every
   * zoom and rotation; its name the first time the type appears. The "from"
   * point is a small cross.
   */
  private drawSnap(c: CanvasRenderingContext2D): void {
    const shown = this.snapShown;
    const from = this.snapFrom;
    if (!shown && !from) return;
    const palette = this.colors();
    const k = this.dpr;
    const page = this.page!;
    const width = Math.max(1, Math.round(1.5 * k));
    // An odd stroke width is centred on a pixel's middle, an even one on its edge (review S4).
    const offset = width % 2 ? 0.5 : 0;
    const toDevice = (p: Point) => {
      const s = pageToScreen(this.view, this.viewport, applyMatrix(userToPageMatrix(page), p));
      return { x: Math.round(s.x * k) + offset, y: Math.round(s.y * k) + offset };
    };
    const r = Math.round(5 * k);
    const stroke = (path: () => void) => {
      c.beginPath();
      path();
      c.lineWidth = width + 2 * Math.max(1, Math.round(k));
      c.strokeStyle = palette.halo;
      c.stroke();
      c.lineWidth = width;
      c.strokeStyle = palette.snap;
      c.stroke();
    };
    c.save();
    if (from) {
      const f = toDevice(from);
      stroke(() => {
        c.moveTo(f.x - r, f.y);
        c.lineTo(f.x + r, f.y);
        c.moveTo(f.x, f.y - r);
        c.lineTo(f.x, f.y + r);
      });
    }
    if (shown) {
      const p = toDevice(shown);
      stroke(() => {
        switch (shown.type) {
          case "endpoint":
            c.rect(p.x - r, p.y - r, 2 * r, 2 * r);
            break;
          case "intersection":
            c.moveTo(p.x - r, p.y - r);
            c.lineTo(p.x + r, p.y + r);
            c.moveTo(p.x + r, p.y - r);
            c.lineTo(p.x - r, p.y + r);
            break;
          case "midpoint":
            c.moveTo(p.x, p.y - r);
            c.lineTo(p.x + r, p.y + r);
            c.lineTo(p.x - r, p.y + r);
            c.closePath();
            break;
          case "perpendicular":
            c.moveTo(p.x - r, p.y + r);
            c.lineTo(p.x + r, p.y + r);
            c.moveTo(p.x, p.y + r);
            c.lineTo(p.x, p.y - r);
            break;
          default:
            c.arc(p.x, p.y, r, 0, 2 * Math.PI);
        }
      });
      if (this.snapLabel === shown.type) {
        const size = Math.round(11 * k);
        c.font = `${size}px ${palette.fontFamily}`;
        c.textBaseline = "middle";
        c.lineJoin = "round";
        c.lineWidth = Math.max(2, Math.round(3 * k));
        c.strokeStyle = palette.halo;
        c.fillStyle = palette.snap;
        const text = SNAP_LABELS[shown.type];
        c.strokeText(text, p.x + r + 4 * k, p.y);
        c.fillText(text, p.x + r + 4 * k, p.y);
      }
    }
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
