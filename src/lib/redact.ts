// Redaction shared by the logger and the Sentry scrubber (NFR32, NFR46). Pure.
// Default-deny for field names; pattern scrubbing for free text.

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Postgres unique violations echo the conflicting values.
  [/Key \((.*?)\)=\((.*?)\)(?=[\s.,;]|$)/g, "Key ([redacted])=([redacted])"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[token]"],
  // JWT-like (header starts with {"…): one to three base64url segments.
  [/eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2}/g, "[token]"],
  [/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[key]"],
  // Query strings and fragments of /paths inside the text (absolute URLs are
  // handled by scrubUrl in scrubText).
  [/((?<![\w.~:/-])\/[^\s?#"'<>]*)[?#][^\s"'<>]*/g, "$1"],
  // Emails, plain and URL-encoded.
  [/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, "[email]"],
  // File-name-like tokens.
  [/[^\s/\\"'<>]+\.(?:pdf|btx|bpx|xml|json|csv|png|jpe?g|tiff?|dwg|dxf|zip)\b/gi, "[file]"],
];

/** Removes emails, file names, tokens, keys, conflict values and URL queries, then caps the length. */
export function scrubText(text: string, max = 500): string {
  // Absolute URLs first: origin + scrubbed path (build chunks under /_next/ keep theirs).
  let out = text.replace(URL_IN_TEXT_RE, (url) => scrubUrl(url, { keepNextAssets: true }));
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out.length > max ? out.slice(0, max) : out;
}

const URL_IN_TEXT_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/gi;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const SAFE_SEGMENT_RE = /^[a-z][a-z0-9-]{0,39}$/;
// Parameterised route names such as [id], [...slug], [[...slug]].
const ROUTE_PARAM_RE = /^\[{1,2}(?:\.\.\.)?[A-Za-z][A-Za-z0-9_]{0,39}\]{1,2}$/;
const RELATIVE_BASE = "http://relative.invalid";

/**
 * Keeps a path segment only when it is a UUID or a short lower-case slug
 * (optionally a route param name such as [id]); otherwise "[redacted]".
 */
export function scrubPath(pathname: string, allowRouteParams = false): string {
  return pathname
    .split("/")
    .map((segment) => {
      if (segment === "") return segment;
      if (isUuid(segment) || SAFE_SEGMENT_RE.test(segment)) return segment;
      if (allowRouteParams && ROUTE_PARAM_RE.test(segment)) return segment;
      return "[redacted]";
    })
    .join("/");
}

/**
 * Origin + path only (no userinfo, query or fragment), with scrubPath applied.
 * Relative URLs keep the same path rule. Unparseable input → "[redacted-url]".
 * `keepNextAssets` keeps /_next/… build-asset paths (no user data) as they are.
 */
export function scrubUrl(url: string, opts: { keepNextAssets?: boolean } = {}): string {
  if (typeof url !== "string" || url.length === 0 || url.length > 4096) return "[redacted-url]";
  try {
    if (SCHEME_RE.test(url)) {
      const parsed = new URL(url);
      if (parsed.origin === "null") return "[redacted-url]";
      if (opts.keepNextAssets && parsed.pathname.startsWith("/_next/")) {
        return parsed.origin + parsed.pathname;
      }
      return parsed.origin + scrubPath(parsed.pathname);
    }
    if (url.startsWith("/") && !url.startsWith("//")) {
      return scrubPath(new URL(url, RELATIVE_BASE).pathname);
    }
  } catch {
    // fall through
  }
  return "[redacted-url]";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Permissive UUID check (not Zod uuid(), which rejects non-RFC ids). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Keys that look like secrets or user content. */
const SENSITIVE_KEY_RE =
  /pass(word)?|secret|token|key|auth|cookie|session|email|name|file|content|text|body|note|comment/i;

/** Keys that are always safe (checked before the sensitive pattern). */
const SAFE_KEYS: ReadonlySet<string> = new Set(["error", "status", "code", "count", "durationMs"]);

export const REDACTED = "[redacted]";

export type RedactedError = { name: string; message: string; stack?: string };
export type RedactedValue = string | number | boolean | null | undefined | RedactedError;

/** An Error reduced to name + scrubbed message (stack only outside production). */
export function redactError(error: Error): RedactedError {
  const out: RedactedError = {
    name: scrubText(String(error.name || "Error"), 64),
    message: scrubText(String(error.message ?? ""), 300),
  };
  if (process.env.NODE_ENV !== "production" && typeof error.stack === "string") {
    out.stack = scrubText(error.stack, 2000);
  }
  return out;
}

function redactValue(value: unknown): RedactedValue {
  if (value instanceof Error) return redactError(value);
  if (typeof value === "string") return scrubText(value, 200);
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  // Objects, arrays, functions, symbols: never stringified (could be user content).
  return REDACTED;
}

/** Redacts a log field bag: sensitive keys → "[redacted]", strings scrubbed, Errors reduced. */
export function redactFields(fields: Readonly<Record<string, unknown>> | undefined): Record<string, RedactedValue> {
  const out: Record<string, RedactedValue> = {};
  if (!fields) return out;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "drawingId") {
      out[key] = isUuid(value) ? value : REDACTED;
    } else if (!SAFE_KEYS.has(key) && SENSITIVE_KEY_RE.test(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactValue(value);
    }
  }
  return out;
}
