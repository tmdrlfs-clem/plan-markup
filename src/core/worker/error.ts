// Worker error serialisation (framework-free: runs inside Web Workers).
// Workers reply { type: "error", reqId, error: serializeWorkerError(e) }; the
// main thread reports it (src/lib/sentry/worker-errors.ts). Sentry is never
// initialised inside a worker.

export type SerializedWorkerError = { name: string; message: string; stack?: string };

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

/**
 * An Error becomes { name, message, stack } (capped; the main thread scrubs
 * again). Any other thrown value is never stringified, because it could be
 * drawing content: only its typeof is kept.
 */
export function serializeWorkerError(value: unknown): SerializedWorkerError {
  if (value instanceof Error) {
    const out: SerializedWorkerError = {
      name: typeof value.name === "string" && value.name ? value.name.slice(0, 64) : "Error",
      message: typeof value.message === "string" ? value.message.slice(0, MAX_MESSAGE) : "",
    };
    if (typeof value.stack === "string") out.stack = value.stack.slice(0, MAX_STACK);
    return out;
  }
  const kind = value === null ? "null" : typeof value;
  return { name: "NonErrorThrown", message: `Non-Error value thrown (${kind})` };
}
