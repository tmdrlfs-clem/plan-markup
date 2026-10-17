// Sentry beforeSend / beforeBreadcrumb scrubbing (NFR46, AR21). Pure: no Sentry
// runtime import. Default-deny: only the fields listed here leave the app.
// Drawing content, file names, emails, query strings, cookies, auth headers
// and request bodies never do. The only data-bearing tag is drawing_id (UUID).
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { isUuid, scrubPath, scrubText, scrubUrl } from "@/lib/redact";

export { scrubText, scrubUrl };

/** The drawing-id tag accepts UUIDs only (permissive, not Zod uuid()). */
export const isSafeDrawingId = isUuid;

const WORKERS: ReadonlySet<string> = new Set(["render", "engine", "export"]);
const LOG_EVENT_RE = /^[a-z][a-z0-9_.]{0,63}$/;
const RUNTIME_RE = /^[a-z][a-z0-9-]{0,15}$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stack frame file names: build chunks under /_next/ keep their path (no user data). */
function scrubFrameFile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!SCHEME_RE.test(value)) return value; // a filesystem path on the server
  return scrubUrl(value, { keepNextAssets: true });
}

function scrubTransaction(value: string): string {
  return value
    .split(" ")
    .map((token) => (token.startsWith("/") ? scrubPath(token.split(/[?#]/)[0], true) : token))
    .join(" ")
    .slice(0, 200);
}

function pick(source: unknown, keys: readonly string[]): Json | undefined {
  if (!isObject(source)) return undefined;
  const out: Json = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

const FRAME_KEYS = ["function", "module", "lineno", "colno", "in_app", "platform", "context_line", "pre_context", "post_context"];

function scrubFrame(frame: unknown): Json | undefined {
  if (!isObject(frame)) return undefined;
  const out = pick(frame, FRAME_KEYS) ?? {};
  // vars (local variables) are never kept.
  const filename = scrubFrameFile(frame.filename);
  const absPath = scrubFrameFile(frame.abs_path);
  if (filename !== undefined) out.filename = filename;
  if (absPath !== undefined) out.abs_path = absPath;
  return out;
}

function scrubException(value: unknown): Json | undefined {
  if (!isObject(value)) return undefined;
  const out: Json = {};
  if (typeof value.type === "string") out.type = value.type.slice(0, 128);
  if (typeof value.value === "string") out.value = scrubText(value.value);
  const mechanism = pick(value.mechanism, ["type", "handled", "synthetic"]);
  if (mechanism) out.mechanism = mechanism;
  if (isObject(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
    out.stacktrace = { frames: value.stacktrace.frames.map(scrubFrame).filter(Boolean) };
  }
  return out;
}

function scrubTags(tags: unknown): Json | undefined {
  if (!isObject(tags)) return undefined;
  const out: Json = {};
  if (isUuid(tags.drawing_id)) out.drawing_id = tags.drawing_id;
  if (typeof tags.worker === "string" && WORKERS.has(tags.worker)) out.worker = tags.worker;
  if (typeof tags.log_event === "string" && LOG_EVENT_RE.test(tags.log_event)) out.log_event = tags.log_event;
  if (typeof tags.runtime === "string" && RUNTIME_RE.test(tags.runtime)) out.runtime = tags.runtime;
  return out;
}

const PLAIN_CONTEXTS = ["app", "browser", "os", "runtime", "device", "culture"] as const;

function scrubContexts(contexts: unknown): Json | undefined {
  if (!isObject(contexts)) return undefined;
  const out: Json = {};
  for (const key of PLAIN_CONTEXTS) if (isObject(contexts[key])) out[key] = contexts[key];
  const trace = pick(contexts.trace, ["trace_id", "span_id", "parent_span_id"]);
  if (trace) out.trace = trace;
  if (isObject(contexts.react) && typeof contexts.react.componentStack === "string") {
    out.react = { componentStack: contexts.react.componentStack.slice(0, 4000) };
  }
  return out;
}

function scrubRequest(request: unknown): Json | undefined {
  if (!isObject(request)) return undefined;
  const out: Json = {};
  if (typeof request.method === "string") out.method = request.method.slice(0, 16);
  if (typeof request.url === "string") out.url = scrubUrl(request.url);
  if (isObject(request.headers)) {
    const ua = request.headers["user-agent"] ?? request.headers["User-Agent"];
    if (typeof ua === "string") out.headers = { "user-agent": ua.slice(0, 512) };
  }
  return out;
}

/** Top-level event fields that carry no user data and are kept as they are. */
const KEPT_EVENT_KEYS = [
  "event_id",
  "timestamp",
  "start_timestamp",
  "level",
  "platform",
  "logger",
  "release",
  "dist",
  "environment",
  "sdk",
  "type",
  "fingerprint",
  "debug_meta",
] as const;

/** Returns a scrubbed copy of `event`; the input is not mutated. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const src = event as unknown as Json;
  const out: Json = {};
  for (const key of KEPT_EVENT_KEYS) if (src[key] !== undefined) out[key] = src[key];

  if (typeof src.message === "string") out.message = scrubText(src.message);
  if (isObject(src.logentry) && typeof src.logentry.message === "string") {
    out.logentry = { message: scrubText(src.logentry.message) };
  }
  if (isObject(src.exception) && Array.isArray(src.exception.values)) {
    out.exception = { values: src.exception.values.map(scrubException).filter(Boolean) };
  }
  const request = scrubRequest(src.request);
  if (request) out.request = request;
  if (isObject(src.user) && isUuid(src.user.id)) out.user = { id: src.user.id };
  const tags = scrubTags(src.tags);
  if (tags) out.tags = tags;
  const contexts = scrubContexts(src.contexts);
  if (contexts) out.contexts = contexts;
  if (typeof src.transaction === "string") out.transaction = scrubTransaction(src.transaction);
  if (Array.isArray(src.breadcrumbs)) {
    out.breadcrumbs = src.breadcrumbs
      .map((crumb) => (isObject(crumb) ? scrubBreadcrumb(crumb as Breadcrumb) : null))
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  // Dropped: extra, server_name, threads, modules, sdkProcessingMetadata and anything unknown.
  return out as unknown as ErrorEvent;
}

const KEPT_CATEGORIES: ReadonlySet<string> = new Set(["navigation", "fetch", "xhr", "http"]);

/**
 * Keeps navigation, fetch, xhr and http breadcrumbs with method, status and
 * scrubbed URLs only. console (logger output), ui.* (selectors can carry
 * markup text), sentry.* and everything else are dropped.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  const category = typeof crumb.category === "string" ? crumb.category : "";
  if (!KEPT_CATEGORIES.has(category)) return null;
  const out: Breadcrumb = { category };
  if (crumb.type) out.type = crumb.type;
  if (crumb.level) out.level = crumb.level;
  if (typeof crumb.timestamp === "number") out.timestamp = crumb.timestamp;
  if (typeof crumb.message === "string") out.message = scrubText(crumb.message, 200);
  if (isObject(crumb.data)) {
    const data: Json = {};
    const { method, status_code: status, url, from, to } = crumb.data;
    if (typeof method === "string") data.method = method.slice(0, 16);
    if (typeof status === "number") data.status_code = status;
    if (typeof url === "string") data.url = scrubUrl(url);
    if (typeof from === "string") data.from = scrubUrl(from);
    if (typeof to === "string") data.to = scrubUrl(to);
    out.data = data;
  }
  return out;
}
