// Main-thread reporting of Web Worker errors (one client, one scrubber).
import type { SerializedWorkerError } from "@/core/worker/error";
import { reportError, type WorkerName } from "./report";

export type { WorkerName };

/**
 * Reports a worker error. Protocol `{ type: "error" }` replies are reported by
 * the RPC helper (src/workers/rpc.ts, Story 3.1), which rejects the caller's
 * promise and calls this with the serialised error and the open drawing id.
 */
export function reportWorkerError(
  worker: WorkerName,
  serialized: SerializedWorkerError,
  drawingId?: string | null,
): void {
  const error = new Error(serialized.message);
  error.name = serialized.name;
  if (serialized.stack) error.stack = serialized.stack;
  reportError(error, { worker, drawingId });
}

/**
 * Reports uncaught worker errors (`error`, an ErrorEvent on the Worker) and
 * undeserialisable messages (`messageerror`). The event's filename is never
 * sent (it carries a chunk URL). Returns a function that removes both listeners.
 */
export function attachWorkerErrorReporting(
  worker: Pick<Worker, "addEventListener" | "removeEventListener">,
  name: WorkerName,
  getDrawingId?: () => string | null,
): () => void {
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    const base = typeof e.message === "string" && e.message ? e.message : "Uncaught worker error";
    const where = typeof e.lineno === "number" && e.lineno > 0 ? ` (line ${e.lineno}:${e.colno ?? 0})` : "";
    reportWorkerError(name, { name: "WorkerError", message: base + where }, getDrawingId?.());
  };
  const onMessageError = () => {
    reportWorkerError(
      name,
      { name: "WorkerMessageError", message: "Worker message could not be deserialised" },
      getDrawingId?.(),
    );
  };
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onMessageError);
  return () => {
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onMessageError);
  };
}
