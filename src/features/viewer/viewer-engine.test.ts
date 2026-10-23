import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderPayloadMap, RenderVerb } from "@/workers/render-protocol";
import { WorkerRequestError, type RenderClient } from "@/workers/rpc";

import { ViewerEngine, clearDocumentViews, type ViewerCanvases } from "./viewer-engine";
import { canvasStateOf, type ViewerState } from "./viewer-store";

type Call = {
  type: RenderVerb;
  reqId: number;
  payload: unknown;
  transfer?: Transferable[];
  onProgress?: (p: unknown) => void;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

/** Fake RenderClient: records requests; the test resolves them. */
class FakeClient {
  calls: Call[] = [];
  cancelled: number[] = [];
  terminated = false;
  private seq = 1;
  request<V extends RenderVerb>(type: V, payload: RenderPayloadMap[V], opts: { transfer?: Transferable[]; onProgress?: (p: unknown) => void } = {}) {
    const reqId = this.seq++;
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.calls.push({ type, reqId, payload, transfer: opts.transfer, onProgress: opts.onProgress, resolve, reject });
    return { reqId, promise };
  }
  cancel(ids: readonly number[]) {
    this.cancelled.push(...ids);
  }
  terminate() {
    this.terminated = true;
  }
  last(type: RenderVerb): Call {
    const c = this.calls.filter((x) => x.type === type).at(-1);
    if (!c) throw new Error(`no ${type} call`);
    return c;
  }
  all(type: RenderVerb): Call[] {
    return this.calls.filter((x) => x.type === type);
  }
}

const canvas = () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;
const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const PAGE = { width: 1000, height: 500, rotate: 0 };

function tilePayload(scale: number, extra: Record<string, unknown> = {}) {
  const width = Math.ceil(PAGE.width * scale);
  const height = Math.ceil(PAGE.height * scale);
  return { page: 1, bucket: null, col: 0, row: 0, scale, x: 0, y: 0, width, height, bitmap: bitmap(width, height), fromCache: false, renderMs: 1, waitMs: 0, ...extra };
}

let state: Partial<ViewerState>;
let frames: (() => void)[];

function setup() {
  const client = new FakeClient();
  const canvases: ViewerCanvases = { tiles: canvas(), markups: canvas(), active: canvas() };
  frames = [];
  let t = 0;
  const engine = new ViewerEngine(canvases, client as unknown as RenderClient, (patch) => Object.assign(state, patch), {
    now: () => (t += 10),
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => undefined,
  });
  engine.setViewport(1032, 532, 1);
  return { client, engine, canvases };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const paint = () => frames.splice(0).forEach((f) => f());
const file = (name = "a.pdf") => new File([new Uint8Array([37, 80, 68, 70])], name, { type: "application/pdf" });

beforeEach(() => {
  clearDocumentViews();
  state = { status: "loading", failedTiles: 0, content: null, error: null };
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

/** Opens a file up to the preview request (the open promise itself settles with the preview). */
async function openToPreview(client: FakeClient, engine: ViewerEngine): Promise<void> {
  void engine.open(file());
  await flush();
  client.last("render.open").resolve({ sha256: "s", pageCount: 3, pages: [PAGE], fromCache: false });
  await flush();
}

describe("ViewerEngine", () => {
  it("sizes the canvases to the viewport x DPR", () => {
    const { engine, canvases } = setup();
    engine.setViewport(800, 600, 1.5);
    expect([canvases.tiles.width, canvases.tiles.height]).toEqual([1200, 900]);
    expect([canvases.active.width, canvases.markups.height]).toEqual([1200, 900]);
  });

  it("transfers the file bytes, fits the page and asks for a fitted progressive preview", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    const open = client.last("render.open");
    expect(open.transfer).toEqual([(open.payload as { bytes: ArrayBuffer }).bytes]);
    expect(state.pageCount).toBe(3);
    expect(engine.view).toEqual({ zoom: 1, centerX: 500, centerY: 250, rotation: 0 }); // (1032 - 2 x FIT_PADDING) / 1000
    expect(client.last("render.preview").payload).toEqual({ page: 1, maxWidth: 1000, maxHeight: 500, progressive: true });
  });

  it("goes ready with timings only after the complete preview is painted, and shows partials before", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    const preview = client.last("render.preview");
    preview.onProgress?.({ tile: tilePayload(0.5) });
    paint();
    expect(state.status).toBe("loading");
    expect(state.timings?.firstPartialMs).toBeGreaterThan(0);
    preview.resolve({ tile: tilePayload(1), content: { hasVector: true, hasText: false, imageOnly: false } });
    await flush();
    expect(state.status).toBe("loading");
    paint();
    expect(state.status).toBe("ready");
    expect(state.timings?.firstFrameMs).toBeGreaterThan(0);
    expect(canvasStateOf(state as ViewerState)).toBe("ready");
  });

  it("requests no tiles while the preview is as sharp as the bucket (fit page)", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    vi.runAllTimers();
    expect(client.all("render.tile")).toHaveLength(0);
  });

  it("requests tiles of the bucket when the view needs more than the preview, and retries failures", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2); // bucket 1: 2 device px per point
    vi.runAllTimers();
    const tiles = client.all("render.tile");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0].payload).toMatchObject({ page: 1, bucket: 1, scale: 2, tileSize: 512 });
    tiles[0].reject(new WorkerRequestError("render-failed", { name: "Error", message: "x" }));
    tiles[1].reject(new WorkerRequestError("cancelled", { name: "Error", message: "c" }));
    await flush();
    expect(state.failedTiles).toBe(1);
    expect(canvasStateOf({ status: "ready", content: null, failedTiles: 1, error: null })).toBe("render-error");
    const before = client.all("render.tile").length;
    engine.retryFailedTiles();
    expect(state.failedTiles).toBe(0);
    expect(client.all("render.tile").length).toBeGreaterThan(before);
  });

  it("a resize at the same zoom keeps every tile: buckets are absolute (2^k device px per point)", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2);
    vi.runAllTimers();
    const first = client.all("render.tile");
    resolveTiles(first);
    await flush();
    const before = client.calls.length;
    // A panel toggle / window resize: same zoom, other viewport. Nothing is cancelled or re-rendered.
    engine.setViewport(900, 532, 1);
    engine.setViewport(1032, 532, 1);
    vi.runAllTimers();
    expect(client.cancelled).toEqual([]);
    expect(client.calls.length).toBe(before);
  });

  it("a DPR change keeps the tiles; the new bucket is requested at settle and stale requests cancelled there", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2);
    vi.runAllTimers();
    const first = client.all("render.tile");
    expect((first[0].payload as { scale: number }).scale).toBe(2);
    const pending = first.map((c) => c.reqId);
    engine.setViewport(1032, 532, 1.5); // zoom 2 x DPR 1.5 = 3 device px per point -> bucket 2
    expect(client.cancelled).toEqual([]);
    vi.runAllTimers();
    expect(client.cancelled).toEqual(expect.arrayContaining(pending));
    const next = client.all("render.tile").slice(first.length);
    expect(next.length).toBeGreaterThan(0);
    expect(next[0].payload).toMatchObject({ bucket: 2, scale: 4 });
    // A late reply for a cancelled request is dropped, not drawn.
    const late = tilePayload(2);
    first[1].resolve({ tile: late });
    await flush();
    expect(late.bitmap.close).toHaveBeenCalled();
  });

  it("scopes failed tiles to the target bucket: leaving it clears the alert, returning retries", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2); // bucket 1
    vi.runAllTimers();
    const first = client.all("render.tile");
    first[0].reject(new WorkerRequestError("render-failed", { name: "Error", message: "x" }));
    await flush();
    expect(state.failedTiles).toBe(1);
    const failedPayload = first[0].payload;
    engine.zoomBy(2); // bucket 2
    vi.runAllTimers();
    expect(state.failedTiles).toBe(0);
    engine.zoomBy(0.5); // back to bucket 1: the failed tile is asked for again
    vi.runAllTimers();
    const again = client.all("render.tile").filter((c) => JSON.stringify(c.payload) === JSON.stringify(failedPayload));
    expect(again).toHaveLength(2);
  });

  it("a failure arriving after the view left its bucket raises no alert", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2);
    vi.runAllTimers();
    const call = client.all("render.tile")[0];
    engine.zoomBy(2); // not settled yet: the request is still in flight
    call.reject(new WorkerRequestError("render-failed", { name: "Error", message: "x" }));
    await flush();
    expect(state.failedTiles).toBe(0);
  });

  it("zooms past the old 8x cap: 6400 % uses its own bucket (64 device px per point)", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(64);
    vi.runAllTimers();
    const tiles = client.all("render.tile");
    expect(tiles[0].payload).toMatchObject({ bucket: 6, scale: 64 });
    // Only the viewport (plus a ring) is requested: 1032 x 532 px is at most 4 x 3 tiles, + ring 6 x 5.
    expect(tiles.length).toBeLessThanOrEqual(30);
  });

  it("a fatal worker failure on a tile shows the render error (Try again reopens)", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2);
    vi.runAllTimers();
    client.all("render.tile")[0].reject(new WorkerRequestError("worker-failed", { name: "WorkerError", message: "x" }));
    await flush();
    expect(state).toMatchObject({ status: "error", error: "render-failed" });
    expect(state.failedTiles).toBe(0);
  });

  it("maps open failures to inline file errors", async () => {
    for (const [code, expected] of [
      ["invalid-pdf", "invalid-pdf"],
      ["password-required", "password-required"],
      ["render-failed", "render-failed"],
    ] as const) {
      const { client, engine } = setup();
      const opening = engine.open(file());
      await flush();
      client.last("render.open").reject(new WorkerRequestError(code, { name: "Error", message: "x" }));
      await opening;
      expect(state).toMatchObject({ status: "error", error: expected });
    }
  });

  it("a second open cancels the first document's requests and ignores its late replies", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    const firstPreview = client.last("render.preview");
    const second = engine.open(file("b.pdf"));
    expect(client.cancelled).toContain(firstPreview.reqId);
    const late = tilePayload(1);
    firstPreview.resolve({ tile: late, content: null });
    await flush();
    expect(late.bitmap.close).toHaveBeenCalled();
    client.last("render.open").resolve({ sha256: "t", pageCount: 1, pages: [PAGE], fromCache: true });
    await flush();
    expect(client.all("render.preview")).toHaveLength(2);
    void second;
  });

  it("destroy terminates the worker", () => {
    const { client, engine } = setup();
    engine.destroy();
    expect(client.terminated).toBe(true);
  });
});

type Op = { op: string; args: unknown[] };

/** A canvas whose 2D context records draw calls. */
function recordingCanvas(ops: Op[]): HTMLCanvasElement {
  const ctx = new Proxy(
    {},
    {
      get: (_t, prop: string) => (prop === "canvas" ? undefined : (...args: unknown[]) => void ops.push({ op: prop, args })),
      set: () => true,
    },
  );
  return { width: 0, height: 0, dataset: {} as DOMStringMap, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

function setupRecording(budgetBytes?: number) {
  const client = new FakeClient();
  const ops: Op[] = [];
  const active: Op[] = [];
  const canvases: ViewerCanvases = { tiles: recordingCanvas(ops), markups: canvas(), active: recordingCanvas(active) };
  frames = [];
  let t = 0;
  const engine = new ViewerEngine(canvases, client as unknown as RenderClient, (patch) => Object.assign(state, patch), {
    now: () => (t += 10),
    requestFrame: (cb) => frames.push(cb),
    cancelFrame: () => undefined,
    budgetBytes,
  });
  engine.setViewport(1032, 532, 1);
  return { client, engine, ops, active, canvases };
}

/** Bitmaps drawn, in order. */
const drawn = (ops: Op[]) => ops.filter((o) => o.op === "drawImage").map((o) => o.args[0] as { width: number; height: number });

async function readyAtFit(client: FakeClient, engine: ViewerEngine) {
  await openToPreview(client, engine);
  client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
  await flush();
  vi.runAllTimers();
}

function resolveTiles(calls: Call[]) {
  for (const c of calls) {
    const p = c.payload as { scale: number; col: number; row: number; tileSize: number; bucket: number };
    const w = Math.min(p.tileSize, Math.ceil(PAGE.width * p.scale) - p.col * p.tileSize);
    const h = Math.min(p.tileSize, Math.ceil(PAGE.height * p.scale) - p.row * p.tileSize);
    const tile = { page: 1, bucket: p.bucket, col: p.col, row: p.row, scale: p.scale, x: p.col * p.tileSize, y: p.row * p.tileSize };
    c.resolve({ tile: { ...tile, width: w, height: h, bitmap: bitmap(w, h), fromCache: false, renderMs: 1, waitMs: 0 } });
  }
}

describe("ViewerEngine: gestures (Story 3.2)", () => {
  it("during a gesture only redraws (coalesced to one frame); tiles are requested once it settles", async () => {
    const { client, engine } = setupRecording();
    await readyAtFit(client, engine);
    paint();
    for (let i = 0; i < 10; i++) engine.zoomBy(1.1, { x: 100, y: 100 });
    engine.panBy(30, 0);
    expect(frames).toHaveLength(1);
    expect(client.all("render.tile")).toHaveLength(0);
    vi.advanceTimersByTime(149);
    expect(client.all("render.tile")).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(client.all("render.tile").length).toBeGreaterThan(0);
  });

  it("requests visible tiles first, centre first, and cancels the stale ones of the old view", async () => {
    const { client, engine } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(4); // bucket 2
    vi.runAllTimers();
    const first = client.all("render.tile");
    // The viewport centre at zoom 4 is page (500, 250) -> device (2000, 1000) -> tile (3, 1).
    expect(first[0].payload).toMatchObject({ col: 3, row: 1 });
    engine.panBy(-2000, 0); // far right: the old tiles are no longer needed
    vi.runAllTimers();
    const stale = first.map((c) => c.reqId).filter((id) => client.cancelled.includes(id));
    expect(stale.length).toBeGreaterThan(0);
  });

  it("keeps old-bucket tiles drawn underneath until the new bucket's tiles arrive", async () => {
    const { client, engine, ops } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(2); // bucket 1
    vi.runAllTimers();
    resolveTiles(client.all("render.tile"));
    await flush();
    paint();
    ops.length = 0;
    engine.panBy(0, 0);
    paint();
    const bucket1 = drawn(ops).length;
    expect(bucket1).toBeGreaterThan(1); // preview + bucket-1 tiles
    ops.length = 0;
    engine.zoomBy(2); // bucket 2, nothing rendered yet
    paint();
    // The preview and the bucket-1 tiles in view are still drawn (scaled): no blank flash.
    expect(drawn(ops).length).toBeGreaterThan(1);
  });

  it("draws every tile 1:1 at whole device px at its bucket scale, abutting, for many positions", async () => {
    const { client, engine, ops } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(2); // 2 device px per point: bucket 1 exactly
    vi.runAllTimers();
    for (let i = 0; i < 25; i++) {
      // Fractional pans put the page origin at every sub-pixel phase.
      engine.panBy(-37.37 - i * 0.13, -11.71 - i * 0.29);
      vi.runAllTimers();
      resolveTiles(client.all("render.tile")); // settling a promise twice is a no-op
      await flush();
      ops.length = 0;
      paint();
      const tiles = ops.filter((o) => o.op === "drawImage" && (o.args[0] as { width: number }).width !== 1000);
      expect(tiles.length).toBeGreaterThan(0);
      const lefts = new Map<number, number>();
      for (const t of tiles) {
        const [b, x, y, w, h] = t.args as [{ width: number; height: number }, number, number, number, number];
        expect([Number.isInteger(x), Number.isInteger(y), w, h]).toEqual([true, true, b.width, b.height]);
        lefts.set(x, w);
      }
      // Neighbours abut exactly: each tile's right edge is another tile's left edge (or the page edge).
      const xs = [...lefts.keys()].sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k++) expect(xs[k] + (lefts.get(xs[k]) ?? 0)).toBe(xs[k + 1]);
    }
  });

  it("draws tiles 1:1 in every view rotation (the box is the bitmap turned a quarter)", async () => {
    const { client, engine, ops } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(2);
    engine.panBy(0.37, -0.61);
    vi.runAllTimers();
    resolveTiles(client.all("render.tile"));
    await flush();
    for (const delta of [90, 90, 90] as const) {
      engine.rotate(delta);
      ops.length = 0;
      paint();
      const draws = ops.filter((o) => o.op === "drawImage" && (o.args[0] as { width: number }).width !== 1000);
      expect(draws.length).toBeGreaterThan(0);
      for (const d of draws) {
        const [b, x, y, w, h] = d.args as [{ width: number; height: number }, number, number, number, number];
        // Drawn about the box centre at the bitmap's own size.
        expect([w, h, x, y]).toEqual([b.width, b.height, -b.width / 2, -b.height / 2]);
      }
      const centres = ops.filter((o) => o.op === "setTransform" && (o.args as number[])[0] !== 1).map((o) => o.args as number[]);
      for (const [, , , , e, f] of centres) {
        // A centre on a whole or half pixel: the box edges are whole device px.
        expect(Number.isInteger(e * 2) && Number.isInteger(f * 2)).toBe(true);
      }
    }
  });

  it("fit page snaps to the preview's quantised scale and draws the preview 1:1 (any window, any DPR)", async () => {
    const { client, engine, ops } = setupRecording();
    engine.setViewport(1203.4, 777.7, 1.25);
    await openToPreview(client, engine);
    const box = client.last("render.preview").payload as { maxWidth: number; maxHeight: number };
    // The worker renders at quantizeScale(min(box / page)); emulate it.
    const raw = Math.min(box.maxWidth / PAGE.width, box.maxHeight / PAGE.height);
    const scale = 2 ** (Math.ceil(Math.log2(raw) * 1024 - 1e-4) / 1024);
    client.last("render.preview").resolve({ tile: tilePayload(scale), content: null });
    await flush();
    vi.runAllTimers();
    expect(engine.view.zoom * 1.25).toBeCloseTo(scale, 12);
    expect(client.all("render.tile")).toHaveLength(0);
    for (const pan of [0, 0.3, 0.55, 0.81]) {
      engine.fitPage();
      engine.setView({ ...engine.view, centerX: engine.view.centerX + pan });
      ops.length = 0;
      paint();
      const [b, x, y, w, h] = ops.find((o) => o.op === "drawImage")!.args as [{ width: number; height: number }, number, number, number, number];
      expect([Number.isInteger(x), Number.isInteger(y), w, h]).toEqual([true, true, b.width, b.height]);
    }
  });

  it("fit page after a resize re-renders the preview for the new fit box instead of requesting tiles", async () => {
    const { client, engine } = setupRecording();
    await readyAtFit(client, engine);
    engine.setViewport(2032, 1032, 1); // fit 2 (page 1000 x 500 in 2000 x 1000)
    vi.runAllTimers();
    expect(client.all("render.preview")).toHaveLength(2);
    expect(client.last("render.preview").payload).toEqual({ page: 1, maxWidth: 2000, maxHeight: 1000, progressive: false });
    expect(client.all("render.tile")).toHaveLength(0);
    // Another resize before it lands replaces the request.
    const firstRefresh = client.last("render.preview");
    engine.setViewport(1532, 782, 1);
    vi.runAllTimers();
    expect(client.cancelled).toContain(firstRefresh.reqId);
    client.last("render.preview").resolve({ tile: tilePayload(1.5), content: null });
    await flush();
    vi.runAllTimers();
    expect(client.all("render.preview")).toHaveLength(3);
  });

  it("draws only buckets that hold tiles, and no more tiles than the viewport needs", async () => {
    const { client, engine, ops } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(2);
    vi.runAllTimers();
    resolveTiles(client.all("render.tile"));
    await flush();
    const peek = vi.spyOn((engine as unknown as { cache: { peek: (k: string) => unknown } }).cache, "peek");
    ops.length = 0;
    paint();
    // Bucket 1 only: 1032 x 532 at 2 device px per point covers at most 3 x 2 tile slots.
    const keys = peek.mock.calls.map((c) => c[0]);
    expect(new Set(keys.map((k) => k.split(":")[1]))).toEqual(new Set(["1"]));
    expect(keys.length).toBeLessThanOrEqual(6);
  });

  it("rotating the view re-renders nothing and draws the same bitmaps turned a quarter", async () => {
    const { client, engine, ops } = setupRecording();
    await readyAtFit(client, engine);
    paint();
    const before = client.calls.length;
    engine.rotate(90);
    vi.runAllTimers();
    ops.length = 0;
    paint();
    expect(client.calls.length).toBe(before);
    expect(engine.view.rotation).toBe(90);
    expect(ops.some((o) => o.op === "setTransform" && (o.args as number[])[1] === 1)).toBe(true);
    // Still fitted: the page is 500 x 1000 on screen now.
    expect(engine.view.zoom).toBeCloseTo((532 - 32) / 1000, 9);
    engine.rotate(-90);
    expect(engine.view.rotation).toBe(0);
  });

  it("fit page / fit width keep fitting on resize; a zoom leaves fit mode", async () => {
    const { client, engine } = setupRecording();
    await readyAtFit(client, engine);
    engine.fitWidth();
    expect(engine.currentFitMode).toBe("width");
    engine.setViewport(2032, 532, 1);
    expect(engine.view.zoom).toBeCloseTo(2, 9); // (2032 - 32) / 1000
    engine.zoomStep(1);
    expect(engine.currentFitMode).toBeNull();
    expect(engine.view.zoom).toBeCloseTo(2 * Math.SQRT2, 9);
    engine.fitPage();
    expect(engine.view.zoom).toBeCloseTo(1, 9); // (532 - 32) / 500
  });

  it("draws the Zoom tool's rubber band on the active canvas", async () => {
    const { client, engine, active } = setupRecording();
    await readyAtFit(client, engine);
    engine.setZoomRect({ x: 10, y: 20, width: 30, height: 40 });
    paint();
    expect(active.find((o) => o.op === "strokeRect")?.args).toEqual([10.5, 20.5, 30, 40]);
    active.length = 0;
    engine.setZoomRect(null);
    paint();
    expect(active.some((o) => o.op === "strokeRect")).toBe(false);
  });

  it("publishes the zoom percent once per change and keeps each document's view in memory", async () => {
    const { client, engine, canvases } = setupRecording();
    await readyAtFit(client, engine);
    paint();
    expect(state.zoom).toBe(75); // 1 CSS px per point = 75 % of actual size (96/72)
    engine.zoomStep(1);
    paint();
    expect(state.zoom).toBe(106);
    expect(canvases.active.dataset.view).toMatch(/^1\.414213562 /);
    vi.runAllTimers();
    // Reopen the same document (same sha256): the view comes back.
    void engine.open(file());
    await flush();
    client.last("render.open").resolve({ sha256: "s", pageCount: 1, pages: [PAGE], fromCache: true });
    await flush();
    expect(engine.view.zoom).toBeCloseTo(Math.SQRT2, 9);
    // Another document starts at fit page.
    void engine.open(file("b.pdf"));
    await flush();
    client.last("render.open").resolve({ sha256: "other", pageCount: 1, pages: [PAGE], fromCache: false });
    await flush();
    expect(engine.view.zoom).toBeCloseTo(1, 9);
  });
});

describe("ViewerEngine: memory warning (AC 5)", () => {
  it("warns once when the visible tiles do not fit the budget, never before", async () => {
    // Bucket 1 at 1032 x 532: about 8 visible 512 px tiles (8 MB); the budget holds 2 MB.
    const { client, engine } = setupRecording(2 * 1024 * 1024);
    await readyAtFit(client, engine);
    expect(state.memoryPressure).toBeFalsy();
    engine.zoomBy(2);
    vi.runAllTimers();
    expect(state.memoryPressure).toBe(true);
    const requested = client.all("render.tile").length;
    expect(requested).toBeGreaterThan(0);
    expect(requested).toBeLessThan(4); // stops at the budget instead of evicting its own tiles
  });

  it("stays quiet when the budget holds the view", async () => {
    const { client, engine } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(8);
    vi.runAllTimers();
    resolveTiles(client.all("render.tile"));
    await flush();
    expect(state.memoryPressure).toBeFalsy();
  });
});

describe("canvasStateOf", () => {
  it("covers loading, ready, image-only and render error", () => {
    const base = { content: null, failedTiles: 0, error: null };
    expect(canvasStateOf({ ...base, status: "loading" })).toBe("loading");
    expect(canvasStateOf({ ...base, status: "ready" })).toBe("ready");
    expect(canvasStateOf({ ...base, status: "ready", content: { hasVector: false, hasText: false, imageOnly: true } })).toBe("image-only");
    expect(canvasStateOf({ ...base, status: "error", error: "invalid-pdf" })).toBe("render-error");
  });
});

describe("ViewerEngine: pages (Story 3.3)", () => {
  const PAGES = [PAGE, { width: 500, height: 1000, rotate: 0 }, { width: 1000, height: 500, rotate: 90 }];

  async function openPages(client: FakeClient, engine: ViewerEngine, pageLabels: string[] | null = null, sha = "multi") {
    void engine.open(file());
    await flush();
    client.last("render.open").resolve({ sha256: sha, pageCount: PAGES.length, pages: PAGES, pageLabels, fromCache: false });
    await flush();
  }

  async function resolvePreview(client: FakeClient, scale = 1, content: unknown = null) {
    client.last("render.preview").resolve({ tile: tilePayload(scale), content });
    await flush();
  }

  it("goToPage cancels the old page's work, fits the new page and renders its preview, then tiles", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client, 1, { hasVector: true, hasText: false, imageOnly: false });
    paint();
    expect(state.status).toBe("ready");
    engine.zoomBy(2);
    vi.runAllTimers();
    const tiles = client.all("render.tile").map((c) => c.reqId);
    expect(tiles.length).toBeGreaterThan(0);
    engine.goToPage(1);
    expect(client.cancelled).toEqual(expect.arrayContaining(tiles));
    expect(state.pageIndex).toBe(1);
    expect(state.content).toBeNull(); // page 2's flags are not known yet
    expect(client.last("render.preview").payload).toMatchObject({ page: 2, progressive: true });
    expect(engine.currentFitMode).toBe("page");
    expect(engine.view.zoom).toBeCloseTo((532 - 32) / 1000, 9); // 500 x 1000 page in 1032 x 532
    await resolvePreview(client, 0.5, { hasVector: false, hasText: false, imageOnly: true });
    expect(state.content).toMatchObject({ imageOnly: true });
    expect(state.status).toBe("ready");
  });

  it("coming back shows the page's kept preview at once and restores its own view", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client, 1, { hasVector: true, hasText: false, imageOnly: false });
    engine.zoomStep(1);
    const page1View = engine.view;
    engine.goToPage(1);
    await resolvePreview(client, 0.5);
    const previews = client.all("render.preview").length;
    engine.goToPage(0);
    expect(client.all("render.preview")).toHaveLength(previews); // kept in the LRU, not re-rendered
    expect(engine.view).toEqual(page1View);
    expect(engine.currentFitMode).toBeNull();
    expect(state.content).toMatchObject({ hasVector: true });
  });

  it("a page visited first opens at the current fit mode", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    engine.fitWidth();
    engine.goToPage(1);
    expect(engine.currentFitMode).toBe("width");
    expect(engine.view.zoom).toBeCloseTo((1032 - 32) / 500, 9);
  });

  it("rapid page changes cancel the stale previews: only the last page renders", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    engine.goToPage(1);
    const second = client.last("render.preview");
    engine.goToPage(2);
    expect(client.cancelled).toContain(second.reqId);
    // A late reply for page 2 is dropped.
    const late = tilePayload(0.5);
    second.resolve({ tile: late, content: null });
    await flush();
    expect(late.bitmap.close).toHaveBeenCalled();
    expect(client.last("render.preview").payload).toMatchObject({ page: 3 });
  });

  it("ignores out-of-range and same-page requests", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    const calls = client.calls.length;
    for (const i of [-1, 0, 3, 1.5]) engine.goToPage(i);
    expect(client.calls.length).toBe(calls);
    expect(engine.currentPage).toBe(0);
  });

  it("asks the worker for the sheet number of pages without a page label, once each", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine, ["1", "FP-201", "3"]);
    await resolvePreview(client);
    expect(client.all("render.sheetLabel")).toHaveLength(0); // only after the settle's tile requests
    vi.runAllTimers();
    const asked = client.all("render.sheetLabel");
    expect(asked.map((c) => c.payload)).toEqual([{ page: 1 }]);
    asked[0].resolve({ label: "S-101" });
    await flush();
    expect(state.sheetLabels).toEqual({ 0: "S-101" });
    expect(state.pageLabels).toEqual(["1", "FP-201", "3"]);
    engine.goToPage(1); // labelled: nothing to detect
    await resolvePreview(client);
    vi.runAllTimers();
    expect(client.all("render.sheetLabel")).toHaveLength(1);
    engine.goToPage(0); // kept preview: already asked
    vi.runAllTimers();
    expect(client.all("render.sheetLabel")).toHaveLength(1);
  });

  it("the panel's sheet-number lookups are shared and cancelled when the last row leaves; the engine's own is pinned", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    // Page 3 (index 2): two holders share one worker job; the last release cancels it.
    const a = engine.sheetLabel(2);
    const b = engine.sheetLabel(2);
    const third = client.all("render.sheetLabel");
    expect(third.map((c) => c.payload)).toEqual([{ page: 3 }]);
    a();
    a(); // a second release of the same holder is a no-op
    expect(client.cancelled).not.toContain(third[0].reqId);
    b();
    expect(client.cancelled).toContain(third[0].reqId);
    expect(engine.pendingSheetLabels).toBe(0);
    third[0].reject(new WorkerRequestError("cancelled", { name: "Error", message: "c" }));
    await flush();
    // A later visit asks again.
    const again = engine.sheetLabel(2);
    expect(client.all("render.sheetLabel")).toHaveLength(2);
    again();
    // The shown page: the engine's settle pins the lookup, a row leaving does not cancel it.
    const row = engine.sheetLabel(0);
    vi.runAllTimers();
    const first = client.all("render.sheetLabel").at(-1)!;
    expect(first.payload).toEqual({ page: 1 });
    row();
    expect(client.cancelled).not.toContain(first.reqId);
    first.resolve({ label: "S-101" });
    await flush();
    expect(state.sheetLabels?.[0]).toBe("S-101");
    // Answered: nothing more to ask.
    engine.sheetLabel(0)();
    expect(client.all("render.sheetLabel")).toHaveLength(3);
  });

  it("asks for the sheet number after the page's tile requests", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    engine.zoomBy(4);
    vi.runAllTimers();
    const types = client.calls.map((c) => c.type).filter((t) => t === "render.tile" || t === "render.sheetLabel");
    expect(types.at(-1)).toBe("render.sheetLabel");
    expect(types.filter((t) => t === "render.tile").length).toBeGreaterThan(0);
  });

  it("a page that cannot be drawn fails alone: the document stays open, Retry asks again", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client, 1, { hasVector: true, hasText: false, imageOnly: false });
    paint();
    engine.goToPage(1);
    client.last("render.preview").reject(new WorkerRequestError("render-failed", { name: "Error", message: "broken page" }));
    await flush();
    expect(state.status).toBe("ready");
    expect(state.error).toBeNull();
    expect(state).toMatchObject({ failedTiles: 1, pageFailed: true, pageIndex: 1 });
    // Retry re-requests the page's preview.
    engine.retryFailedTiles();
    expect(state).toMatchObject({ failedTiles: 0, pageFailed: false });
    expect(client.last("render.preview").payload).toMatchObject({ page: 2 });
    client.last("render.preview").reject(new WorkerRequestError("render-failed", { name: "Error", message: "still broken" }));
    await flush();
    // The other pages stay reachable.
    engine.goToPage(0);
    expect(state).toMatchObject({ failedTiles: 0, pageFailed: false, pageIndex: 0, status: "ready" });
  });

  it("a worker crash still fails the whole document", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    engine.goToPage(1);
    client.last("render.preview").reject(new WorkerRequestError("worker-failed", { name: "Error", message: "gone" }));
    await flush();
    expect(state.status).toBe("error");
  });

  it("a late preview reply of the previous document does not set the new document's content flags", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine, null, "first");
    const stale = client.last("render.preview");
    await openPages(client, engine, null, "second");
    await resolvePreview(client, 1, { hasVector: true, hasText: false, imageOnly: false });
    stale.resolve({ tile: tilePayload(1), content: { hasVector: false, hasText: false, imageOnly: true } });
    await flush();
    engine.goToPage(1);
    engine.goToPage(0); // page 1's flags of the second document
    expect(state.content).toMatchObject({ imageOnly: false });
  });

  it("reopening the document comes back to the page it was left on", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    await resolvePreview(client);
    engine.goToPage(2);
    await resolvePreview(client);
    vi.runAllTimers();
    await openPages(client, engine);
    expect(engine.currentPage).toBe(2);
    expect(state.pageIndex).toBe(2);
    expect(client.last("render.preview").payload).toMatchObject({ page: 3 });
  });
});

describe("ViewerEngine: thumbnails (Story 3.4)", () => {
  const PAGES = [PAGE, { width: 500, height: 1000, rotate: 0 }, { width: 1000, height: 500, rotate: 90 }];
  const BOX = { width: 200, height: 150 };

  async function openPages(client: FakeClient, engine: ViewerEngine, sha = "thumbs") {
    void engine.open(file());
    await flush();
    client.last("render.open").resolve({ sha256: sha, pageCount: PAGES.length, pages: PAGES, pageLabels: null, fromCache: false });
    await flush();
  }

  const thumbReply = (width: number, height: number) => ({ tile: { ...tilePayload(0.2), width, height, bitmap: bitmap(width, height) } });

  afterEach(() => vi.unstubAllGlobals());

  it("publishes the page sizes and the document id for the panel", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    expect(state.pages).toEqual(PAGES);
    expect(state.documentId).toBe("thumbs");
  });

  it("renders a missing thumbnail in the worker, then serves it from memory", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    const listener = vi.fn();
    engine.thumbnail(1, BOX, listener);
    expect(client.last("render.thumbnail").payload).toEqual({ page: 2, widthPx: 200, heightPx: 150 });
    const reply = thumbReply(75, 150);
    client.last("render.thumbnail").resolve(reply);
    await flush();
    expect(listener).toHaveBeenCalledWith({ bitmap: reply.tile.bitmap });
    const again = vi.fn();
    engine.thumbnail(1, BOX, again);
    expect(again).toHaveBeenCalledWith({ bitmap: reply.tile.bitmap }); // synchronously, no new request
    expect(client.all("render.thumbnail")).toHaveLength(1);
    expect(engine.pendingThumbnails).toBe(0);
  });

  it("listeners of the same thumbnail share one request; it is cancelled when the last one leaves", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    const a = engine.thumbnail(2, BOX, vi.fn());
    const b = engine.thumbnail(2, BOX, vi.fn());
    expect(client.all("render.thumbnail")).toHaveLength(1);
    const reqId = client.last("render.thumbnail").reqId;
    a();
    expect(client.cancelled).not.toContain(reqId);
    b();
    expect(client.cancelled).toContain(reqId);
    expect(engine.pendingThumbnails).toBe(0);
  });

  it("clamps the box to the worker's limits and ignores pages out of range", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    engine.thumbnail(0, { width: 4000.4, height: 3.2 }, vi.fn());
    expect(client.last("render.thumbnail").payload).toEqual({ page: 1, widthPx: 2048, heightPx: 16 });
    const listener = vi.fn();
    for (const i of [-1, 3, 0.5]) engine.thumbnail(i, BOX, listener);
    expect(client.all("render.thumbnail")).toHaveLength(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reuses the page's finished preview when it is large enough (no worker request)", async () => {
    const resized = bitmap(200, 100);
    const create = vi.fn(async () => resized);
    vi.stubGlobal("createImageBitmap", create);
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null }); // 1000 x 500 preview of page 1
    await flush();
    const listener = vi.fn();
    engine.thumbnail(0, BOX, listener);
    await flush();
    expect(create).toHaveBeenCalledWith(expect.anything(), { resizeWidth: 200, resizeHeight: 100, resizeQuality: "high" });
    expect(listener).toHaveBeenCalledWith({ bitmap: resized });
    expect(client.all("render.thumbnail")).toHaveLength(0);
  });

  it("a failed thumbnail reports an error; a later request asks again", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine);
    const listener = vi.fn();
    engine.thumbnail(1, BOX, listener);
    client.last("render.thumbnail").reject(new WorkerRequestError("render-failed", { name: "Error", message: "x" }));
    await flush();
    expect(listener).toHaveBeenCalledWith({ error: true });
    engine.thumbnail(1, BOX, vi.fn());
    expect(client.all("render.thumbnail")).toHaveLength(2);
  });

  it("a page change does not cancel thumbnails; a new document does, and drops late replies", async () => {
    const { client, engine } = setupRecording();
    await openPages(client, engine, "first");
    const listener = vi.fn();
    engine.thumbnail(2, BOX, listener);
    const call = client.last("render.thumbnail");
    engine.goToPage(1);
    expect(client.cancelled).not.toContain(call.reqId);
    await openPages(client, engine, "second");
    expect(client.cancelled).toContain(call.reqId);
    const late = thumbReply(200, 100);
    call.resolve(late);
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(late.tile.bitmap.close).toHaveBeenCalled();
  });
});
