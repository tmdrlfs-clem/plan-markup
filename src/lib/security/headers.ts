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

/** URL prefix of the same-origin pdf.js assets (public/pdfjs/<version>/, Story 3.1). */
export const PDFJS_ASSET_PATH = "/pdfjs";

/**
 * CSP of the pdf.js assets. It only takes effect on the one document-like
 * response among them: the nested pdf.js parser worker (build/pdf.worker.min.mjs),
 * which runs under its own response's policy (a worker does not inherit the
 * page's CSP). The parser handles untrusted PDF bytes, so it gets the narrowest
 * policy that still lets it work: its own origin for fetch and import() (wasm,
 * fonts, cmaps, the no-wasm fallbacks), WebAssembly compilation for the image
 * decoders and PostScript functions ('wasm-unsafe-eval', ADR 0005), and nothing
 * else: no JS eval, no workers, no network beyond 'self'.
 */
export const PDFJS_WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Headers of every /pdfjs/<version>/ file: the worker CSP and a long cache (the version is in the path). */
export const PDFJS_ASSET_HEADERS: ReadonlyArray<HeaderEntry> = Object.freeze([
  { key: "Content-Security-Policy", value: PDFJS_WORKER_CSP },
  { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
]);
