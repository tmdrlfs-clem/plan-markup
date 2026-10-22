// Main-thread client for the render worker (Story 3.1, AR14): numbered
// requests, one promise per request, progress callbacks, cancellation.
// Unexpected worker errors are reported (scrubbed) to Sentry here; expected
// outcomes (a bad or locked PDF, a cancel) are not.
//
// A fatal worker failure (it could not start, an uncaught `error`, or a reply
// that could not be deserialised) rejects every pending request with code
// "worker-failed" and marks the client dead: the worker is terminated, later
// requests reject at once, and the next render.open starts a fresh worker
// (when the client was given a factory).

import type { SerializedWorkerError } from "@/core/worker/error";
import { attachWorkerErrorReporting, reportWorkerError } from "@/lib/sentry/worker-errors";
import {
  isRenderErrorCode,
  type PreviewProgress,
  type RenderErrorCode,
  type RenderPayloadMap,
  type RenderReply,
  type RenderResultMap,
  type RenderVerb,
} from "./render-protocol";

/** A worker error reply as a rejection. */
export class WorkerRequestError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, serialized: SerializedWorkerError) {
    super(serialized.message);
    this.name = "WorkerRequestError";
    this.code = code;
  }
}

/** Codes that describe the file or the caller, not a bug: never reported. */
const EXPECTED: ReadonlySet<RenderErrorCode> = new Set(["invalid-pdf", "password-required", "cancelled"]);

export type WorkerLike = Pick<Worker, "postMessage" | "addEventListener" | "removeEventListener" | "terminate">;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: WorkerRequestError) => void;
  onProgress?: (payload: PreviewProgress<ImageBitmap>) => void;
};

export type RenderCall<V extends RenderVerb> = { reqId: number; promise: Promise<RenderResultMap<ImageBitmap>[V]> };

export type RenderClientOptions = {
  /** Reports an unexpected error; defaults to Sentry (reportWorkerError). */
  report?: (serialized: SerializedWorkerError) => void;
  /** Uncaught worker errors (ErrorEvent); defaults to Sentry. Pass false in tests. */
  attachErrorReporting?: boolean;
};

const workerFailed = (message: string) => new WorkerRequestError("worker-failed", { name: "WorkerError", message });

export class RenderClient {
  private seq = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly report: (serialized: SerializedWorkerError) => void;
  private readonly attachErrorReporting: boolean;
  private readonly createWorker: (() => WorkerLike) | null;
  private worker: WorkerLike | null = null;
  private detach: () => void = () => undefined;
  private terminated = false;

  /** `worker` is a worker, or a factory so the client can start a new one after a failure. */
  constructor(
    worker: WorkerLike | (() => WorkerLike),
    { report = (s) => reportWorkerError("render", s), attachErrorReporting = true }: RenderClientOptions = {},
  ) {
    this.report = report;
    this.attachErrorReporting = attachErrorReporting;
    this.createWorker = typeof worker === "function" ? worker : null;
    this.start(typeof worker === "function" ? worker() : worker);
  }

  /** False after a fatal worker failure, until the next render.open restarts it. */
  get alive(): boolean {
    return this.worker !== null;
  }

  private start(worker: WorkerLike): void {
    this.worker = worker;
    const onMessage = (event: Event) => this.onReply((event as MessageEvent<RenderReply<ImageBitmap>>).data);
    const onError = () => this.fail("The render worker failed");
    const onMessageError = () => this.fail("A render worker reply could not be read");
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    const detachErrors = this.attachErrorReporting ? attachWorkerErrorReporting(worker, "render") : () => undefined;
    this.detach = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      detachErrors();
    };
  }

  /** Fatal failure: drop the worker (and whatever it held), reject everything pending. */
  private fail(message: string): void {
    const worker = this.worker;
    if (!worker) return;
    this.detach();
    this.detach = () => undefined;
    this.worker = null;
    worker.terminate();
    const error = workerFailed(message);
    for (const [, p] of this.pending) p.reject(error);
    this.pending.clear();
  }

  /** Sends a request. `transfer` moves buffers instead of copying them. */
  request<V extends RenderVerb>(
    type: V,
    payload: RenderPayloadMap[V],
    options: { transfer?: Transferable[]; onProgress?: (payload: PreviewProgress<ImageBitmap>) => void } = {},
  ): RenderCall<V> {
    const reqId = this.seq++;
    // A dead client restarts its worker for a new document; everything else fails fast.
    if (!this.worker && !this.terminated && type === "render.open" && this.createWorker) this.start(this.createWorker());
    const worker = this.worker;
    const promise = new Promise<RenderResultMap<ImageBitmap>[V]>((resolve, reject) => {
      if (this.terminated) {
        reject(new WorkerRequestError("cancelled", { name: "Error", message: "Render worker terminated" }));
        return;
      }
      if (!worker) {
        reject(workerFailed("The render worker is not running"));
        return;
      }
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress });
    });
    if (worker && !this.terminated) worker.postMessage({ type, reqId, payload }, options.transfer ?? []);
    return { reqId, promise };
  }

  /** Cancels requests (their promises reject with code "cancelled"). */
  cancel(reqIds: readonly number[]): void {
    if (reqIds.length === 0 || this.terminated || !this.worker) return;
    this.request("render.cancel", { reqIds: [...reqIds] }).promise.catch(() => undefined);
  }

  /** Stops the worker; every pending request rejects with "cancelled". */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.detach();
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) p.reject(new WorkerRequestError("cancelled", { name: "Error", message: "Render worker terminated" }));
    this.pending.clear();
  }

  private onReply(reply: RenderReply<ImageBitmap>): void {
    if (!reply || typeof reply !== "object") return;
    if (reply.type === "progress") {
      const p = this.pending.get(reply.reqId);
      if (p?.onProgress) p.onProgress(reply.payload);
      else reply.payload?.tile?.bitmap?.close?.();
      return;
    }
    if (reply.type === "error") {
      const code = isRenderErrorCode(reply.code) ? reply.code : "render-failed";
      if (!EXPECTED.has(code)) this.report(reply.error);
      if (code === "worker-failed") return this.fail(reply.error?.message || "The render worker failed to start");
      if (reply.reqId === null) return;
      const p = this.pending.get(reply.reqId);
      this.pending.delete(reply.reqId);
      p?.reject(new WorkerRequestError(code, reply.error));
      return;
    }
    if (reply.type === "result") {
      const p = this.pending.get(reply.reqId);
      this.pending.delete(reply.reqId);
      if (p) p.resolve(reply.payload);
      else closeBitmaps(reply.payload);
    }
  }
}

/** Closes any bitmap in a payload nobody is waiting for (a late reply after terminate/cancel). */
function closeBitmaps(payload: unknown): void {
  const tile = (payload as { tile?: { bitmap?: { close?: () => void } } } | null)?.tile;
  tile?.bitmap?.close?.();
}
