// .btx parse worker. Request: { type: "parse", reqId, bytes } (post it with
// `btxParseRequest`, which transfers the input buffer). Reply:
// { type: "result", reqId, toolSet } with a structured-clone friendly tool set
// (no Map), or { type: "error", reqId, error } via serializeWorkerError.

import { parseBtx, toPlainToolSet, type BtxToolSetPlain } from "@/core/btx/parse";
import { serializeWorkerError, type SerializedWorkerError } from "@/core/worker/error";

export type BtxWorkerRequest = { type: "parse"; reqId: number; bytes: Uint8Array };

export type BtxWorkerReply =
  | { type: "result"; reqId: number; toolSet: BtxToolSetPlain }
  | { type: "error"; reqId: number; error: SerializedWorkerError };

/** Main-thread helper: the message and its transfer list (the input buffer moves, no copy). */
export function btxParseRequest(reqId: number, bytes: Uint8Array): [BtxWorkerRequest, Transferable[]] {
  return [{ type: "parse", reqId, bytes }, [bytes.buffer as ArrayBuffer]];
}

/** Handles one message; exported so tests can call it without a real Worker. */
export async function handleBtxMessage(data: unknown): Promise<BtxWorkerReply | undefined> {
  const msg = data as Partial<BtxWorkerRequest> | null;
  if (!msg || msg.type !== "parse" || typeof msg.reqId !== "number") return undefined;
  try {
    if (!(msg.bytes instanceof Uint8Array)) throw new TypeError("bytes must be a Uint8Array");
    const toolSet = toPlainToolSet(await parseBtx(msg.bytes));
    return { type: "result", reqId: msg.reqId, toolSet };
  } catch (e) {
    return { type: "error", reqId: msg.reqId, error: serializeWorkerError(e) };
  }
}

type WorkerScope = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

declare const WorkerGlobalScope: (new () => unknown) | undefined;

// Wire up only inside a real worker (not in Vitest/Node).
if (typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScope;
  scope.addEventListener("message", (event) => {
    void handleBtxMessage(event.data).then((reply) => {
      if (reply) scope.postMessage(reply);
    });
  });
}
