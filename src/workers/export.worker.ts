// Story 8.1 (FR60, AR25): the export worker. Request:
// { type: "export", reqId, bytes, job, date } (the base PDF's bytes are
// transferred; `job` comes from core/export/from-app.ts). Reply:
// { type: "exported", reqId, bytes, annotations, pages } with the new PDF's
// buffer transferred, or { type: "error", reqId, error }. Every message gets
// exactly one reply. pdf-lib never runs on the main thread.

import { exportJobPdf } from "@/core/export/export";
import type { ExportJob } from "@/core/export/from-app";
import { serializeWorkerError, type SerializedWorkerError } from "@/core/worker/error";

export type ExportWorkerRequest = { type: "export"; reqId: number; bytes: Uint8Array | ArrayBuffer; job: ExportJob; date: string };

export type ExportWorkerReply =
  | { type: "exported"; reqId: number; bytes: Uint8Array; annotations: number; pages: number }
  | { type: "error"; reqId: number | null; error: SerializedWorkerError };

/** Handles one message; exported so tests can call it without a real Worker. Always replies. */
export async function handleExportMessage(data: unknown): Promise<ExportWorkerReply> {
  const msg = (typeof data === "object" && data !== null ? data : {}) as Partial<Record<keyof ExportWorkerRequest, unknown>>;
  const reqId = typeof msg.reqId === "number" && Number.isFinite(msg.reqId) ? msg.reqId : null;
  const fail = (e: unknown): ExportWorkerReply => ({ type: "error", reqId, error: serializeWorkerError(e) });
  if (reqId === null) return fail(new TypeError("reqId must be a finite number"));
  if (msg.type !== "export") return fail(new TypeError("Unknown request type"));
  try {
    const bytes =
      msg.bytes instanceof Uint8Array ? msg.bytes
      : msg.bytes instanceof ArrayBuffer ? new Uint8Array(msg.bytes)
      : undefined;
    if (!bytes) throw new TypeError("bytes must be a Uint8Array or an ArrayBuffer");
    const job = msg.job as ExportJob | undefined;
    if (!job || !Array.isArray(job.pages) || !Array.isArray(job.layers)) throw new TypeError("job must be an export job");
    const date = typeof msg.date === "string" ? new Date(msg.date) : new Date();
    const out = await exportJobPdf(bytes, job, Number.isNaN(date.getTime()) ? new Date() : date);
    return { type: "exported", reqId, ...out };
  } catch (e) {
    return fail(e);
  }
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

declare const WorkerGlobalScope: (new () => unknown) | undefined;

// Wire up only inside a real worker (not in Vitest/Node).
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope;
  scope.addEventListener("message", (event) => {
    void handleExportMessage(event.data).then((reply) => scope.postMessage(reply, reply.type === "exported" ? [reply.bytes.buffer as ArrayBuffer] : []));
  });
}
