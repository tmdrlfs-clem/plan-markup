// Story 8.1 (FR60, AR25): the export worker. Request:
// { type: "export", reqId, bytes, job, date, flatten?, notice? } (the base PDF's bytes are
// transferred; `job` comes from core/export/from-app.ts). Reply:
// { type: "exported", reqId, bytes, annotations, flattened, pages } with the new PDF's
// buffer transferred, or { type: "error", reqId, error }. Every message gets
// exactly one reply. pdf-lib never runs on the main thread.
//
// Story 8.3: { type: "print", reqId, bytes, job | null, date, print } draws the
// job's markups in (null: none) and lays the chosen pages on the paper
// (core/export/print.ts); reply { type: "printed", reqId, bytes, sheets, clipped }.
//
// Flatten in place (2026-11-21): "export" with flatten and a `record` keeps what
// Unflatten needs in the PDF; { type: "unflatten", reqId, bytes } takes it out:
// reply { type: "unflattened", reqId, bytes, record } (bytes and record null: nothing to unflatten).

import { exportJobPdf, unflattenPdf } from "@/core/export/export";
import type { FlattenRecord } from "@/core/export/flatten-record";
import type { ExportJob } from "@/core/export/from-app";
import { PAPER_NAMES, printJobPdf, type PrintOptions } from "@/core/export/print";
import { serializeWorkerError, type SerializedWorkerError } from "@/core/worker/error";

export type ExportWorkerRequest =
  | { type: "export"; reqId: number; bytes: Uint8Array | ArrayBuffer; job: ExportJob; date: string; flatten?: boolean; notice?: boolean; record?: FlattenRecord }
  | { type: "print"; reqId: number; bytes: Uint8Array | ArrayBuffer; job: ExportJob | null; date: string; print: PrintOptions }
  | { type: "unflatten"; reqId: number; bytes: Uint8Array | ArrayBuffer };

export type ExportWorkerReply =
  | { type: "exported"; reqId: number; bytes: Uint8Array; annotations: number; flattened: number; pages: number }
  | { type: "printed"; reqId: number; bytes: Uint8Array; sheets: number; clipped: number }
  | { type: "unflattened"; reqId: number; bytes: Uint8Array | null; record: FlattenRecord | null }
  | { type: "error"; reqId: number | null; error: SerializedWorkerError };

function printOptions(value: unknown): PrintOptions {
  const o = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof PrintOptions, unknown>>;
  const pages = Array.isArray(o.pages) && o.pages.every((p) => Number.isInteger(p)) ? (o.pages as number[]) : null;
  if (!pages || !PAPER_NAMES.includes(o.paper as never) || (o.scale !== "fit" && o.scale !== "actual")) throw new TypeError("print must be print options");
  return { pages, paper: o.paper as PrintOptions["paper"], scale: o.scale };
}

/** Handles one message; exported so tests can call it without a real Worker. Always replies. */
export async function handleExportMessage(data: unknown): Promise<ExportWorkerReply> {
  const msg = (typeof data === "object" && data !== null ? data : {}) as Partial<Record<"type" | "reqId" | "bytes" | "job" | "date" | "flatten" | "notice" | "print" | "record", unknown>>;
  const reqId = typeof msg.reqId === "number" && Number.isFinite(msg.reqId) ? msg.reqId : null;
  const fail = (e: unknown): ExportWorkerReply => ({ type: "error", reqId, error: serializeWorkerError(e) });
  if (reqId === null) return fail(new TypeError("reqId must be a finite number"));
  if (msg.type !== "export" && msg.type !== "print" && msg.type !== "unflatten") return fail(new TypeError("Unknown request type"));
  try {
    const bytes =
      msg.bytes instanceof Uint8Array ? msg.bytes
      : msg.bytes instanceof ArrayBuffer ? new Uint8Array(msg.bytes)
      : undefined;
    if (!bytes) throw new TypeError("bytes must be a Uint8Array or an ArrayBuffer");
    if (msg.type === "unflatten") {
      const out = await unflattenPdf(bytes);
      return { type: "unflattened", reqId, bytes: out?.bytes ?? null, record: out?.record ?? null };
    }
    const job = msg.job as ExportJob | null | undefined;
    const isJob = (j: typeof job): j is ExportJob => !!j && Array.isArray(j.pages) && Array.isArray(j.layers);
    const parsed = typeof msg.date === "string" ? new Date(msg.date) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    if (msg.type === "print") {
      if (job !== null && !isJob(job)) throw new TypeError("job must be an export job or null");
      return { type: "printed", reqId, ...(await printJobPdf(bytes, job, date, printOptions(msg.print))) };
    }
    if (!isJob(job)) throw new TypeError("job must be an export job");
    const record = msg.flatten === true && typeof msg.record === "object" && msg.record !== null ? (msg.record as FlattenRecord) : undefined;
    const out = await exportJobPdf(bytes, job, date, { flatten: msg.flatten === true, notice: msg.notice === true, record });
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
    void handleExportMessage(event.data).then((reply) => scope.postMessage(reply, reply.type === "error" || !reply.bytes ? [] : [reply.bytes.buffer as ArrayBuffer]));
  });
}
