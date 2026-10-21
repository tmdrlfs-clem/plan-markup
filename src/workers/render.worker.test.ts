import { describe, expect, it, vi } from "vitest";
import {
  RenderWorkerHost,
  renderOpenRequest,
  type PageInfo,
  type RenderWorkerReply,
  type TileJob,
  type TileRenderer,
} from "./render.worker";

type Bitmap = { job: TileJob; closed: boolean };

/** Stub renderer: each render waits for `release()` from the test (or resolves at once). */
class StubRenderer implements TileRenderer<Bitmap> {
  pages: PageInfo[] = [{ width: 1000, height: 600 }];
  opened = 0;
  closed = 0;
  jobs: TileJob[] = [];
  gate: Promise<void> | null = null;
  failOpen = false;
  released: Bitmap[] = [];

  async open(): Promise<PageInfo[]> {
    this.opened++;
    if (this.failOpen) throw new Error("bad pdf");
    return this.pages;
  }

  async render(job: TileJob, signal: AbortSignal): Promise<Bitmap> {
    this.jobs.push(job);
    if (this.gate) {
      await Promise.race([
        this.gate,
        new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })),
      ]);
    }
    return { job, closed: false };
  }

  release(bitmap: Bitmap): void {
    bitmap.closed = true;
    this.released.push(bitmap);
  }

  async close(): Promise<void> {
    this.closed++;
  }
}

function setup() {
  const renderer = new StubRenderer();
  const replies: RenderWorkerReply<Bitmap>[] = [];
  const transfers: Transferable[][] = [];
  let t = 0;
  const host = new RenderWorkerHost<Bitmap>(
    renderer,
    (reply, transfer) => {
      replies.push(reply);
      transfers.push(transfer);
    },
    (b) => [b as unknown as Transferable],
    () => (t += 1),
  );
  return { renderer, replies, transfers, host };
}

const bytes = () => new Uint8Array([37, 80, 68, 70]);
const tile = (reqId: number, col = 0, row = 0, extra: Record<string, unknown> = {}) => ({
  type: "renderTile",
  reqId,
  page: 1,
  bucket: 0,
  scale: 1,
  col,
  row,
  tileSize: 512,
  ...extra,
});

describe("RenderWorkerHost", () => {
  it("opens, then answers with a whole-page preview tile first", async () => {
    const { host, replies, renderer, transfers } = setup();
    host.handle({ type: "open", reqId: 1, bytes: bytes(), preview: { page: 1, bucket: 0, scale: 0.5 } });
    host.handle(tile(2, 1, 0));
    await host.idle();
    expect(replies.map((r) => r.type)).toEqual(["opened", "tile", "tile"]);
    expect(replies[0]).toMatchObject({ type: "opened", reqId: 1, pages: [{ width: 1000, height: 600 }] });
    expect(replies[1]).toMatchObject({ reqId: 1, preview: true, x: 0, y: 0, width: 500, height: 300, scale: 0.5 });
    expect(replies[2]).toMatchObject({ reqId: 2, preview: false, col: 1, row: 0, x: 512, width: 488, height: 512 });
    expect(renderer.jobs[1]).toEqual({ page: 1, scale: 1, x: 512, y: 0, width: 488, height: 512 });
    // The bitmap is in the transfer list.
    expect(transfers[2]).toHaveLength(1);
  });

  it("passes renderer options through and ignores unknown ones", async () => {
    const { host, renderer } = setup();
    const open = vi.spyOn(renderer, "open");
    host.handle({ type: "open", reqId: 1, bytes: bytes().buffer, options: { pdfjsWorker: "nested", evil: 1 } });
    await host.idle();
    expect(open.mock.calls[0][1]).toEqual({ pdfjsWorker: "nested" });
  });

  it("cancels queued tiles and aborts the running one", async () => {
    const { host, replies, renderer } = setup();
    host.handle({ type: "open", reqId: 1, bytes: bytes() });
    await host.idle();
    let release!: () => void;
    renderer.gate = new Promise<void>((r) => (release = r));
    host.handle(tile(2, 0, 0));
    host.handle(tile(3, 1, 0));
    host.handle(tile(4, 0, 1));
    await new Promise((r) => setTimeout(r, 0)); // tile 2 is running
    host.handle({ type: "cancel", reqIds: [2, 3, 99] });
    release();
    await host.idle();
    const tail = replies.slice(1).map((r) => [r.type, "reqId" in r ? r.reqId : null]);
    expect(tail).toEqual([
      ["cancelled", 3],
      ["cancelled", 2],
      ["tile", 4],
    ]);
  });

  it("releases a bitmap that finished after its cancel", async () => {
    const { host, replies, renderer } = setup();
    host.handle({ type: "open", reqId: 1, bytes: bytes() });
    await host.idle();
    // A renderer that ignores the abort signal.
    renderer.render = async (job) => {
      host.handle({ type: "cancel", reqIds: [2] });
      return { job, closed: false };
    };
    host.handle(tile(2));
    await host.idle();
    expect(replies.at(-1)).toEqual({ type: "cancelled", reqId: 2 });
    expect(renderer.released).toHaveLength(1);
  });

  it("cancel all drops every tile but keeps open/close jobs", async () => {
    const { host, replies } = setup();
    host.handle({ type: "open", reqId: 1, bytes: bytes() });
    host.handle(tile(2));
    host.handle(tile(3));
    host.handle({ type: "cancel", all: true });
    await host.idle();
    expect(replies.map((r) => r.type)).toEqual(["cancelled", "cancelled", "opened"]);
  });

  it("close cancels pending tiles, closes the renderer and replies closed", async () => {
    const { host, replies, renderer } = setup();
    host.handle({ type: "open", reqId: 1, bytes: bytes() });
    await host.idle();
    host.handle(tile(2));
    host.handle({ type: "close", reqId: 3 });
    await host.idle();
    expect(replies.slice(1)).toEqual([
      { type: "cancelled", reqId: 2 },
      { type: "closed", reqId: 3 },
    ]);
    expect(renderer.closed).toBe(1);
    host.handle(tile(4));
    await host.idle();
    expect(replies.at(-1)).toMatchObject({ type: "error", reqId: 4, error: { message: "No document is open" } });
  });

  it("reopening closes the previous document first", async () => {
    const { host, renderer } = setup();
    host.handle({ type: "open", reqId: 1, bytes: bytes() });
    host.handle({ type: "open", reqId: 2, bytes: bytes() });
    await host.idle();
    expect(renderer.opened).toBe(2);
    expect(renderer.closed).toBe(1);
  });

  it("reports open failures and out-of-range tiles as errors", async () => {
    const { host, replies, renderer } = setup();
    renderer.failOpen = true;
    host.handle({ type: "open", reqId: 1, bytes: bytes() });
    await host.idle();
    expect(replies[0]).toMatchObject({ type: "error", reqId: 1, error: { name: "Error", message: "bad pdf" } });
    renderer.failOpen = false;
    host.handle({ type: "open", reqId: 2, bytes: bytes() });
    host.handle(tile(3, 2, 0)); // 1000 px wide at 512 => cols 0..1
    host.handle(tile(4, 0, 0, { page: 2 }));
    await host.idle();
    expect(replies.slice(-2)).toMatchObject([
      { type: "error", reqId: 3, error: { name: "RangeError" } },
      { type: "error", reqId: 4, error: { name: "RangeError" } },
    ]);
  });

  it.each([
    [null, null],
    [{ type: "open" }, null],
    [{ type: "open", reqId: 1, bytes: "x" }, 1],
    [{ type: "open", reqId: 1, bytes: new Uint8Array(1), preview: { page: 1, bucket: 0, scale: 0 } }, 1],
    [{ type: "renderTile", reqId: 2, page: 0, bucket: 0, scale: 1, col: 0, row: 0, tileSize: 512 }, 2],
    [{ type: "renderTile", reqId: 2, page: 1, bucket: 0.5, scale: 1, col: 0, row: 0, tileSize: 512 }, 2],
    [{ type: "renderTile", reqId: 2, page: 1, bucket: 0, scale: 1, col: -1, row: 0, tileSize: 512 }, 2],
    [{ type: "nope", reqId: 3 }, 3],
  ])("answers malformed input %j with an error", async (msg, reqId) => {
    const { host, replies } = setup();
    host.handle(msg);
    await host.idle();
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: "error", reqId });
  });

  it("ignores a cancel without valid ids", async () => {
    const { host, replies } = setup();
    host.handle({ type: "cancel", reqIds: "x" });
    host.handle({ type: "cancel" });
    await host.idle();
    expect(replies).toEqual([]);
  });
});

describe("renderOpenRequest", () => {
  it("transfers the byte buffer", () => {
    const b = new Uint8Array(8);
    const [msg, transfer] = renderOpenRequest(5, b, { page: 1, bucket: 0, scale: 0.4 }, { pdfjsWorker: "inline" });
    expect(msg).toEqual({ type: "open", reqId: 5, bytes: b, preview: { page: 1, bucket: 0, scale: 0.4 }, options: { pdfjsWorker: "inline" } });
    expect(transfer).toEqual([b.buffer]);
  });
});
