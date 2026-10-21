// PDF tile render worker (Story 2.3 spike; protocol kept for Epic 3).
//
// Requests (main -> worker):
//   { type: "open", reqId, bytes, preview?: { page, bucket, maxWidth, maxHeight }, options? }
//       The PDF bytes are transferred once (post with `renderOpenRequest`).
//       `options` go to the renderer (pdf.js: which worker setup to use).
//       Replies { type: "opened", reqId, pages, ms } and then, when `preview` is
//       set, one low-resolution whole-page tile ({ type: "tile", preview: true })
//       scaled to fit maxWidth x maxHeight device px (the viewer's fit bucket),
//       so the viewer can show something before any real tile is ready. With
//       `preview.progressive`, snapshots of the preview are also posted while it
//       renders ({ type: "tile", preview: true, partial: true }, ~every 500 ms).
//   { type: "renderTile", reqId, page, bucket, scale, col, row, tileSize }
//       `scale` is device px per point (the bucket's scale). Replies
//       { type: "tile", reqId, ..., bitmap } with the ImageBitmap transferred.
//   { type: "cancel", reqIds?: number[], all?: boolean }
//       Queued requests are dropped and a running render is aborted; each gets
//       { type: "cancelled", reqId }. Unknown ids are ignored. No other reply.
//   { type: "close", reqId }  Cancels everything, releases the document, replies "closed".
// Errors: { type: "error", reqId, error } via serializeWorkerError (reqId null
// when the request had none). Requests run one at a time in arrival order.
//
// The renderer is injected (`RenderWorkerHost`), so tests drive the protocol
// with a stub; the real one is pdf.js (render-pdfjs.ts), loaded lazily in the worker.

import { tileGrid, tileRect } from "@/core/render/tiles";
import { serializeWorkerError, type SerializedWorkerError } from "@/core/worker/error";

/** Page size in points, rotation applied (pdf.js viewport at scale 1). */
export type PageInfo = { width: number; height: number };

/** A device-pixel rectangle of a page rendered at `scale` device px per point. */
export type TileJob = { page: number; scale: number; x: number; y: number; width: number; height: number };

export type RendererOptions = { pdfjsWorker?: "inline" | "nested" };

export interface TileRenderer<B> {
  open(bytes: Uint8Array, options: RendererOptions): Promise<PageInfo[]>;
  /**
   * Must reject (any error) once `signal` aborts. `onPartial`, when given, may
   * be called with snapshots of the unfinished render (owned by the callee).
   */
  render(job: TileJob, signal: AbortSignal, onPartial?: (bitmap: B) => void): Promise<B>;
  /** Releases a bitmap that will not be posted (rendered after a cancel). */
  release(bitmap: B): void;
  close(): Promise<void>;
}

export type OpenRequest = {
  type: "open";
  reqId: number;
  bytes: ArrayBuffer | Uint8Array;
  preview?: { page: number; bucket: number; maxWidth: number; maxHeight: number; progressive?: boolean };
  options?: RendererOptions;
};
export type RenderTileRequest = {
  type: "renderTile";
  reqId: number;
  page: number;
  bucket: number;
  scale: number;
  col: number;
  row: number;
  tileSize: number;
};
export type CancelRequest = { type: "cancel"; reqIds?: number[]; all?: boolean };
export type CloseRequest = { type: "close"; reqId: number };
export type RenderWorkerRequest = OpenRequest | RenderTileRequest | CancelRequest | CloseRequest;

export type TileReply<B> = {
  type: "tile";
  reqId: number;
  preview: boolean;
  /** A snapshot of an unfinished preview; the finished tile follows. */
  partial: boolean;
  page: number;
  bucket: number;
  col: number;
  row: number;
  scale: number;
  /** Device-pixel rectangle of the tile within the page at `scale`. */
  x: number;
  y: number;
  width: number;
  height: number;
  bitmap: B;
  /** Time spent rendering, and waiting in the queue before that (ms). */
  renderMs: number;
  waitMs: number;
};

export type RenderWorkerReply<B> =
  | { type: "opened"; reqId: number; pages: PageInfo[]; ms: number }
  | TileReply<B>
  | { type: "cancelled"; reqId: number }
  | { type: "closed"; reqId: number }
  | { type: "error"; reqId: number | null; error: SerializedWorkerError };

/** Main-thread helper: the open message and its transfer list (the bytes move, no copy). */
export function renderOpenRequest(
  reqId: number,
  bytes: Uint8Array<ArrayBuffer>,
  preview?: OpenRequest["preview"],
  options?: RendererOptions,
): [OpenRequest, Transferable[]] {
  const msg: OpenRequest = { type: "open", reqId, bytes };
  if (preview) msg.preview = preview;
  if (options) msg.options = options;
  return [msg, [bytes.buffer]];
}

type Job =
  | { kind: "open"; reqId: number; bytes: Uint8Array; preview?: OpenRequest["preview"]; options: RendererOptions; queuedAt: number }
  | { kind: "tile"; req: RenderTileRequest; preview: boolean; progressive?: boolean; queuedAt: number }
  | { kind: "close"; reqId: number; queuedAt: number };

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Protocol state machine. `post` sends a reply (with its transfer list);
 * `transferOf` names the transferables of a rendered bitmap.
 */
export class RenderWorkerHost<B> {
  private readonly queue: Job[] = [];
  private running: { reqId: number; abort: AbortController } | null = null;
  private pumping = false;
  private pages: PageInfo[] | null = null;

  constructor(
    private readonly renderer: TileRenderer<B>,
    private readonly post: (reply: RenderWorkerReply<B>, transfer: Transferable[]) => void,
    private readonly transferOf: (bitmap: B) => Transferable[] = () => [],
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Handles one incoming message. Never throws; malformed input gets an error reply. */
  handle(data: unknown): void {
    const msg = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
    if (msg.type === "cancel") {
      this.cancel(msg);
      return;
    }
    const reqId = isFiniteNumber(msg.reqId) ? msg.reqId : null;
    if (reqId === null) return this.error(null, new TypeError("reqId must be a finite number"));
    const queuedAt = this.now();
    switch (msg.type) {
      case "open": {
        const bytes =
          msg.bytes instanceof Uint8Array ? msg.bytes : msg.bytes instanceof ArrayBuffer ? new Uint8Array(msg.bytes) : null;
        if (!bytes) return this.error(reqId, new TypeError("bytes must be a Uint8Array or an ArrayBuffer"));
        const preview = msg.preview as OpenRequest["preview"] | undefined;
        const okPreview =
          isIndex(preview?.page) && preview.page >= 1 && Number.isInteger(preview.bucket) &&
          isFiniteNumber(preview.maxWidth) && preview.maxWidth >= 1 && isFiniteNumber(preview.maxHeight) && preview.maxHeight >= 1;
        if (preview !== undefined && !okPreview) {
          return this.error(reqId, new TypeError("invalid preview"));
        }
        const raw = (typeof msg.options === "object" && msg.options !== null ? msg.options : {}) as Record<string, unknown>;
        const options: RendererOptions = {};
        if (raw.pdfjsWorker === "inline" || raw.pdfjsWorker === "nested") options.pdfjsWorker = raw.pdfjsWorker;
        this.queue.push({ kind: "open", reqId, bytes, preview, options, queuedAt });
        break;
      }
      case "renderTile": {
        const r = msg as Partial<RenderTileRequest>;
        const valid =
          isIndex(r.page) && r.page >= 1 && Number.isInteger(r.bucket) && isFiniteNumber(r.scale) && r.scale > 0 &&
          isIndex(r.col) && isIndex(r.row) && Number.isInteger(r.tileSize) && (r.tileSize as number) > 0;
        if (!valid) return this.error(reqId, new TypeError("invalid renderTile request"));
        this.queue.push({ kind: "tile", req: r as RenderTileRequest, preview: false, queuedAt });
        break;
      }
      case "close":
        this.cancelAll();
        this.queue.push({ kind: "close", reqId, queuedAt });
        break;
      default:
        return this.error(reqId, new TypeError("Unknown request type"));
    }
    void this.pump();
  }

  /** Resolves when the queue is empty and nothing runs (tests). */
  async idle(): Promise<void> {
    while (this.pumping || this.queue.length > 0) await new Promise((r) => setTimeout(r, 0));
  }

  private cancel(msg: Record<string, unknown>): void {
    if (msg.all === true) return this.cancelAll();
    const ids = Array.isArray(msg.reqIds) ? new Set(msg.reqIds.filter(isFiniteNumber)) : new Set<number>();
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const job = this.queue[i];
      if (job.kind === "tile" && ids.has(job.req.reqId)) {
        this.queue.splice(i, 1);
        this.post({ type: "cancelled", reqId: job.req.reqId }, []);
      }
    }
    if (this.running && ids.has(this.running.reqId)) this.running.abort.abort();
  }

  /** Drops every queued tile (open and close jobs stay) and aborts the running tile. */
  private cancelAll(): void {
    const kept: Job[] = [];
    for (const job of this.queue) {
      if (job.kind === "tile") this.post({ type: "cancelled", reqId: job.req.reqId }, []);
      else kept.push(job);
    }
    this.queue.length = 0;
    this.queue.push(...kept);
    this.running?.abort.abort();
  }

  private error(reqId: number | null, e: unknown): void {
    this.post({ type: "error", reqId, error: serializeWorkerError(e) }, []);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) await this.run(job);
    } finally {
      this.pumping = false;
    }
  }

  private async run(job: Job): Promise<void> {
    if (job.kind === "open") {
      const t0 = this.now();
      try {
        if (this.pages) await this.renderer.close();
        this.pages = await this.renderer.open(job.bytes, job.options);
        this.post({ type: "opened", reqId: job.reqId, pages: this.pages, ms: this.now() - t0 }, []);
      } catch (e) {
        this.pages = null;
        return this.error(job.reqId, e);
      }
      const p = job.preview;
      if (p) {
        // One whole-page tile at the preview scale, ahead of anything queued.
        const page = this.pages[p.page - 1];
        if (!page) return this.error(job.reqId, new RangeError("preview page out of range"));
        const scale = Math.min(p.maxWidth / page.width, p.maxHeight / page.height);
        const size = Math.ceil(Math.max(page.width, page.height) * scale);
        this.queue.unshift({
          kind: "tile",
          preview: true,
          progressive: p.progressive === true,
          queuedAt: this.now(),
          req: { type: "renderTile", reqId: job.reqId, page: p.page, bucket: p.bucket, scale, col: 0, row: 0, tileSize: size },
        });
      }
      return;
    }
    if (job.kind === "close") {
      try {
        if (this.pages) await this.renderer.close();
        this.pages = null;
        this.post({ type: "closed", reqId: job.reqId }, []);
      } catch (e) {
        this.error(job.reqId, e);
      }
      return;
    }
    const { req } = job;
    const page = this.pages?.[req.page - 1];
    if (!this.pages) return this.error(req.reqId, new Error("No document is open"));
    if (!page) return this.error(req.reqId, new RangeError("page out of range"));
    const grid = tileGrid(page, req.scale, req.tileSize);
    if (req.col >= grid.cols || req.row >= grid.rows) return this.error(req.reqId, new RangeError("tile out of range"));
    const rect = tileRect(grid, req.col, req.row);
    const abort = new AbortController();
    this.running = { reqId: req.reqId, abort };
    const t0 = this.now();
    const base = { type: "tile", reqId: req.reqId, preview: job.preview, page: req.page, bucket: req.bucket, col: req.col, row: req.row, scale: req.scale, ...rect } as const;
    const onPartial = job.progressive
      ? (bitmap: B) => {
          if (abort.signal.aborted) return this.renderer.release(bitmap);
          const now = this.now();
          this.post({ ...base, partial: true, bitmap, renderMs: now - t0, waitMs: t0 - job.queuedAt }, this.transferOf(bitmap));
        }
      : undefined;
    try {
      const bitmap = await this.renderer.render({ page: req.page, scale: req.scale, ...rect }, abort.signal, onPartial);
      if (abort.signal.aborted) {
        // Finished after a cancel: drop it.
        this.renderer.release(bitmap);
        this.post({ type: "cancelled", reqId: req.reqId }, []);
        return;
      }
      const t1 = this.now();
      this.post(
        {
          ...base,
          partial: false,
          bitmap,
          renderMs: t1 - t0,
          waitMs: t0 - job.queuedAt,
        },
        this.transferOf(bitmap),
      );
    } catch (e) {
      if (abort.signal.aborted) this.post({ type: "cancelled", reqId: req.reqId }, []);
      else this.error(req.reqId, e);
    } finally {
      this.running = null;
    }
  }
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
  location: { origin: string };
};

declare const WorkerGlobalScope: (new () => unknown) | undefined;

// Wire up only inside a real worker (not in Vitest/Node). pdf.js loads lazily;
// messages that arrive before it is ready are queued.
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope;
  const pending: unknown[] = [];
  let host: RenderWorkerHost<ImageBitmap> | null = null;
  scope.addEventListener("message", (event) => {
    if (host) host.handle(event.data);
    else pending.push(event.data);
  });
  void import("./render-pdfjs")
    .then(({ PdfjsTileRenderer }) => {
      // Spike: pdf.js assets come from the dev-only /spike/pdfjs/ route (Epic 3 serves them statically).
      const renderer = new PdfjsTileRenderer(`${scope.location.origin}/spike/pdfjs/`);
      host = new RenderWorkerHost<ImageBitmap>(renderer, (reply, transfer) => scope.postMessage(reply, transfer), (b) => [b]);
      for (const data of pending.splice(0)) host.handle(data);
    })
    .catch((e: unknown) => scope.postMessage({ type: "error", reqId: null, error: serializeWorkerError(e) }, []));
}
