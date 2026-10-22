import { describe, expect, it, vi } from "vitest";
import { RenderClient, WorkerRequestError, type WorkerLike } from "./rpc";

class FakeWorker implements WorkerLike {
  posted: { msg: { type: string; reqId: number; payload: unknown }; transfer: Transferable[] }[] = [];
  terminated = false;
  private listeners = new Set<(e: Event) => void>();
  postMessage(msg: unknown, transfer?: unknown) {
    this.posted.push({ msg: msg as never, transfer: (transfer ?? []) as Transferable[] });
  }
  addEventListener(type: string, fn: unknown) {
    if (type === "message") this.listeners.add(fn as (e: Event) => void);
  }
  removeEventListener(type: string, fn: unknown) {
    if (type === "message") this.listeners.delete(fn as (e: Event) => void);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    for (const fn of this.listeners) fn({ data } as MessageEvent);
  }
}

function setup() {
  const worker = new FakeWorker();
  const report = vi.fn();
  const client = new RenderClient(worker as unknown as Worker, { report, attachErrorReporting: false });
  return { worker, report, client };
}

const err = (message = "boom") => ({ name: "Error", message });

describe("RenderClient", () => {
  it("numbers requests, transfers buffers and resolves with the result payload", async () => {
    const { worker, client } = setup();
    const bytes = new ArrayBuffer(4);
    const a = client.request("render.open", { bytes }, { transfer: [bytes] });
    const b = client.request("render.close", {});
    expect(worker.posted.map((p) => [p.msg.type, p.msg.reqId])).toEqual([
      ["render.open", a.reqId],
      ["render.close", b.reqId],
    ]);
    expect(worker.posted[0].transfer).toEqual([bytes]);
    worker.reply({ type: "result", reqId: a.reqId, payload: { sha256: "x", pageCount: 1, pages: [], fromCache: false } });
    await expect(a.promise).resolves.toMatchObject({ sha256: "x" });
  });

  it("passes progress to the caller and rejects error replies with their code", async () => {
    const { worker, client, report } = setup();
    const onProgress = vi.fn();
    const p = client.request("render.preview", { page: 1, maxWidth: 1, maxHeight: 1 }, { onProgress });
    worker.reply({ type: "progress", reqId: p.reqId, payload: { tile: { bitmap: {} } } });
    expect(onProgress).toHaveBeenCalledTimes(1);
    worker.reply({ type: "error", reqId: p.reqId, code: "password-required", error: err() });
    await expect(p.promise).rejects.toMatchObject({ name: "WorkerRequestError", code: "password-required" });
    expect(report).not.toHaveBeenCalled();
  });

  it("reports unexpected errors (also without a reqId) and maps unknown codes to render-failed", async () => {
    const { worker, client, report } = setup();
    const t = client.request("render.tile", { page: 1, bucket: 0, scale: 1, col: 0, row: 0, tileSize: 512 });
    worker.reply({ type: "error", reqId: t.reqId, code: "???", error: err("x") });
    await expect(t.promise).rejects.toBeInstanceOf(WorkerRequestError);
    await t.promise.catch((e: WorkerRequestError) => expect(e.code).toBe("render-failed"));
    worker.reply({ type: "error", reqId: null, code: "render-failed", error: err("y") });
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("cancel posts render.cancel with the ids; terminate rejects everything pending", async () => {
    const { worker, client } = setup();
    const t = client.request("render.tile", { page: 1, bucket: 0, scale: 1, col: 0, row: 0, tileSize: 512 });
    client.cancel([t.reqId]);
    client.cancel([]);
    expect(worker.posted.at(-1)?.msg).toMatchObject({ type: "render.cancel", payload: { reqIds: [t.reqId] } });
    expect(worker.posted).toHaveLength(2);
    client.terminate();
    expect(worker.terminated).toBe(true);
    await expect(t.promise).rejects.toMatchObject({ code: "cancelled" });
    await expect(client.request("render.close", {}).promise).rejects.toMatchObject({ code: "cancelled" });
  });

  it("closes bitmaps of replies nobody waits for", () => {
    const { worker } = setup();
    const close = vi.fn();
    worker.reply({ type: "result", reqId: 999, payload: { tile: { bitmap: { close } } } });
    worker.reply({ type: "progress", reqId: 999, payload: { tile: { bitmap: { close } } } });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
