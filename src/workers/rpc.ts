// Main-thread client for the render worker (Story 3.1, AR14): numbered
// requests, one promise per request, progress callbacks, cancellation.
// Unexpected worker errors are reported (scrubbed) to Sentry here; expected
// outcomes (a bad or locked PDF, a cancel) are not.

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

export class RenderClient {
  private seq = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly detach: () => void;
  private readonly report: (serialized: SerializedWorkerError) => void;
  private terminated = false;

  constructor(
    private readonly worker: WorkerLike,
    { report = (s) => reportWorkerError("render", s), attachErrorReporting = true }: RenderClientOptions = {},
  ) {
    this.report = report;
    const onMessage = (event: Event) => this.onReply((event as MessageEvent<RenderReply<ImageBitmap>>).data);
    worker.addEventListener("message", onMessage);
    const detachErrors = attachErrorReporting ? attachWorkerErrorReporting(worker, "render") : () => undefined;
    this.detach = () => {
      worker.removeEventListener("message", onMessage);
      detachErrors();
    };
  }

  /** Sends a request. `transfer` moves buffers instead of copying them. */
  request<V extends RenderVerb>(
    type: V,
    payload: RenderPayloadMap[V],
    options: { transfer?: Transferable[]; onProgress?: (payload: PreviewProgress<ImageBitmap>) => void } = {},
  ): RenderCall<V> {
    const reqId = this.seq++;
    const promise = new Promise<RenderResultMap<ImageBitmap>[V]>((resolve, reject) => {
      if (this.terminated) {
        reject(new WorkerRequestError("cancelled", { name: "Error", message: "Render worker terminated" }));
        return;
      }
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress });
    });
    if (!this.terminated) this.worker.postMessage({ type, reqId, payload }, options.transfer ?? []);
    return { reqId, promise };
  }

  /** Cancels requests (their promises reject with code "cancelled"). */
  cancel(reqIds: readonly number[]): void {
    if (reqIds.length === 0 || this.terminated) return;
    this.request("render.cancel", { reqIds: [...reqIds] }).promise.catch(() => undefined);
  }

  /** Stops the worker; every pending request rejects with "cancelled". */
  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.detach();
    this.worker.terminate();
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
