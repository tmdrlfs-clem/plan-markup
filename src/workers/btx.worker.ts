// .btx parse worker. Request: { type: "parse", reqId, bytes } (post it with
// `btxParseRequest`, which transfers the input buffer). Reply:
// { type: "result", reqId, toolSet } with a structured-clone friendly tool set
// (no Map), posted with `btxReplyTransfer(reply)` so its byte buffers move, or
// { type: "error", reqId, error, code? } via serializeWorkerError (`code` is set
// when the error is a BtxError). Every message gets exactly one reply: a
// malformed request gets an error reply with its reqId when that is a finite
// number, else reqId null.
//
// Story 7.4: { type: "import", reqId, bytes } parses the file, then draws each
// item to a PNG (core/btx/import.ts, pdf.js in this worker): the reply is
// { type: "imported", reqId, set } with the PNGs transferred.

import { isBtxError, type BtxErrorCode } from "@/core/btx/errors";
import { importItems, type ImportedToolSet, type ItemRenderer } from "@/core/btx/import";
import { parseBtx, toPlainToolSet, type BtxToolSetPlain } from "@/core/btx/parse";
import type { PdfObject } from "@/core/btx/pdf-object";
import { serializeWorkerError, type SerializedWorkerError } from "@/core/worker/error";

export type BtxWorkerRequest = { type: "parse" | "import"; reqId: number; bytes: Uint8Array | ArrayBuffer; maxPngBytes?: number };

export type BtxWorkerReply =
  | { type: "result"; reqId: number; toolSet: BtxToolSetPlain }
  | { type: "imported"; reqId: number; set: ImportedToolSet }
  | { type: "error"; reqId: number | null; error: SerializedWorkerError; code?: BtxErrorCode };

/** Story 7.4: the import request and its transfer list. */
export function btxImportRequest(reqId: number, bytes: Uint8Array, maxPngBytes: number): [BtxWorkerRequest & { bytes: Uint8Array }, Transferable[]] {
  return [{ type: "import", reqId, bytes, maxPngBytes }, [bytes.buffer as ArrayBuffer]];
}

/** Main-thread helper: the message and its transfer list (the input buffer moves, no copy). */
export function btxParseRequest(reqId: number, bytes: Uint8Array): [BtxWorkerRequest & { bytes: Uint8Array }, Transferable[]] {
  return [{ type: "parse", reqId, bytes }, [bytes.buffer as ArrayBuffer]];
}

function errorReply(reqId: number | null, e: unknown): BtxWorkerReply {
  const reply: BtxWorkerReply = { type: "error", reqId, error: serializeWorkerError(e) };
  if (isBtxError(e)) reply.code = e.code;
  return reply;
}

/** Handles one message; exported so tests can call it without a real Worker. Always replies. */
export async function handleBtxMessage(data: unknown, render?: () => Promise<ItemRenderer>): Promise<BtxWorkerReply> {
  const msg = (typeof data === "object" && data !== null ? data : {}) as Partial<Record<keyof BtxWorkerRequest, unknown>>;
  const reqId = typeof msg.reqId === "number" && Number.isFinite(msg.reqId) ? msg.reqId : null;
  if (reqId === null) return errorReply(null, new TypeError("reqId must be a finite number"));
  if (msg.type !== "parse" && msg.type !== "import") return errorReply(reqId, new TypeError("Unknown request type"));
  try {
    const bytes =
      msg.bytes instanceof Uint8Array ? msg.bytes
      : msg.bytes instanceof ArrayBuffer ? new Uint8Array(msg.bytes)
      : undefined;
    if (!bytes) throw new TypeError("bytes must be a Uint8Array or an ArrayBuffer");
    const parsed = await parseBtx(bytes);
    if (msg.type === "import") {
      if (!render) throw new TypeError("No renderer in this context");
      const maxPngBytes = typeof msg.maxPngBytes === "number" && msg.maxPngBytes > 0 ? msg.maxPngBytes : 8 * 1024 * 1024;
      return { type: "imported", reqId, set: await importItems(parsed, await render(), maxPngBytes) };
    }
    return { type: "result", reqId, toolSet: toPlainToolSet(parsed) };
  } catch (e) {
    return errorReply(reqId, e);
  }
}

/** A Uint8Array that owns its whole, non-shared buffer (copied when it does not). */
function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
  return whole && bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
}

/**
 * Transfer list for a reply: every byte buffer in the tool set (string bytes,
 * stream data), deduplicated. Views that do not own their whole buffer are
 * replaced by copies first, so transferring never detaches unrelated data.
 */
export function btxReplyTransfer(reply: BtxWorkerReply): ArrayBuffer[] {
  if (reply.type === "imported") {
    const out: ArrayBuffer[] = [];
    for (const item of reply.set.items) {
      if (!item.ok) continue;
      item.png = owned(item.png);
      out.push(item.png.buffer as ArrayBuffer);
    }
    return out;
  }
  if (reply.type !== "result") return [];
  const buffers = new Set<ArrayBuffer>();
  const stack: PdfObject[] = [];
  for (const item of reply.toolSet.items) {
    for (const a of item.annotations) stack.push(a.dict);
    for (const r of item.resources) stack.push(r.object);
  }
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === null || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
    } else if (cur.kind === "dict") {
      for (const [, v] of cur.entries) stack.push(v);
    } else if (cur.kind === "string") {
      cur.bytes = owned(cur.bytes);
      buffers.add(cur.bytes.buffer as ArrayBuffer);
    } else if (cur.kind === "stream") {
      cur.data = owned(cur.data);
      buffers.add(cur.data.buffer as ArrayBuffer);
      stack.push(cur.dict);
    }
  }
  return [...buffers];
}

type WorkerScope = {
  location: { origin: string };
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

declare const WorkerGlobalScope: (new () => unknown) | undefined;

// Wire up only inside a real worker (not in Vitest/Node).
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope;
  scope.addEventListener("message", (event) => {
    // pdf.js loads only for an import (a parse never needs it).
    const render = async () => (await import("./btx-render")).itemRendererFor(scope.location.origin);
    void handleBtxMessage(event.data, render).then((reply) => scope.postMessage(reply, btxReplyTransfer(reply)));
  });
}
