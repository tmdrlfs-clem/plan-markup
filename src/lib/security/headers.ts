// Static security headers (NFR28). Pure and import-free: next.config.ts imports
// this file by relative path, so it must not use the @/ alias or any import.

export type HeaderEntry = { readonly key: string; readonly value: string };

/**
 * Sent on every response: by next.config.ts headers() for every path
 * (including _next/static) and by src/proxy.ts on every response it returns
 * (redirects included). The CSP is not here: the proxy builds it per request.
 *
 * HSTS is sent in every environment. Browsers ignore it over plain HTTP
 * (RFC 6797 §8.1), so http://localhost is unaffected. No `preload`.
 */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<HeaderEntry> = Object.freeze([
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
]);

/** Sets (overwrites) every static security header on `headers`. */
export function applyStaticSecurityHeaders(headers: Headers): void {
  for (const { key, value } of STATIC_SECURITY_HEADERS) headers.set(key, value);
}
