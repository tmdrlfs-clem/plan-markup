import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memoryTileBackend, TileCache } from "@/lib/idb/tile-cache";
import type { TextRun } from "@/core/pdf/sheet-label";
import { rasterCache } from "./render-cache";
import { RenderError, renderOpenMessage, type ContentFlags, type PageInfo, type RenderReply } from "./render-protocol";
import {
  RenderWorkerHost,
  deferredRasterCache,
  previewCacheKey,
  tileCacheKey,
  type RasterCache,
  type RenderedTile,
  type TileJob,
  type TileRenderer,
} from "./render.worker";

type Bitmap = { width: number; height: number; job?: TileJob; closed: boolean; partial?: boolean };

const VECTOR: ContentFlags = { hasVector: true, hasText: true, imageOnly: false };

/** Stub renderer: renders resolve at once unless `gate` is set; `openGate` holds open(). */
class StubRenderer implements TileRenderer<Bitmap> {
  pages: PageInfo[] = [{ width: 1000, height: 600, rotate: 0 }];
  content: ContentFlags | null = VECTOR;
  opened = 0;
  closed = 0;
  jobs: TileJob[] = [];
  gate: Promise<void> | null = null;
  openGate: Promise<void> | null = null;
  openError: Error | null = null;
  released: Bitmap[] = [];
  partials = 0;
  labels: (string | null)[] | null = null;
  runs: TextRun[] = [];
  textReads = 0;

  labelsGate: Promise<void> | null = null;

  async pageLabels(): Promise<(string | null)[] | null> {
    if (this.labelsGate) await this.labelsGate;
    return this.labels;
  }

  async textRuns(): Promise<TextRun[]> {
    this.textReads++;
    return this.runs;
  }

  async open(bytes: Uint8Array): Promise<PageInfo[]> {
    this.opened++;
    bytes.fill(0); // pdf.js detaches/consumes the bytes: the hash must come first
    if (this.openGate) await this.openGate;
    if (this.openError) throw this.openError;
    return this.pages;
  }

  async render(job: TileJob, signal: AbortSignal, onPartial?: (b: Bitmap) => void): Promise<RenderedTile<Bitmap>> {
    this.jobs.push(job);
    for (let i = 0; i < this.partials; i++) onPartial?.({ width: job.width, height: job.height, closed: false, partial: true });
    if (this.gate) {
      await Promise.race([
        this.gate,
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
      ]);
    }
    return {
      bitmap: { width: job.width, height: job.height, job, closed: false },
      encoded: job.encode ? Promise.resolve(new Blob([`${job.width}x${job.height}`])) : null,
      content: job.content ? this.content : undefined,
    };
  }

  release(bitmap: Bitmap): void {
    bitmap.closed = true;
    this.released.push(bitmap);
  }

  async close(): Promise<void> {
    this.closed++;
  }
}

function setup(cache: RasterCache<Bitmap> | null = null) {
  const renderer = new StubRenderer();
  const replies: RenderReply<Bitmap>[] = [];
  const transfers: Transferable[][] = [];
  let t = 0;
  const host = new RenderWorkerHost<Bitmap>(
    renderer,
    (reply, transfer) => {
      replies.push(reply);
      transfers.push(transfer);
    },
    (b) => [b as unknown as Transferable],
    cache,
    () => (t += 1),
  );
  return { renderer, replies, transfers, host };
}

const PDF = () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const PAGE_A = { width: 1000, height: 600, rotate: 0 };
/** A title block: caption plus a large drawing number in the bottom-right corner, among body text. */
const TITLE_RUNS: TextRun[] = [
  { str: "GRID A", x: 100, y: 100, width: 30, fontSize: 8 },
  { str: "NOTES", x: 120, y: 140, width: 30, fontSize: 8 },
  { str: "DRAWING NUMBER", x: 860, y: 560, width: 60, fontSize: 6 },
  { str: "FP-301", x: 870, y: 585, width: 50, fontSize: 18 },
];
const sheetLabel = (reqId: number, page = 1) => ({ type: "render.sheetLabel", reqId, payload: { page } });
const SHA = createHash("sha256").update(PDF()).digest("hex");
const open = (reqId: number, bytes = PDF()) => ({ type: "render.open", reqId, payload: { bytes: bytes.buffer } });
const preview = (reqId: number, extra: Record<string, unknown> = {}) => ({
  type: "render.preview",
  reqId,
  payload: { page: 1, maxWidth: 500, maxHeight: 500, ...extra },
});
const tile = (reqId: number, col = 0, row = 0, extra: Record<string, unknown> = {}) => ({
  type: "render.tile",
  reqId,
  payload: { page: 1, bucket: 0, scale: 1, col, row, tileSize: 512, ...extra },
});

const byReq = (replies: RenderReply<Bitmap>[], reqId: number) => replies.filter((r) => r.reqId === reqId);
const resultOf = (replies: RenderReply<Bitmap>[], reqId: number) => {
  const r = byReq(replies, reqId).find((x) => x.type === "result");
  if (!r || r.type !== "result") throw new Error(`no result for ${reqId}: ${JSON.stringify(byReq(replies, reqId))}`);
  return r.payload as Record<string, unknown>;
};
const codeOf = (replies: RenderReply<Bitmap>[], reqId: number) => {
  const r = byReq(replies, reqId).find((x) => x.type === "error");
  return r?.type === "error" ? r.code : null;
};

describe("RenderWorkerHost: open", () => {
  it("hashes the bytes before pdf.js gets them and returns the page geometry", async () => {
    const { host, replies, renderer } = setup();
    renderer.pages = [
      { width: 2384, height: 1684, rotate: 0 },
      { width: 595, height: 842, rotate: 90 },
    ];
    host.handle(open(1));
    await host.idle();
    expect(resultOf(replies, 1)).toEqual({ sha256: SHA, pageCount: 2, pages: renderer.pages, pageLabels: null, fromCache: false });
  });

  it("returns the cleaned page labels, and null when they are only the page numbers", async () => {
    const { host, replies, renderer } = setup();
    renderer.pages = [PAGE_A, PAGE_A];
    renderer.labels = ["A1721 - LEVEL 17\u0000", "2"];
    host.handle(open(1));
    await host.idle();
    expect(resultOf(replies, 1).pageLabels).toEqual(["A1721 - LEVEL 17", "2"]);
    renderer.labels = ["1", "2"];
    host.handle(open(2));
    await host.idle();
    expect(resultOf(replies, 2).pageLabels).toBeNull();
  });

  it.each([
    [new RenderError("password-required", "pw"), "password-required"],
    [new RenderError("invalid-pdf", "bad"), "invalid-pdf"],
    [new Error("anything else"), "render-failed"],
  ] as const)("maps an open failure to its code (%s)", async (error, code) => {
    const { host, replies, renderer } = setup();
    renderer.openError = error;
    host.handle(open(1));
    await host.idle();
    expect(codeOf(replies, 1)).toBe(code);
    host.handle(tile(2));
    await host.idle();
    expect(codeOf(replies, 2)).toBe("no-document");
  });

  it("rejects a document without pages as invalid", async () => {
    const { host, replies, renderer } = setup();
    renderer.pages = [];
    host.handle(open(1));
    await host.idle();
    expect(codeOf(replies, 1)).toBe("invalid-pdf");
  });

  it("transfers the bytes with renderOpenMessage", () => {
    const bytes = PDF().buffer;
    const [msg, transfer] = renderOpenMessage(7, bytes);
    expect(msg).toEqual({ type: "render.open", reqId: 7, payload: { bytes } });
    expect(transfer).toEqual([bytes]);
  });
});

describe("RenderWorkerHost: preview and tiles", () => {
  it("renders a fitted whole-page preview with the content flags and transfers it", async () => {
    const { host, replies, transfers, renderer } = setup();
    renderer.content = { hasVector: false, hasText: false, imageOnly: true };
    host.handle(open(1));
    host.handle(preview(2));
    await host.idle();
    const out = resultOf(replies, 2) as { tile: { bitmap: Bitmap; width: number; height: number; bucket: null }; content: ContentFlags };
    expect(out.content).toEqual({ hasVector: false, hasText: false, imageOnly: true });
    expect(out.tile.bucket).toBeNull();
    expect([out.tile.width, out.tile.height]).toEqual([500, 300]);
    expect(renderer.jobs[0]).toMatchObject({ x: 0, y: 0, width: 500, height: 300, content: true, encode: false });
    expect(transfers[replies.indexOf(byReq(replies, 2)[0])]).toEqual([out.tile.bitmap]);
  });

  it("posts progressive snapshots as progress before the result", async () => {
    const { host, replies, renderer } = setup();
    renderer.partials = 2;
    host.handle(open(1));
    host.handle(preview(2, { progressive: true }));
    await host.idle();
    expect(byReq(replies, 2).map((r) => r.type)).toEqual(["progress", "progress", "result"]);
  });

  it("renders a tile rectangle and refuses tiles outside the grid or before an open", async () => {
    const { host, replies, renderer } = setup();
    host.handle(tile(1));
    await host.idle();
    expect(codeOf(replies, 1)).toBe("no-document");
    host.handle(open(2));
    host.handle(tile(3, 1, 0));
    host.handle(tile(4, 2, 0));
    host.handle(tile(5, 0, 0, { page: 2 }));
    await host.idle();
    expect(renderer.jobs[0]).toMatchObject({ page: 1, scale: 1, x: 512, y: 0, width: 488, height: 512, content: false });
    expect(resultOf(replies, 3)).toMatchObject({ tile: { col: 1, row: 0, bucket: 0, fromCache: false } });
    expect(codeOf(replies, 4)).toBe("out-of-range");
    expect(codeOf(replies, 5)).toBe("out-of-range");
  });

  it("answers malformed requests with invalid-request (reqId kept when usable)", async () => {
    const { host, replies } = setup();
    host.handle(tile(1, -1));
    host.handle({ type: "render.tile", reqId: 2, payload: { page: 1 } });
    host.handle({ type: "render.nope", reqId: 3, payload: {} });
    host.handle({ type: "render.open", reqId: 4, payload: { bytes: "not bytes" } });
    host.handle(null);
    host.handle({ type: "render.open", reqId: Number.NaN, payload: {} });
    await host.idle();
    expect(replies.map((r) => (r.type === "error" ? [r.reqId, r.code] : r.type))).toEqual([
      [1, "invalid-request"],
      [2, "invalid-request"],
      [3, "invalid-request"],
      [4, "invalid-request"],
      [null, "invalid-request"],
      [null, "invalid-request"],
    ]);
  });
});

describe("RenderWorkerHost: cancel and close", () => {
  it("cancels queued and running requests, each with a cancelled error, and acks the cancel", async () => {
    const { host, replies, renderer } = setup();
    host.handle(open(1));
    await host.idle();
    let release!: () => void;
    renderer.gate = new Promise((r) => (release = r));
    host.handle(tile(2, 0));
    host.handle(tile(3, 1));
    host.handle(tile(4, 0, 1));
    await new Promise((r) => setTimeout(r, 0));
    host.handle({ type: "render.cancel", reqId: 5, payload: { reqIds: [2, 3, 999] } });
    release();
    await host.idle();
    expect(codeOf(replies, 2)).toBe("cancelled");
    expect(codeOf(replies, 3)).toBe("cancelled");
    expect(resultOf(replies, 4)).toBeTruthy();
    expect(resultOf(replies, 5)).toEqual({});
  });

  it("cancel all drops every queued tile; a new open also drops them", async () => {
    const { host, replies } = setup();
    host.handle(open(1));
    host.handle(tile(2));
    host.handle(tile(3));
    host.handle({ type: "render.cancel", reqId: 4, payload: { all: true } });
    await host.idle();
    expect(codeOf(replies, 1)).toBe("cancelled"); // the running open is aborted too
    expect([codeOf(replies, 2), codeOf(replies, 3)]).toEqual(["cancelled", "cancelled"]);
  });

  it("a second open supersedes queued work for the first document", async () => {
    const { host, replies } = setup();
    host.handle(open(1));
    host.handle(tile(2));
    host.handle(open(3));
    await host.idle();
    expect(codeOf(replies, 1)).toBe("cancelled");
    expect(codeOf(replies, 2)).toBe("cancelled");
    expect(resultOf(replies, 3)).toMatchObject({ sha256: SHA });
  });

  it("close releases the document and acks", async () => {
    const { host, replies, renderer } = setup();
    host.handle(open(1));
    await host.idle();
    host.handle({ type: "render.close", reqId: 2, payload: {} });
    await host.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(resultOf(replies, 2)).toEqual({});
    expect(renderer.closed).toBe(1);
    host.handle(tile(3));
    await host.idle();
    expect(codeOf(replies, 3)).toBe("no-document");
  });
});

describe("RenderWorkerHost: raster cache", () => {
  function cached() {
    const backend = memoryTileBackend();
    const decode = async (blob: Blob): Promise<Bitmap> => {
      const [w, h] = (await blob.text()).split("x").map(Number);
      return { width: w, height: h, closed: false };
    };
    return rasterCache(new TileCache(backend), decode);
  }

  it("stores the document, preview and tiles, and a reopen answers from the cache before pdf.js", async () => {
    const cache = cached();
    const first = setup(cache);
    first.host.handle(open(1));
    first.host.handle(preview(2));
    first.host.handle(tile(3));
    await first.host.idle();
    await new Promise((r) => setTimeout(r, 0)); // stores are fire-and-forget
    expect(await cache.getTile(previewCacheKey(SHA, 1, 0.5))).toMatchObject({ width: 500, height: 300 });
    const key = tileCacheKey(SHA, { page: 1, bucket: 0, scale: 1, col: 0, row: 0, tileSize: 512 });
    expect(await cache.getTile(key)).toMatchObject({ width: 512, height: 512 });

    // Reopen: pdf.js never finishes, yet open, preview and the cached tile all answer.
    const second = setup(cache);
    second.renderer.openGate = new Promise(() => undefined);
    second.host.handle(open(1));
    second.host.handle(preview(2));
    second.host.handle(tile(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(resultOf(second.replies, 1)).toMatchObject({ sha256: SHA, pageCount: 1, fromCache: true });
    expect(resultOf(second.replies, 2)).toMatchObject({ content: VECTOR, tile: { fromCache: true, width: 500, scale: 0.5 } });
    expect(resultOf(second.replies, 3)).toMatchObject({ tile: { fromCache: true, col: 0, row: 0 } });
    expect(second.renderer.jobs).toHaveLength(0);
  });

  it("a sheet-label job waits for pdf.js without holding up cached tiles queued after it", async () => {
    const cache = cached();
    const first = setup(cache);
    first.renderer.runs = TITLE_RUNS;
    first.host.handle(open(1));
    first.host.handle(tile(2));
    await first.host.idle();
    await new Promise((r) => setTimeout(r, 0));

    const second = setup(cache);
    second.renderer.runs = TITLE_RUNS;
    let ready!: () => void;
    second.renderer.openGate = new Promise((r) => (ready = r));
    second.host.handle(open(1));
    second.host.handle(sheetLabel(2)); // not cached yet: needs pdf.js
    second.host.handle(tile(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(resultOf(second.replies, 3)).toMatchObject({ tile: { fromCache: true } });
    expect(byReq(second.replies, 2)).toHaveLength(0);
    ready();
    await second.host.idle();
    expect(resultOf(second.replies, 2)).toEqual({ label: "FP-301" });
  });

  it("runs sheet-label jobs after the queued previews and tiles", async () => {
    const { host, replies, renderer } = setup();
    renderer.runs = TITLE_RUNS;
    host.handle(open(1));
    host.handle(sheetLabel(2));
    host.handle(preview(3));
    host.handle(tile(4));
    await host.idle();
    const order = replies.filter((r) => r.type === "result").map((r) => r.reqId);
    expect(order).toEqual([1, 3, 4, 2]);
  });

  it("an old entry's unknown page labels are not stored as 'none' while they are being read", async () => {
    const cache = cached();
    await cache.putDoc(SHA, { pages: [PAGE_A], content: [null] });
    const { host, renderer } = setup(cache);
    renderer.pages = [PAGE_A];
    renderer.labels = ["X-101 - PLAN"];
    let labelsRead!: () => void;
    renderer.labelsGate = new Promise((r) => (labelsRead = r));
    host.handle(open(1));
    host.handle(preview(2)); // a cache miss: renders, then stores the content flags
    await host.idle();
    await new Promise((r) => setTimeout(r, 10));
    const meta = await cache.getDoc(SHA);
    expect(meta?.content[0]).toEqual(VECTOR);
    expect(meta?.pageLabels).toBeUndefined();
    labelsRead();
    await new Promise((r) => setTimeout(r, 10));
    expect((await cache.getDoc(SHA))?.pageLabels).toEqual(["X-101 - PLAN"]);
  });

  it("keeps page labels and detected sheet labels with the document: a reopen answers from the cache", async () => {
    const cache = cached();
    const first = setup(cache);
    first.renderer.labels = ["S-1", "S-2"];
    first.renderer.pages = [PAGE_A, PAGE_A];
    first.renderer.runs = TITLE_RUNS;
    first.host.handle(open(1));
    first.host.handle(sheetLabel(2, 2));
    await first.host.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(resultOf(first.replies, 2)).toEqual({ label: "FP-301" });

    const second = setup(cache);
    let ready!: () => void;
    second.renderer.openGate = new Promise((r) => (ready = r));
    second.host.handle(open(1));
    second.host.handle(sheetLabel(2, 2));
    await new Promise((r) => setTimeout(r, 10));
    // Both answered before pdf.js has parsed anything.
    expect(resultOf(second.replies, 1)).toMatchObject({ fromCache: true, pageLabels: ["S-1", "S-2"] });
    expect(resultOf(second.replies, 2)).toEqual({ label: "FP-301" });
    expect(second.renderer.textReads).toBe(0);
    ready();
    await second.host.idle();
  });

  it("an entry cached before page labels were stored reads them once pdf.js is ready", async () => {
    const cache = cached();
    await cache.putDoc(SHA, { pages: [PAGE_A], content: [null] });
    const { host, replies, renderer } = setup(cache);
    renderer.labels = ["X-101 - PLAN"];
    host.handle(open(1));
    await host.idle();
    expect(resultOf(replies, 1)).toMatchObject({ fromCache: true, pageLabels: null });
    await new Promise((r) => setTimeout(r, 10));
    expect((await cache.getDoc(SHA))?.pageLabels).toEqual(["X-101 - PLAN"]);
  });

  it("a cache miss on reopen waits for pdf.js, then renders", async () => {
    const cache = cached();
    const first = setup(cache);
    first.host.handle(open(1));
    first.host.handle(preview(2));
    await first.host.idle();
    await new Promise((r) => setTimeout(r, 0));

    const second = setup(cache);
    let ready!: () => void;
    second.renderer.openGate = new Promise((r) => (ready = r));
    second.host.handle(open(1));
    second.host.handle(tile(2, 1, 0));
    await new Promise((r) => setTimeout(r, 10));
    expect(byReq(second.replies, 2)).toHaveLength(0);
    ready();
    await second.host.idle();
    expect(resultOf(second.replies, 2)).toMatchObject({ tile: { fromCache: false, col: 1 } });
  });

  it("a cached open whose pdf.js load later fails reports the failure on the next miss", async () => {
    const cache = cached();
    const first = setup(cache);
    first.host.handle(open(1));
    await first.host.idle();
    const second = setup(cache);
    second.renderer.openError = new RenderError("invalid-pdf", "bad");
    second.host.handle(open(1));
    second.host.handle(tile(2));
    await second.host.idle();
    expect(resultOf(second.replies, 1)).toMatchObject({ fromCache: true });
    expect(codeOf(second.replies, 2)).toBe("invalid-pdf");
  });

  it("keys the preview by its scale step: a reopen at another size renders and stores a fresh one", async () => {
    const cache = cached();
    const first = setup(cache);
    first.host.handle(open(1));
    first.host.handle(preview(2));
    await first.host.idle();
    await new Promise((r) => setTimeout(r, 0));

    const second = setup(cache);
    second.host.handle(open(1));
    second.host.handle(preview(2, { maxWidth: 800, maxHeight: 800 })); // 0.8 -> step 0.8 rounded up
    await second.host.idle();
    await new Promise((r) => setTimeout(r, 0));
    const out = resultOf(second.replies, 2) as { tile: { fromCache: boolean; scale: number; width: number } };
    expect(out.tile.fromCache).toBe(false);
    expect(out.tile.scale).toBeGreaterThanOrEqual(0.8);
    expect(out.tile.width).toBe(Math.ceil(1000 * out.tile.scale));
    expect(await cache.getTile(previewCacheKey(SHA, 1, out.tile.scale))).toMatchObject({ width: out.tile.width });
    // The old size is still there for windows of that size.
    expect(await cache.getTile(previewCacheKey(SHA, 1, 0.5))).toMatchObject({ width: 500 });
  });

  it("renders tiles at the quantised scale, so nearby scales share cache entries", async () => {
    const cache = cached();
    const first = setup(cache);
    first.host.handle(open(1));
    first.host.handle(tile(2, 0, 0, { scale: 0.9999 }));
    await first.host.idle();
    await new Promise((r) => setTimeout(r, 0));
    expect(first.renderer.jobs[0].scale).toBe(1); // 0.9999 rounds up to step 0 (scale 1)
    expect(resultOf(first.replies, 2)).toMatchObject({ tile: { scale: 1, fromCache: false } });

    const second = setup(cache);
    second.host.handle(open(1));
    second.host.handle(tile(2, 0, 0, { scale: 0.99995, bucket: 1 }));
    await second.host.idle();
    expect(resultOf(second.replies, 2)).toMatchObject({ tile: { scale: 1, fromCache: true } });
    expect(tileCacheKey(SHA, { page: 1, bucket: 0, scale: 0.9999, col: 0, row: 0, tileSize: 512 })).toBe(`${SHA}:1:s0:512:0:0`);
  });

  it("a cancel or close while the cache looks the document up installs nothing and answers cancelled", async () => {
    for (const stop of [
      { type: "render.cancel", reqId: 9, payload: { all: true } },
      { type: "render.close", reqId: 9, payload: {} },
    ]) {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const inner = cached();
      const slow: RasterCache<Bitmap> = { ...inner, getDoc: async (sha) => (await gate, inner.getDoc(sha)) };
      const { host, replies, renderer } = setup(slow);
      host.handle(open(1));
      await new Promise((r) => setTimeout(r, 0));
      host.handle(stop);
      release();
      await host.idle();
      await new Promise((r) => setTimeout(r, 0));
      expect(codeOf(replies, 1)).toBe("cancelled");
      expect(byReq(replies, 1).filter((r) => r.type === "result")).toHaveLength(0);
      expect(renderer.opened).toBe(0);
      host.handle(tile(3));
      await host.idle();
      expect(codeOf(replies, 3)).toBe("no-document");
    }
  });
});

describe("deferredRasterCache", () => {
  it("waits for the opening cache and treats a failed or empty one as misses", async () => {
    const inner = { getDoc: async () => ({ pages: [], content: [] }), putDoc: async () => undefined, getTile: async () => 1, putTile: async () => undefined };
    let resolve!: (c: RasterCache<number> | null) => void;
    const deferred = deferredRasterCache<number>(new Promise((r) => (resolve = r)));
    const tile = deferred.getTile("k");
    resolve(inner);
    expect(await tile).toBe(1);
    const none = deferredRasterCache<number>(Promise.reject(new Error("no idb")));
    expect(await none.getTile("k")).toBeNull();
    expect(await none.getDoc("s")).toBeNull();
    await expect(none.putTile("k", new Blob())).resolves.toBeUndefined();
  });
});

describe("RenderWorkerHost: render.sheetLabel", () => {
  it("detects the page's sheet number from its text, once per page", async () => {
    const { host, replies, renderer } = setup();
    renderer.runs = TITLE_RUNS;
    host.handle(open(1));
    host.handle(sheetLabel(2));
    host.handle(sheetLabel(3));
    await host.idle();
    expect(resultOf(replies, 2)).toEqual({ label: "FP-301" });
    expect(resultOf(replies, 3)).toEqual({ label: "FP-301" });
    expect(renderer.textReads).toBe(1);
  });

  it("answers null when unsure, and out-of-range for a missing page", async () => {
    const { host, replies, renderer } = setup();
    renderer.runs = [{ str: "A101 A102", x: 800, y: 500, width: 60, fontSize: 14 }];
    host.handle(open(1));
    host.handle(sheetLabel(2));
    host.handle(sheetLabel(3, 5));
    await host.idle();
    expect(resultOf(replies, 2)).toEqual({ label: null });
    expect(codeOf(replies, 3)).toBe("out-of-range");
  });
});
