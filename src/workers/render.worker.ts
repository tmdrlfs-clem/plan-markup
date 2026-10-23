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

import { cleanPageLabels, detectSheetLabel } from "@/core/pdf/sheet-label";
import { buildPageText, type TextItem } from "@/core/search/page-text";
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
  type TextPayload,
  type TextResult,
  type ThumbnailPayload,
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
  /**
   * The text items of a page in page space, with their boxes (search, Story 3.6;
   * sheet number detection). Read once per page: the worker caches them.
   */
  pageText?(page: number, signal: AbortSignal): Promise<TextItem[]>;
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
  /** A page's text items (validated; null when absent or unreadable). */
  getText?(key: string): Promise<TextItem[] | null>;
  putText?(key: string, items: TextItem[]): Promise<void>;
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

/** IndexedDB key of a page's text items (v1: the TextItem shape of src/core/search/page-text.ts). */
export function textCacheKey(sha256: string, page: number): string {
  return `${sha256}:${page}:text:v1`;
}

/** IndexedDB key of a page's thumbnail fitted into a widthPx x heightPx box. */
export function thumbnailCacheKey(sha256: string, req: ThumbnailPayload): string {
  return `${sha256}:${req.page}:thumb:${req.widthPx}x${req.heightPx}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Job =
  | { kind: "open"; reqId: number; bytes: Uint8Array; queuedAt: number }
  | { kind: "preview"; reqId: number; payload: PreviewPayload; queuedAt: number }
  | { kind: "tile"; reqId: number; payload: TileRequestPayload; queuedAt: number }
  | { kind: "sheetLabel"; reqId: number; payload: SheetLabelPayload; queuedAt: number }
  // missed: no cached text and pdf.js is still parsing (as for thumbnails).
  | { kind: "text"; reqId: number; payload: TextPayload; queuedAt: number; missed?: boolean }
  // `missed`: the raster cache had no copy and pdf.js is still parsing (it waits off the queue's head).
  | { kind: "thumbnail"; reqId: number; payload: ThumbnailPayload; queuedAt: number; missed?: boolean };

type Doc = {
  sha256: string;
  pages: PageInfo[];
  content: (ContentFlags | null)[];
  /** Undefined while an entry cached before Story 3.3 waits for pdf.js to read them. */
  pageLabels: string[] | null | undefined;
  sheetLabels: Record<string, string | null>;
  /** Text items read so far, by 1-based page (search and sheet labels share them). */
  text: Map<number, TextItem[]>;
  /** Resolves when pdf.js has parsed the document; rejects with its open error. */
  ready: Promise<void>;
  /** `ready` has settled: jobs that need pdf.js no longer wait. */
  parsed: boolean;
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
  /** `yielded`: a thumbnail aborted for urgent work (re-queued, not failed); `cancelled` wins over it. */
  private running: { reqId: number; abort: AbortController; job: Job; yielded: boolean; cancelled: boolean } | null = null;
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
        this.yieldThumbnail();
        break;
      case "render.tile":
        this.queue.push({ kind: "tile", reqId: msg.reqId, payload: msg.payload, queuedAt });
        this.yieldThumbnail();
        break;
      case "render.sheetLabel":
        this.queue.push({ kind: "sheetLabel", reqId: msg.reqId, payload: msg.payload, queuedAt });
        break;
      case "render.text":
        this.queue.push({ kind: "text", reqId: msg.reqId, payload: msg.payload, queuedAt });
        break;
      case "render.thumbnail":
        this.queue.push({ kind: "thumbnail", reqId: msg.reqId, payload: msg.payload, queuedAt });
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
    if (this.running && (ids === null || ids.has(this.running.reqId))) {
      this.running.cancelled = true;
      this.running.abort.abort();
    }
  }

  /** The canvas never waits behind a thumbnail: a running one stops and goes back in the queue. */
  private yieldThumbnail(): void {
    const running = this.running;
    if (running?.job.kind !== "thumbnail" || running.cancelled) return;
    running.yielded = true;
    running.abort.abort();
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
    // Unknown labels stay absent: a stored null would read as "this document has none".
    const meta: DocMeta = { pages: doc.pages, content: doc.content, sheetLabels: doc.sheetLabels };
    if (doc.pageLabels !== undefined) meta.pageLabels = doc.pageLabels;
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
      for (let job = this.nextJob(); job; job = this.nextJob()) {
        const abort = new AbortController();
        const running = { reqId: job.reqId, abort, job, yielded: false, cancelled: false };
        this.running = running;
        try {
          await this.run(job, abort.signal);
        } catch (e) {
          if (running.yielded && !running.cancelled) this.queue.push(job);
          else this.error(job.reqId, abort.signal.aborted ? CANCELLED() : e);
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * The next job to run: open / preview / tile jobs in queue order first, then
   * sheet labels and page text (search) in queue order, then thumbnails.
   * Sheet-label jobs (text extraction, never urgent) also wait until pdf.js has
   * parsed the document, unless their answer is cached; a text or thumbnail job
   * the caches missed waits for the parse the same way. None of them holds the
   * queue while pdf.js parses, in front of tiles the raster cache could answer
   * at once.
   */
  private nextJob(): Job | undefined {
    let label = -1;
    let thumb = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      if (job.kind === "sheetLabel") {
        if (label < 0 && this.sheetLabelRunnable(job)) label = i;
      } else if (job.kind === "text") {
        if (label < 0 && (!job.missed || !this.doc || this.doc.parsed)) label = i;
      } else if (job.kind === "thumbnail") {
        if (thumb < 0 && (!job.missed || !this.doc || this.doc.parsed)) thumb = i;
      } else {
        return this.queue.splice(i, 1)[0];
      }
    }
    const pick = label >= 0 ? label : thumb;
    return pick < 0 ? undefined : this.queue.splice(pick, 1)[0];
  }

  private sheetLabelRunnable(job: Extract<Job, { kind: "sheetLabel" }>): boolean {
    const doc = this.doc;
    return !doc || doc.parsed || String(job.payload.page) in doc.sheetLabels;
  }

  private async run(job: Job, signal: AbortSignal): Promise<void> {
    if (job.kind === "open") return this.open(job, signal);
    const doc = this.doc;
    if (!doc) throw new RenderError("no-document", "No document is open");
    const page = doc.pages[job.payload.page - 1];
    if (!page) throw new RenderError("out-of-range", "Page out of range");
    if (job.kind === "preview") return this.preview(job, doc, page, signal);
    if (job.kind === "sheetLabel") return this.sheetLabel(job, doc, page, signal);
    if (job.kind === "text") return this.text(job, doc, signal);
    if (job.kind === "thumbnail") return this.thumbnail(job, doc, page, signal);
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
      const doc: Doc = {
        sha256,
        pages: cached.pages,
        content: cached.content,
        pageLabels: cached.pageLabels,
        sheetLabels: { ...cached.sheetLabels },
        text: new Map(),
        ready,
        parsed: false,
      };
      // Observed by the jobs that need pdf.js; deferred sheet-label jobs may run now.
      const settled = () => {
        doc.parsed = true;
        if (this.doc === doc) void this.pump();
      };
      ready.then(settled, settled);
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
        pageLabels: doc.pageLabels ?? null,
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
    const doc: Doc = { sha256, pages, content, pageLabels, sheetLabels: {}, text: new Map(), ready: Promise.resolve(), parsed: true };
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
    const items = await this.readText(doc, job.payload.page, signal, true);
    const runs = (items ?? []).filter((item) => item.str.trim() !== "");
    const label = detectSheetLabel(runs, page);
    doc.sheetLabels[key] = label;
    this.result(job.reqId, { label });
    if (this.doc === doc) this.persist(doc);
  }

  /**
   * A page's text items: held in memory, else from IndexedDB, else read by
   * pdf.js (once per page) and stored. Without a cached copy and before pdf.js
   * has parsed the document, `wait` false returns null (the caller re-queues).
   */
  private async readText(doc: Doc, pageNo: number, signal: AbortSignal, wait: boolean): Promise<TextItem[] | null> {
    const held = doc.text.get(pageNo);
    if (held) return held;
    const key = textCacheKey(doc.sha256, pageNo);
    const stored = (await this.cache?.getText?.(key).catch(() => null)) ?? null;
    if (signal.aborted) throw CANCELLED();
    if (stored) {
      doc.text.set(pageNo, stored);
      return stored;
    }
    if (!doc.parsed && !wait) return null;
    await doc.ready;
    if (signal.aborted) throw CANCELLED();
    const items = this.renderer.pageText ? await this.renderer.pageText(pageNo, signal) : [];
    if (signal.aborted) throw CANCELLED();
    doc.text.set(pageNo, items);
    void this.cache?.putText?.(key, items).catch(() => undefined);
    return items;
  }

  /** The page's text items and its normalised search text (Story 3.6). */
  private async text(job: Extract<Job, { kind: "text" }>, doc: Doc, signal: AbortSignal): Promise<void> {
    const items = await this.readText(doc, job.payload.page, signal, job.missed === true);
    if (items === null) {
      // Wait for pdf.js off the queue's head (nextJob skips it until the parse settles).
      job.missed = true;
      this.queue.push(job);
      return;
    }
    const index = buildPageText(items);
    const result: TextResult = { items, index };
    this.result(job.reqId, result, [index.charItem.buffer, index.charOffset.buffer]);
  }

  /** The page fitted into the requested box: from the raster cache, else rendered and stored. */
  private async thumbnail(job: Extract<Job, { kind: "thumbnail" }>, doc: Doc, page: PageInfo, signal: AbortSignal): Promise<void> {
    const p = job.payload;
    // Exact (not quantised) fit: the key names the box, and the raster must not overflow it.
    const scale = Math.min(p.widthPx / page.width, p.heightPx / page.height);
    const key = thumbnailCacheKey(doc.sha256, p);
    const t0 = this.now();
    const waitMs = t0 - job.queuedAt;
    if (!job.missed) {
      const hit = await this.cache?.getTile(key).catch(() => null);
      if (hit && signal.aborted) this.renderer.release(hit);
      if (signal.aborted) throw CANCELLED();
      if (hit) {
        const tile = this.payloadFromCache(hit, p.page, scale, page, waitMs, t0);
        return this.result(job.reqId, { tile }, this.transferOf(hit));
      }
      if (!doc.parsed) {
        // Wait for pdf.js off the queue's head (nextJob skips it until the parse settles).
        job.missed = true;
        this.queue.push(job);
        return;
      }
    }
    await doc.ready;
    if (signal.aborted) throw CANCELLED();
    const rect = {
      x: 0,
      y: 0,
      width: Math.max(1, Math.min(p.widthPx, Math.round(page.width * scale))),
      height: Math.max(1, Math.min(p.heightPx, Math.round(page.height * scale))),
    };
    const out = await this.renderer.render({ page: p.page, scale, ...rect, encode: this.cache !== null, content: false }, signal);
    if (signal.aborted) {
      this.renderer.release(out.bitmap);
      throw CANCELLED();
    }
    const tile: TilePayload<B> = {
      page: p.page,
      bucket: null,
      col: 0,
      row: 0,
      scale,
      ...rect,
      bitmap: out.bitmap,
      fromCache: false,
      waitMs,
      renderMs: this.now() - t0,
    };
    this.result(job.reqId, { tile }, this.transferOf(out.bitmap));
    this.store(key, out.encoded);
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
    getText: async (key) => (await ready)?.getText?.(key) ?? null,
    putText: async (key, items) => (await ready)?.putText?.(key, items),
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
