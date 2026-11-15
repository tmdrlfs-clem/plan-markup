// Post-sign-in redirect allowlist (NFR19). Pure: imported by the proxy and tests.

export const DEFAULT_AFTER_SIGN_IN = "/workspace";

/**
 * Paths a `next` parameter may point at. Later stories extend this list.
 * Story 10.4: /admin (its pages are a 404 for anyone but the platform admin).
 */
export const ALLOWED_NEXT_PREFIXES: readonly string[] = ["/workspace", "/admin"];

const MAX_LENGTH = 512;
const MAX_DECODES = 3;
const BASE = "http://plan-markup.invalid";
// ASCII control characters, space, DEL and backslash. Browsers strip tabs and
// newlines from URLs, which would turn "/\t/evil.com" into "//evil.com".
const FORBIDDEN_CHARS = /[\u0000- \u007f\\]/;

function looksSafe(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value[1] === "/" || value[1] === "\\") return false;
  if (FORBIDDEN_CHARS.test(value)) return false;
  if (value.includes("://")) return false;
  return true;
}

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_NEXT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function tryDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Returns a safe same-origin path for a post-sign-in redirect, or
 * DEFAULT_AFTER_SIGN_IN. The result is re-serialised from a parsed URL, never
 * the raw input.
 */
export function sanitizeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  if (!looksSafe(raw)) return DEFAULT_AFTER_SIGN_IN;

  // Every decoded layer must be safe too (%2F%2F, %5C, %252F%252F, ...).
  let current = raw;
  for (let i = 0; i < MAX_DECODES; i += 1) {
    const decoded = tryDecode(current);
    if (decoded === null) return DEFAULT_AFTER_SIGN_IN;
    if (decoded === current) break;
    if (!looksSafe(decoded)) return DEFAULT_AFTER_SIGN_IN;
    current = decoded;
  }
  // Still encoded after the last allowed decode: too deep to trust.
  if (tryDecode(current) !== current) return DEFAULT_AFTER_SIGN_IN;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
  if (url.origin !== BASE) return DEFAULT_AFTER_SIGN_IN;
  if (!isAllowedPath(url.pathname)) return DEFAULT_AFTER_SIGN_IN;
  return url.pathname + url.search + url.hash;
}
