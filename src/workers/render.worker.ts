// PDF render worker (Story 3.1; protocol in render-protocol.ts, AR14).
//
// One document at a time. Requests run one at a time in arrival order, except
// that render.cancel and render.close act at once. pdf.js (render-pdfjs.ts)
// is injected as a `TileRenderer`, so tests drive the protocol with a stub, and
// the IndexedDB raster cache is injected as a `RasterCache` (null = no cache).
//
// Open: the worker hashes the bytes (sha256, off the main thread), asks the
// cache for the document's page sizes and, on a hit, answers at once while
// pdf.js parses in the background; previews and tiles then come from the cache
// when present and wait for pdf.js only on a miss. Rendered tiles are encoded
// (PNG) and stored after they are posted, never on the critical path.

import { cleanPageLabels, detectSheetLabel, type TextRun } from "@/core/pdf/sheet-label";
import { quantizeScale, scaleStep, tileGrid, tileRect } from "@/core/render/tiles";
import { serializeWorkerError } from "@/core/worker/error";
import {
  RenderError,
  renderRequestSchema,
  type ContentFlags,
  type OpenResult,
  type PageInfo,
  type PreviewPayload,
  type RenderErrorCode,
  type RenderReply,
  type SheetLabelPayload,
  type TilePayload,
  type TileRequestPayload,
} from "./render-protocol";

/** A device-pixel rectangle of a page rendered at `scale` device px per point. */
export type TileJob = {
  page: number;
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Also encode the result for the raster cache. */
  encode: boolean;
  /** Also report the page's content flags (from the operator list). */
  content: boolean;
};

export type RenderedTile<B> = {
  bitmap: B;
  /** PNG of the same pixels when `job.encode` was set and encoding is possible. */
  encoded: Promise<Blob> | null;
  /** Set when `job.content` was asked and the operator list was readable. */
  content?: ContentFlags | null;
};

export interface TileRenderer<B> {
  /** Parses the document; rejects with a RenderError ("invalid-pdf" / "password-required"). */
  open(bytes: Uint8Array): Promise<PageInfo[]>;
  /**
   * Must reject (any error) once `signal` aborts. `onPartial`, when given, may
   * be called with snapshots of the unfinished render (owned by the callee).
   */
  render(job: TileJob, signal: AbortSignal, onPartial?: (bitmap: B) => void): Promise<RenderedTile<B>>;
  /** Releases a bitmap that will not be posted. */
  release(bitmap: B): void;
  /** The document's raw page labels (/PageLabels), once opened; null without any. */
  pageLabels?(): Promise<(string | null)[] | null>;
  /** The text runs of a page in page space (sheet number detection). */
  textRuns?(page: number, signal: AbortSignal): Promise<TextRun[]>;
  close(): Promise<void>;
}

export type DocMeta = {
  pages: PageInfo[];
  content: (ContentFlags | null)[];
  /** Cleaned page labels (sheet-label.ts cleanPageLabels); absent in entries written before Story 3.3. */
  pageLabels?: string[] | null;
  /** Detected sheet numbers by 1-based page (null: none found); pages not yet looked at are absent. */
  sheetLabels?: Record<string, string | null>;
};

/** The raster cache as the worker sees it; every method must swallow its own storage errors. */
export interface RasterCache<B> {
  getDoc(sha256: string): Promise<DocMeta | null>;
  putDoc(sha256: string, meta: DocMeta): Promise<void>;
  getTile(key: string): Promise<B | null>;
  putTile(key: string, blob: Blob): Promise<void>;
}

/**
 * Raster cache keys (format documented in src/lib/idb/tile-cache.ts). Both carry
 * the quantised device scale step (tiles.ts scaleStep), so the stored pixels
 * always match the key's geometry. Tile scales are absolute buckets (2^k), so
 * windows of any size share tiles; the preview is shared whenever the fit lands
 * on the same step.
 */
export function previewCacheKey(sha256: string, page: number, scale: number): string {
  return `${sha256}:${page}:preview:s${scaleStep(scale)}`;
}
export function tileCacheKey(sha256: string, req: TileRequestPayload): string {
  return `${sha256}:${req.page}:s${scaleStep(req.scale)}:${req.tileSize}:${req.col}:${req.row}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Job =
  | { kind: "open"; reqId: number; bytes: Uint8Array; queuedAt: number }
  | { kind: "preview"; reqId: number; payload: PreviewPayload; queuedAt: number }
  | { kind: "tile"; reqId: number; payload: TileRequestPayload; queuedAt: number }
  | { kind: "sheetLabel"; reqId: number; payload: SheetLabelPayload; queuedAt: number };

type Doc = {
  sha256: string;
  pages: PageInfo[];
  content: (ContentFlags | null)[];
  pageLabels: string[] | null;
  sheetLabels: Record<string, string | null>;
  /** Resolves when pdf.js has parsed the document; rejects with its open error. */
  ready: Promise<void>;
};

function codeOf(e: unknown): RenderErrorCode {
  return e instanceof RenderError ? e.code : "render-failed";
}

const CANCELLED = () => new RenderError("cancelled", "Request cancelled");

/**
 * Protocol state machine. `post` sends a reply (with its transfer list);
 * `transferOf` names the transferables of a bitmap.
 */
export class RenderWorkerHost<B> {
  private readonly queue: Job[] = [];
  private running: { reqId: number; abort: AbortController } | null = null;
  private pumping = false;
  private doc: Doc | null = null;
  /** Bumped by every open and close: work for an older document is dropped. */
  private generation = 0;

  constructor(
    private readonly renderer: TileRenderer<B>,
    private readonly post: (reply: RenderReply<B>, transfer: Transferable[]) => void,
    private readonly transferOf: (bitmap: B) => Transferable[] = () => [],
    private readonly cache: RasterCache<B> | null = null,
    private readonly now: () => number = () => performance.now(),
    private readonly hash: (bytes: Uint8Array) => Promise<string> = sha256Hex,
  ) {}

  /** Handles one incoming message. Never throws; malformed input gets an error reply. */
  handle(data: unknown): void {
    const parsed = renderRequestSchema.safeParse(data);
    if (!parsed.success) {
      const raw = (typeof data === "object" && data !== null ? data : {}) as { reqId?: unknown };
      const reqId = typeof raw.reqId === "number" && Number.isFinite(raw.reqId) ? raw.reqId : null;
      return this.error(reqId, new RenderError("invalid-request", "Invalid render request"));
    }
    const msg = parsed.data;
    const queuedAt = this.now();
    switch (msg.type) {
      case "render.cancel": {
        const ids = new Set(msg.payload.reqIds ?? []);
        this.cancel(msg.payload.all === true ? null : ids);
        this.result(msg.reqId, {});
        return;
      }
      case "render.close":
        this.generation++;
        this.cancel(null, true);
        void this.closeDocument().then(
          () => this.result(msg.reqId, {}),
          (e: unknown) => this.error(msg.reqId, e),
        );
        return;
      case "render.open": {
        const b = msg.payload.bytes;
        const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
        // A new document replaces the current one: everything queued is stale.
        this.generation++;
        this.cancel(null, true);
        this.queue.push({ kind: "open", reqId: msg.reqId, bytes, queuedAt });
        break;
      }
      case "render.preview":
        this.queue.push({ kind: "preview", reqId: msg.reqId, payload: msg.payload, queuedAt });
        break;
      case "render.tile":
        this.queue.push({ kind: "tile", reqId: msg.reqId, payload: msg.payload, queuedAt });
        break;
      case "render.sheetLabel":
        this.queue.push({ kind: "sheetLabel", reqId: msg.reqId, payload: msg.payload, queuedAt });
        break;
    }
    void this.pump();
  }

  /** Resolves when the queue is empty and nothing runs (tests). */
  async idle(): Promise<void> {
    while (this.pumping || this.queue.length > 0) await new Promise((r) => setTimeout(r, 0));
  }

  /** Cancels queued and running work: the given ids, or all (`null`). `opens` also drops queued opens. */
  private cancel(ids: Set<number> | null, opens = false): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const job = this.queue[i];
      if (job.kind === "open" && !opens) continue;
      if (ids === null || ids.has(job.reqId)) {
        this.queue.splice(i, 1);
        this.error(job.reqId, CANCELLED());
      }
    }
    if (this.running && (ids === null || ids.has(this.running.reqId))) this.running.abort.abort();
  }

  private result(reqId: number, payload: unknown, transfer: Transferable[] = []): void {
    this.post({ type: "result", reqId, payload }, transfer);
  }

  private error(reqId: number | null, e: unknown): void {
    this.post({ type: "error", reqId, code: codeOf(e), error: serializeWorkerError(e) }, []);
  }

  /** The renderer's page labels, cleaned; null when there are none or they cannot be read. */
  private async readPageLabels(): Promise<string[] | null> {
    try {
      return cleanPageLabels(await this.renderer.pageLabels?.());
    } catch {
      return null;
    }
  }

  /** Stores the document's metadata in the raster cache (never on the critical path). */
  private persist(doc: Doc): void {
    const meta: DocMeta = { pages: doc.pages, content: doc.content, pageLabels: doc.pageLabels, sheetLabels: doc.sheetLabels };
    void this.cache?.putDoc(doc.sha256, meta).catch(() => undefined);
  }

  private async closeDocument(): Promise<void> {
    const had = this.doc !== null;
    this.doc = null;
    if (had) await this.renderer.close();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        const abort = new AbortController();
        this.running = { reqId: job.reqId, abort };
        try {
          await this.run(job, abort.signal);
        } catch (e) {
          this.error(job.reqId, abort.signal.aborted ? CANCELLED() : e);
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async run(job: Job, signal: AbortSignal): Promise<void> {
    if (job.kind === "open") return this.open(job, signal);
    const doc = this.doc;
    if (!doc) throw new RenderError("no-document", "No document is open");
    const page = doc.pages[job.payload.page - 1];
    if (!page) throw new RenderError("out-of-range", "Page out of range");
    if (job.kind === "preview") return this.preview(job, doc, page, signal);
    if (job.kind === "sheetLabel") return this.sheetLabel(job, doc, page, signal);
    return this.tile(job, doc, page, signal);
  }

  private async open(job: Extract<Job, { kind: "open" }>, signal: AbortSignal): Promise<void> {
    const generation = this.generation;
    await this.closeDocument();
    // A cancel, close or newer open while we wait: stop without touching state.
    const stale = () => signal.aborted || generation !== this.generation;
    if (stale()) throw CANCELLED();
    const sha256 = await this.hash(job.bytes);
    if (stale()) throw CANCELLED();
    const cached = await this.cache?.getDoc(sha256).catch(() => null);
    if (stale()) throw CANCELLED();
    // pdf.js may take ownership of (detach) the bytes: hash first, then hand them over.
    const loading = this.renderer.open(job.bytes);
    if (cached && cached.pages.length > 0) {
      const ready = loading.then(() => undefined);
      ready.catch(() => undefined); // observed by the jobs that need pdf.js
      const doc: Doc = {
        sha256,
        pages: cached.pages,
        content: cached.content,
        pageLabels: cached.pageLabels ?? null,
        sheetLabels: { ...cached.sheetLabels },
        ready,
      };
      this.doc = doc;
      // An entry from before page labels were stored: read them once pdf.js is ready, for next time.
      if (cached.pageLabels === undefined) {
        void ready
          .then(() => this.readPageLabels())
          .then((pageLabels) => {
            if (this.doc !== doc) return;
            doc.pageLabels = pageLabels;
            this.persist(doc);
          })
          .catch(() => undefined);
      }
      const result: OpenResult = {
        sha256,
        pageCount: cached.pages.length,
        pages: cached.pages,
        pageLabels: doc.pageLabels,
        fromCache: true,
      };
      return this.result(job.reqId, result);
    }
    const pages = await loading;
    if (stale()) {
      // Only release pdf.js if no newer open has taken it over.
      if (generation === this.generation) await this.renderer.close();
      throw CANCELLED();
    }
    if (pages.length === 0) throw new RenderError("invalid-pdf", "The document has no pages");
    const content = pages.map(() => null);
    const pageLabels = await this.readPageLabels();
    if (stale()) {
      if (generation === this.generation) await this.renderer.close();
      throw CANCELLED();
    }
    const doc: Doc = { sha256, pages, content, pageLabels, sheetLabels: {}, ready: Promise.resolve() };
    this.doc = doc;
    this.persist(doc);
    const result: OpenResult = { sha256, pageCount: pages.length, pages, pageLabels, fromCache: false };
    this.result(job.reqId, result);
  }

  private async preview(
    job: Extract<Job, { kind: "preview" }>,
    doc: Doc,
    page: PageInfo,
    signal: AbortSignal,
  ): Promise<void> {
    const p = job.payload;
    const t0 = this.now();
    const waitMs = t0 - job.queuedAt;
    // Quantised, so windows whose fit lands on the same step share the cached preview.
    const scale = quantizeScale(Math.min(p.maxWidth / page.width, p.maxHeight / page.height));
    const key = previewCacheKey(doc.sha256, p.page, scale);
    const hit = await this.cache?.getTile(key).catch(() => null);
    if (hit && doc.content[p.page - 1] !== null && !signal.aborted) {
      const tile = this.payloadFromCache(hit, p.page, scale, page, waitMs, t0);
      return this.result(job.reqId, { tile, content: doc.content[p.page - 1] }, this.transferOf(hit));
    }
    if (hit) this.renderer.release(hit);
    if (signal.aborted) throw CANCELLED();
    await doc.ready;
    if (signal.aborted) throw CANCELLED();
    const size = Math.ceil(Math.max(page.width, page.height) * scale);
    const grid = tileGrid(page, scale, size);
    const rect = tileRect(grid, 0, 0);
    const base = { page: p.page, bucket: null, col: 0, row: 0, scale, ...rect, fromCache: false, waitMs };
    const onPartial = p.progressive
      ? (bitmap: B) => {
          if (signal.aborted) return this.renderer.release(bitmap);
          const tile: TilePayload<B> = { ...base, bitmap, renderMs: this.now() - t0 };
          this.post({ type: "progress", reqId: job.reqId, payload: { tile } }, this.transferOf(bitmap));
        }
      : undefined;
    const encode = this.cache !== null;
    const out = await this.renderer.render({ page: p.page, scale, ...rect, encode, content: true }, signal, onPartial);
    if (signal.aborted) {
      this.renderer.release(out.bitmap);
      throw CANCELLED();
    }
    const content = out.content ?? null;
    doc.content[p.page - 1] = content;
    const tile: TilePayload<B> = { ...base, bitmap: out.bitmap, renderMs: this.now() - t0 };
    this.result(job.reqId, { tile, content }, this.transferOf(out.bitmap));
    if (content) this.persist(doc);
    this.store(key, out.encoded);
  }

  /** The page's detected sheet number (cached with the document; text is read once per page). */
  private async sheetLabel(job: Extract<Job, { kind: "sheetLabel" }>, doc: Doc, page: PageInfo, signal: AbortSignal): Promise<void> {
    const key = String(job.payload.page);
    if (key in doc.sheetLabels) return this.result(job.reqId, { label: doc.sheetLabels[key] });
    await doc.ready;
    if (signal.aborted) throw CANCELLED();
    const runs = this.renderer.textRuns ? await this.renderer.textRuns(job.payload.page, signal) : [];
    if (signal.aborted) throw CANCELLED();
    const label = detectSheetLabel(runs, page);
    doc.sheetLabels[key] = label;
    this.result(job.reqId, { label });
    if (this.doc === doc) this.persist(doc);
  }

  private async tile(job: Extract<Job, { kind: "tile" }>, doc: Doc, page: PageInfo, signal: AbortSignal): Promise<void> {
    const r = job.payload;
    const scale = quantizeScale(r.scale);
    const grid = tileGrid(page, scale, r.tileSize);
    if (r.col >= grid.cols || r.row >= grid.rows) throw new RenderError("out-of-range", "Tile out of range");
    const rect = tileRect(grid, r.col, r.row);
    const t0 = this.now();
    const waitMs = t0 - job.queuedAt;
    const key = tileCacheKey(doc.sha256, r);
    const hit = await this.cache?.getTile(key).catch(() => null);
    const base = { page: r.page, bucket: r.bucket, col: r.col, row: r.row, scale, ...rect, waitMs };
    if (hit && signal.aborted) this.renderer.release(hit);
    if (signal.aborted) throw CANCELLED();
    if (hit) {
      const tile: TilePayload<B> = { ...base, bitmap: hit, fromCache: true, renderMs: this.now() - t0 };
      return this.result(job.reqId, { tile }, this.transferOf(hit));
    }
    await doc.ready;
    if (signal.aborted) throw CANCELLED();
    const out = await this.renderer.render({ page: r.page, scale, ...rect, encode: this.cache !== null, content: false }, signal);
    if (signal.aborted) {
      this.renderer.release(out.bitmap);
      throw CANCELLED();
    }
    const tile: TilePayload<B> = { ...base, bitmap: out.bitmap, fromCache: false, renderMs: this.now() - t0 };
    this.result(job.reqId, { tile }, this.transferOf(out.bitmap));
    this.store(key, out.encoded);
  }

  private payloadFromCache(bitmap: B, pageNo: number, scale: number, page: PageInfo, waitMs: number, t0: number): TilePayload<B> {
    // The key carries the scale step, so the stored preview is at exactly `scale`.
    const size = this.sizeOf(bitmap);
    return {
      page: pageNo,
      bucket: null,
      col: 0,
      row: 0,
      scale,
      x: 0,
      y: 0,
      width: size?.width ?? Math.ceil(page.width * scale),
      height: size?.height ?? Math.ceil(page.height * scale),
      bitmap,
      fromCache: true,
      renderMs: this.now() - t0,
      waitMs,
    };
  }

  private sizeOf(bitmap: B): { width: number; height: number } | null {
    const b = bitmap as unknown as { width?: unknown; height?: unknown };
    return typeof b.width === "number" && typeof b.height === "number" ? { width: b.width, height: b.height } : null;
  }

  private store(key: string, encoded: Promise<Blob> | null): void {
    if (!this.cache || !encoded) return;
    const cache = this.cache;
    void encoded.then((blob) => cache.putTile(key, blob)).catch(() => undefined);
  }
}

/**
 * A raster cache that is still opening: every call waits for `opening` (which
 * must settle, e.g. openTileCache's timeout) and becomes a miss / no-op when it
 * yields null. Lets the worker host start before IndexedDB has answered.
 */
export function deferredRasterCache<B>(opening: Promise<RasterCache<B> | null>): RasterCache<B> {
  const ready = opening.catch(() => null);
  return {
    getDoc: async (sha) => (await ready)?.getDoc(sha) ?? null,
    putDoc: async (sha, meta) => (await ready)?.putDoc(sha, meta),
    getTile: async (key) => (await ready)?.getTile(key) ?? null,
    putTile: async (key, blob) => (await ready)?.putTile(key, blob),
  };
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
  location: { origin: string };
};

declare const WorkerGlobalScope: (new () => unknown) | undefined;

// Wire up only inside a real worker (not in Vitest/Node). The host starts as
// soon as pdf.js's module has loaded; the IndexedDB cache opens in the
// background (bounded by openTileCache's timeout) and is never waited for at
// start. Messages that arrive before the host exists are queued. If the worker
// cannot start, the queue (with its transferred file bytes) is dropped and a
// "worker-failed" reply tells the client to fail everything and start afresh.
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope;
  let pending: unknown[] | null = [];
  let host: RenderWorkerHost<ImageBitmap> | null = null;
  scope.addEventListener("message", (event) => {
    if (host) host.handle(event.data);
    else pending?.push(event.data); // after a failed start: dropped
  });
  const cache = import("./render-cache").then(({ openRasterCache }) => openRasterCache());
  void import("./render-pdfjs")
    .then(({ PdfjsTileRenderer, pdfjsAssetBase }) => {
      host = new RenderWorkerHost<ImageBitmap>(
        new PdfjsTileRenderer(pdfjsAssetBase(scope.location.origin)),
        (reply, transfer) => scope.postMessage(reply, transfer),
        (b) => [b],
        deferredRasterCache(cache),
      );
      const queued = pending ?? [];
      pending = null;
      for (const data of queued) host.handle(data);
    })
    .catch((e: unknown) => {
      pending = null;
      scope.postMessage({ type: "error", reqId: null, code: "worker-failed", error: serializeWorkerError(e) }, []);
    });
}
