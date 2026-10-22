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
    expect(engine.fitScale).toBe(1); // (1032 - 32) / 1000
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

  it("a DPR or fit change cancels in-flight tiles, clears failed markers and re-keys tiles by the new scale", async () => {
    const { client, engine } = setup();
    await openToPreview(client, engine);
    client.last("render.preview").resolve({ tile: tilePayload(1), content: null });
    await flush();
    engine.zoomBy(2);
    vi.runAllTimers();
    const first = client.all("render.tile");
    first[0].reject(new WorkerRequestError("render-failed", { name: "Error", message: "x" }));
    await flush();
    expect(state.failedTiles).toBe(1);
    const pending = first.slice(1).map((c) => c.reqId);
    engine.setViewport(1032, 532, 1.5);
    expect(client.cancelled).toEqual(expect.arrayContaining(pending));
    expect(state.failedTiles).toBe(0);
    vi.runAllTimers();
    const next = client.all("render.tile").slice(first.length);
    expect(next.length).toBeGreaterThan(0);
    expect((next[0].payload as { scale: number }).scale).toBeGreaterThanOrEqual(3); // 2 x 1.5, quantised up
    // A late reply for an old-scale request is dropped, not drawn under the new key.
    const late = tilePayload(2);
    first[1].resolve({ tile: late });
    await flush();
    expect(late.bitmap.close).toHaveBeenCalled();
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

  it("draws a tile 1:1 at integer device px at its bucket scale", async () => {
    const { client, engine, ops } = setupRecording();
    await readyAtFit(client, engine);
    engine.zoomBy(2);
    vi.runAllTimers();
    resolveTiles(client.all("render.tile"));
    await flush();
    paint();
    ops.length = 0;
    engine.panBy(0, 0);
    paint();
    const tiles = ops.filter((o) => o.op === "drawImage" && (o.args[0] as { width: number }).width === 512);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      const [b, x, y, w, h] = t.args as [{ width: number; height: number }, number, number, number, number];
      expect([Number.isInteger(x), Number.isInteger(y), w, h]).toEqual([true, true, b.width, b.height]);
    }
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
    expect(state.zoom).toBe(100);
    engine.zoomStep(1);
    paint();
    expect(state.zoom).toBe(141);
    expect(canvases.active.dataset.view).toMatch(/^1\.414214 /);
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
