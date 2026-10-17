// The one way app code reports an error to Sentry (scrubbed by beforeSend).
// A no-op until initSentry() ran with a DSN: the SDK drops captures without a client.
import * as Sentry from "@sentry/nextjs";
import { isSafeDrawingId } from "./scrub";

export type WorkerName = "render" | "engine" | "export";

export type ReportErrorOptions = {
  drawingId?: string | null;
  worker?: WorkerName;
  /** The constant logger event name, sent as the log_event tag. */
  event?: string;
};

const LOG_EVENT_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const WORKERS: ReadonlySet<string> = new Set(["render", "engine", "export"]);

/** Captures `error` with allowlisted tags only. */
export function reportError(error: unknown, opts: ReportErrorOptions = {}): void {
  const tags: Record<string, string> = {};
  if (isSafeDrawingId(opts.drawingId)) tags.drawing_id = opts.drawingId;
  if (opts.worker && WORKERS.has(opts.worker)) tags.worker = opts.worker;
  if (opts.event && LOG_EVENT_RE.test(opts.event)) tags.log_event = opts.event;
  try {
    Sentry.captureException(error, Object.keys(tags).length > 0 ? { tags } : undefined);
  } catch {
    // Reporting never throws into app code.
  }
}

/** The logger's error reporter (registered by initSentry). */
export function reportLoggedError(error: Error, event: string): void {
  reportError(error, { event });
}
