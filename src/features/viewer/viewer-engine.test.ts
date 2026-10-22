import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderPayloadMap, RenderVerb } from "@/workers/render-protocol";
import { WorkerRequestError, type RenderClient } from "@/workers/rpc";

import { FIT_PADDING, ViewerEngine, type ViewerCanvases } from "./viewer-engine";
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
    expect(engine.view).toEqual({ scale: 1, x: -FIT_PADDING, y: -FIT_PADDING });
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
    engine.setView({ scale: 2, x: 0, y: 0 }); // bucket 1: 2 device px per point
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
    engine.setView({ scale: 2, x: 0, y: 0 });
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
    engine.setView({ scale: 2, x: 0, y: 0 });
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

describe("canvasStateOf", () => {
  it("covers loading, ready, image-only and render error", () => {
    const base = { content: null, failedTiles: 0, error: null };
    expect(canvasStateOf({ ...base, status: "loading" })).toBe("loading");
    expect(canvasStateOf({ ...base, status: "ready" })).toBe("ready");
    expect(canvasStateOf({ ...base, status: "ready", content: { hasVector: false, hasText: false, imageOnly: true } })).toBe("image-only");
    expect(canvasStateOf({ ...base, status: "error", error: "invalid-pdf" })).toBe("render-error");
  });
});
