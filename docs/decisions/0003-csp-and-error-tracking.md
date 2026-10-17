# 0003: Nonce CSP, security headers and error tracking

Date: 2026-10-18
Status: accepted

## Context

NFR28 asks for a strict CSP and security headers from the first deploy, NFR46
for error tracking without leaking drawing content. Next.js 16 supports a
nonce CSP only for pages rendered per request: it reads the nonce from the
request `Content-Security-Policy` header while rendering. A statically
prerendered page has no request, so its inline scripts carry no nonce and are
blocked. Next.js has no built-in hash CSP for the inline RSC scripts of static
pages (`experimental.sri` covers external chunks only).

## Decision

- **Nonce CSP in `src/proxy.ts`** for every app route, `/` included, built by
  `src/lib/security/csp.ts` with a fresh 128-bit nonce per request. The root
  layout awaits `connection()`, so every page under it is dynamic, and
  `check:dynamic-routes` fails CI if a page becomes static.
- **Static marketing hash CSP deferred** to Story 13.1: `buildStaticCsp`,
  `hashInlineScripts` and `MARKETING_PATHS` exist and are tested, but no route
  uses them until a postbuild hash manifest exists. The branch fails closed.
- **HSTS everywhere** (`max-age=63072000; includeSubDomains`, no `preload`),
  with the other static headers from one constant, sent by `next.config.ts`
  `headers()` and by the proxy.
- **Sentry `@sentry/nextjs` 11.4.0** (exact; 11.8.0 was under two weeks old).
  Without `NEXT_PUBLIC_SENTRY_DSN` it is never initialised. Errors only: no
  tracing, Replay or feedback. Sentry 11 removed `sendDefaultPii`, so every
  `dataCollection` category is switched off explicitly, and `beforeSend` /
  `beforeBreadcrumb` scrub every event default-deny. `withSentryConfig` comes
  from `@sentry/nextjs/config` and uploads nothing without `SENTRY_AUTH_TOKEN`.

## Revisit

- Story 13.1: hash manifest, `(marketing)` root layout, `MARKETING_PATHS`.
- Bump to `@sentry/nextjs` 11.7.0+ (SDK-side query filtering) after 2026-10-26.
- Story 3.1: add `'wasm-unsafe-eval'` only if pdf.js needs main-thread WebAssembly.
