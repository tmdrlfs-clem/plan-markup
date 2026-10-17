# Story 1.6: Security headers, error tracking and logging

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the founder,
I want strict security headers, error reporting and safe logging from the first deploy,
so that attacks are blocked and failures are visible without leaking data.

## Acceptance Criteria

1. **Nonce CSP on app routes.** `src/proxy.ts` sends a fresh nonce-based `Content-Security-Policy` on every response it returns for the workspace, auth and (later) admin routes, and for `/`. The policy is built by one pure module, `src/lib/security/csp.ts`, with the directives in Dev Notes → CSP policy:
   - `script-src 'self' 'nonce-<n>' 'strict-dynamic'`, `worker-src 'self' blob:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`;
   - `connect-src` allows `'self'`, the Supabase origin from `NEXT_PUBLIC_SUPABASE_URL` (plus its `ws`/`wss` form), and the Sentry ingest origin **only** when `NEXT_PUBLIC_SENTRY_DSN` is set;
   - **no `'unsafe-eval'` and no `'unsafe-inline'` in `script-src` in production.** The only dev relaxations are listed in Dev Notes → Dev-only relaxations, and a unit test asserts both the production and the development policy exactly.
   Next.js reads the nonce from the **request** CSP header and puts it on its own scripts. Every page that gets the nonce CSP is dynamically rendered, and a CI check fails the build if a page is statically prerendered without being classified as marketing (NFR28, AR-architecture gap 1).
2. **Hash CSP for static marketing routes.** The static policy (`buildStaticCsp`, hashes of inline scripts, no nonce) and a route classifier (`MARKETING_PATHS`) exist and are unit-tested. No marketing route exists yet (`MARKETING_PATHS` is empty; `/` is an app route with the nonce CSP until Epic 13). Story 13.1 wires the build-time hash manifest (Dev Notes → Static marketing CSP).
3. **CSRF.** `src/lib/http/origin.ts` provides `isAllowedOrigin(headers)` and `withOriginCheck(handler)` for state-changing route handlers: a missing, `null`, malformed or foreign `Origin` gets `403` with a fixed `FORBIDDEN` body. An ESLint rule makes `POST`/`PUT`/`PATCH`/`DELETE` exports in `src/app/**/route.ts` use `withOriginCheck`, and a lint test proves it. Server actions rely on Next.js's built-in Origin/Host check; `serverActions.allowedOrigins` stays unset (same-origin only) (NFR29).
4. **Static security headers on every response.** `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (value in Dev Notes), `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin` are set from one constant in `src/lib/security/headers.ts`:
   - by `next.config.ts` `headers()` for every path (this covers `_next/static` and anything outside the proxy matcher);
   - and by the proxy on every response it returns, redirects included.
   `X-Powered-By` is removed (`poweredByHeader: false`) (NFR28).
5. **Sentry.** `@sentry/nextjs` is pinned to **11.4.0** (Dev Notes → Library versions). It reports client errors (`src/instrumentation-client.ts`), server errors (`src/instrumentation.ts` `onRequestError` + `register`), handled errors logged with `logger.error`, and worker errors through the worker error pattern (Dev Notes → Worker errors):
   - with no `NEXT_PUBLIC_SENTRY_DSN`, Sentry is **never initialised** (no client, no network, no global handlers), locally and in CI;
   - `next build` succeeds with no `SENTRY_AUTH_TOKEN` and uploads no source maps unless a token is set;
   - `sendDefaultPii: false`, no tracing, no Replay, no user feedback, `includeLocalVariables: false`;
   - `beforeSend` and `beforeBreadcrumb` scrub every event so that drawing content, file names, emails, query strings, cookies, auth headers and request bodies never leave. The only data-bearing tag allowed is `drawing_id` (a UUID). The scrubber is unit-tested (NFR46, AR21).
6. **Logger and safe errors.** `src/lib/logger.ts` keeps `debug/info/warn/error` gated by `NEXT_PUBLIC_LOG_LEVEL` (default `info` in production, `debug` otherwise) and changes to `logger.<level>(event, fields?)`. Field keys that look like secrets or user content are redacted, string values are scrubbed and capped, and `Error` values are reduced to `name` + scrubbed `message` (stack only outside production). `logger.error` with an `Error` forwards it to the registered error reporter (Sentry when initialised). `Result` error paths use fixed per-code messages through `internalError()`, and a test proves that neither a `Result` nor a route error screen ever contains the error message, stack, SQL or digest beyond a safe error id (NFR32).
7. **Error boundaries.** `src/app/error.tsx`, `src/app/(auth)/error.tsx`, `src/app/(workspace)/error.tsx` and `src/app/global-error.tsx` render one shared `RouteErrorScreen`: heading "Something stopped working", body "Your markups are saved locally.", one primary `Button` "Reload" (full page reload), and a collapsed "Details" disclosure with "Error ID <digest>" only when a safe digest exists. It uses the Story 1.4 tokens and `Button`, near-sharp style, the group's theme (Daylight in auth, Blueprint elsewhere), and reports client-only errors (no digest) to Sentry (UX-DR30).
8. **Tests pass locally and in CI:**
   - Vitest: CSP builders (prod and dev, nonce format, Supabase/Sentry origins), inline-script hashing, route classification, static headers constant, `next.config.ts` `headers()`, proxy integration (headers on pass-through and redirect responses, request CSP + `x-nonce` forwarded, incoming spoofed CSP headers overwritten), Origin helper, Sentry options (`null` without DSN) and scrubber, drawing-id tag helper, worker error serialisation and reporting, logger redaction and reporter, `internalError()`, `RouteErrorScreen`, the route-handler lint rule and the Sentry import boundary;
   - a CI build step proves `next build` works without Sentry secrets, and `check:dynamic-routes` passes;
   - Playwright `e2e/security-headers.spec.ts` asserts the headers on `/`, `/sign-in` and `/workspace` (signed in), that every `<script>` in the served HTML carries the nonce from the CSP header, that nonces differ per request, that a redirect and a `_next/static` asset carry the static headers, and that no CSP violation is logged.

## Tasks / Subtasks

- [ ] **Task 1: Pin Sentry and env** (AC: 5)
  - [ ] `npm i -E @sentry/nextjs@11.4.0` (downgrade from 11.8.0, which is only 3 days old; Dev Notes → Library versions). `npm run check:pinned` must pass, and `npm audit --omit=dev --audit-level=high` must stay clean. Update `architecture.md` → Observability (`@sentry/nextjs` 11.8.0 → 11.4.0) in the same change.
  - [ ] `src/lib/env.ts`: add optional `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`z.string().min(1).max(64).optional()`) to the public schema, and optional build-only `SENTRY_ORG` and `SENTRY_PROJECT` to the server schema. Wire them through `getPublicEnv()` / `getServerEnv()` with literal `process.env.X` reads. Extend `env.test.ts` (empty → undefined, present → value).
  - [ ] `.env.example`: document `NEXT_PUBLIC_SENTRY_DSN` ("leave empty locally and in CI: Sentry stays off"), `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` ("build only; without it no source maps are uploaded"), `SENTRY_ORG`, `SENTRY_PROJECT`. No real values anywhere.
- [ ] **Task 2: Security headers and CSP modules** (AC: 1, 2, 4)
  - [ ] `src/lib/security/headers.ts` (pure, **relative imports only**, because `next.config.ts` imports it): `export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }>` with the six headers in Dev Notes → Static headers, and `applyStaticSecurityHeaders(headers: Headers): void`.
  - [ ] `src/lib/security/csp.ts` (pure, no `server-only`, so the proxy and tests import it):
    - `generateNonce(): string`: 16 random bytes from `crypto.getRandomValues`, base64. It must match Next's `CSP_NONCE_SOURCE_REGEX` (`/^[A-Za-z0-9+/_-]+={0,2}$/`);
    - `buildNonceCsp({ nonce, supabaseUrl, sentryDsn, isDev, devHost }): string`;
    - `buildStaticCsp({ scriptHashes, supabaseUrl, sentryDsn, isDev }): string`;
    - `sentryIngestOrigin(dsn: string | undefined): string | null` (`new URL(dsn).origin`, which drops the public key in the userinfo; `null` on a missing or invalid DSN);
    - `supabaseConnectSources(url): string[]` (`origin` plus `ws(s)://host`);
    - `parseCsp(header): Map<string, string[]>`, for tests and e2e.
    Directive order and exact values are in Dev Notes → CSP policy. Serialise as `directive value value; directive …` with single spaces and no trailing `;`.
  - [ ] `src/lib/security/inline-script-hashes.ts` (pure): `hashInlineScripts(html: string): Promise<string[]>` returns `'sha256-<base64>'` for every `<script>` without a `src` attribute, in document order and de-duplicated, using `crypto.subtle.digest`. Story 13.1 uses it in a postbuild step.
  - [ ] `src/lib/security/route-policy.ts` (pure): `export const MARKETING_PATHS: ReadonlySet<string> = new Set()` and `cspModeFor(pathname): "nonce" | "static"`. Document in a comment that a path may only be added here together with its hash manifest (Story 13.1).
- [ ] **Task 3: Proxy** (AC: 1, 2, 4)
  - [ ] Update `src/proxy.ts` per Dev Notes → Proxy flow. Preserve the Story 1.5 behaviour exactly: `PUBLIC_PATHS`, default-deny, the `next` param on GET/HEAD only, copying refreshed cookies onto the redirect, and the matcher (a constant literal; leave it unchanged).
  - [ ] Before `updateSession`, `request.headers.set("content-security-policy", csp)` and `request.headers.set("x-nonce", nonce)` (**set**, never append, so a client-sent CSP or `x-nonce` header is overwritten). `updateSession` builds `NextResponse.next({ request })`, so the overrides are forwarded. If the e2e nonce assertion fails, change `updateSession(request)` to accept explicit request headers, and record which way you went.
  - [ ] Set `Content-Security-Policy` and the static headers on the final response: pass-through and redirect.
  - [ ] Marketing branch: `cspModeFor(pathname) === "static"` → `buildStaticCsp({ scriptHashes: [] … })` and no nonce. It is unreachable while `MARKETING_PATHS` is empty, but it fails closed and is unit-tested.
  - [ ] `src/proxy.test.ts` (node env; mock `@/lib/auth/proxy-session` to return a `NextResponse.next({ request })` with `isAuthenticated` controlled by the test): the cases in Dev Notes → Proxy tests.
- [ ] **Task 4: Make nonce pages dynamic and guard it** (AC: 1, 8)
  - [ ] `src/app/layout.tsx`: make `RootLayout` `async` and `await connection()` (from `next/server`) as its first statement, with a comment: the nonce CSP needs per-request rendering (Next CSP guide); the Epic 13 marketing group gets its own root layout without this. Keep `metadata`, fonts and `data-theme="blueprint"` unchanged.
  - [ ] `scripts/check-dynamic-routes.mjs`: reads `.next/prerender-manifest.json` and fails, naming the route, if any key of `routes` is not in `STATIC_ROUTE_ALLOWLIST`. Export the pure `findUnexpectedStaticRoutes(manifest, allowlist)` and test it in `scripts/check-dynamic-routes.test.mjs` (fixtures: clean, offending `/`, allowlisted entry). Run `npm run build` once, read the real manifest, and set the allowlist to the non-HTML entries you find (expected: `/favicon.ico`, possibly `/_global-error`; never `/`, `/sign-in`, `/workspace`, `/_not-found`). Record the real list in the Debug Log. If `/_not-found` stays static even with the root layout dynamic, add `src/app/not-found.tsx` (server component, `await connection()`, a short "Page not found" screen styled with the tokens and a link to `/workspace`) and re-check.
  - [ ] `package.json`: `"check:dynamic-routes": "node scripts/check-dynamic-routes.mjs"`.
- [ ] **Task 5: next.config.ts** (AC: 3, 4, 5)
  - [ ] Per Dev Notes → next.config: `poweredByHeader: false`; `async headers()` returning `[{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }]`; no CSP here (the proxy owns it); no `serverActions.allowedOrigins`; keep the `turbopack.rules` block and the cacheComponents comment; wrap the export with `withSentryConfig(nextConfig, sentryBuildOptions)`.
  - [ ] `tools/config/next-config.test.ts`: import the config, call `headers()`, and assert the source and the six headers; assert `poweredByHeader === false`; assert that no `experimental.serverActions.allowedOrigins` is set. If importing the wrapped config in Vitest pulls in Sentry build code that fails in Vitest, export the unwrapped `nextConfig` and the `sentryBuildOptions` as named exports and test those. Also test `sentryBuildOptions` without `SENTRY_AUTH_TOKEN`: `sourcemaps.disable === true`, `telemetry === false`.
- [ ] **Task 6: Sentry wiring** (AC: 5)
  - [ ] `src/lib/sentry/scrub.ts` (pure, no Sentry import, types from `@sentry/nextjs` with `import type` only): `scrubText`, `scrubUrl`, `scrubEvent`, `scrubBreadcrumb`, `isSafeDrawingId`, per Dev Notes → Scrubbing rules.
  - [ ] `src/lib/sentry/options.ts` (pure): `buildSentryOptions({ dsn, environment, runtime }): SentryInitOptions | null`. It returns `null` when `dsn` is missing. Otherwise it returns the options in Dev Notes → Sentry options, with `beforeSend: scrubEvent` and `beforeBreadcrumb: scrubBreadcrumb`.
  - [ ] `src/lib/sentry/init.ts`: `initSentry(runtime: "browser" | "nodejs")` reads the env (literal `process.env.NEXT_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT`), calls `buildSentryOptions`, returns early on `null`, else calls `Sentry.init(options)` and `setErrorReporter(reportLoggedError)` from the logger. It is idempotent (a module-level flag).
  - [ ] `src/lib/sentry/context.ts`: `setDrawingContext(drawingId: string | null)` sets or clears the `drawing_id` tag (`Sentry.setTag`) only for a valid UUID (permissive regex, not Zod `uuid()`); anything else clears it and logs `logger.warn("sentry.invalid_drawing_id")` with no value. Story 3.x calls it when a drawing opens or closes.
  - [ ] `src/lib/sentry/report.ts`: `reportError(error: unknown, opts?: { drawingId?: string; worker?: WorkerName; event?: string })` wraps `Sentry.captureException` with allowlisted tags. It is a no-op when Sentry is not initialised (the SDK already no-ops without a client; keep it that way, no extra global state).
  - [ ] `src/instrumentation.ts`: `export async function register()` that runs `initSentry("nodejs")` only when `process.env.NEXT_RUNTIME === "nodejs"` (nothing runs on edge in this app; leave an edge comment). Add `export const onRequestError = Sentry.captureRequestError;`.
  - [ ] `src/instrumentation-client.ts`: `initSentry("browser")`, and `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;`. Keep it light (Next warns above 16 ms).
  - [ ] Unit tests: `src/lib/sentry/scrub.test.ts` (the full table in Dev Notes → Scrubber test cases), `options.test.ts` (no DSN → `null`; with DSN → `sendDefaultPii === false`, no `tracesSampleRate`, `includeLocalVariables === false`, both hooks set, no Replay or Feedback integration), `context.test.ts` and `report.test.ts` (with `vi.mock("@sentry/nextjs")`), and `init.test.ts` (no DSN → `Sentry.init` is never called and no reporter is registered; with DSN → called once even when called twice).
  - [ ] Optional SDK round-trip: if `@sentry/nextjs` loads in Vitest, init a client with a dummy DSN (`https://public@o0.ingest.sentry.io/0`) and a capturing `transport`, capture an error built from the dirty fixture, and assert that the serialised envelope contains none of the forbidden strings. If it does not load cleanly, skip it and say so in the Completion Notes.
- [ ] **Task 7: Worker error pattern** (AC: 5)
  - [ ] `src/core/worker/error.ts` (framework-free): `type SerializedWorkerError = { name: string; message: string; stack?: string }` and `serializeWorkerError(value: unknown): SerializedWorkerError`, per Dev Notes → Worker errors. It **never** stringifies a non-`Error` value.
  - [ ] `src/lib/sentry/worker-errors.ts`: `type WorkerName = "render" | "engine" | "export"`; `reportWorkerError(worker, serialized, drawingId?)` rebuilds an `Error` and calls `reportError`; `attachWorkerErrorReporting(worker: Worker, name: WorkerName, getDrawingId?: () => string | null): () => void` listens to `error` (`ErrorEvent`) and `messageerror` and returns a detach function. Protocol `{ type: "error" }` replies are reported by the future RPC helper (`src/workers/rpc.ts`, Story 3.1) calling `reportWorkerError`; document this in a JSDoc. Do **not** create any worker file.
  - [ ] Tests: `src/core/worker/error.test.ts` and `src/lib/sentry/worker-errors.test.ts` (a fake `EventTarget` as the worker; mocked `@/lib/sentry/report`).
- [ ] **Task 8: Logger, redaction and safe results** (AC: 6)
  - [ ] `src/lib/redact.ts` (pure): `scrubText(text, max = 500)` and `redactFields(fields)`, shared by the logger and the Sentry scrubber (move `scrubText` here; `scrub.ts` re-uses it).
  - [ ] Rewrite `src/lib/logger.ts` per Dev Notes → Logger. Keep it the only file allowed to call `console.*`, and keep the literal `process.env.NEXT_PUBLIC_LOG_LEVEL` read. Add `setErrorReporter(fn | null)`. No Sentry import in the logger.
  - [ ] Update the four call sites to the new signature: `src/features/account/actions.ts` (`logger.error("auth.rate_limiter_failed", { error })`, `logger.error("auth.session_unreadable_after_sign_in")`) and `src/lib/auth/sign-in.ts` (`"auth.sign_in_upstream_failed"`, `"auth.sign_out_failed"` with `{ status, code }`). Keep `actions.test.ts` green.
  - [ ] `src/lib/result.ts`: add `SAFE_MESSAGES: Record<ResultCode, string>`, `fail(code, message = SAFE_MESSAGES[code])`, and `internalError(event: string, error: unknown): Result<never>`, which logs `logger.error(event, { error })` and returns `{ ok: false, code: "INTERNAL", message: SAFE_MESSAGES.INTERNAL }`. Do not change the `Result`/`ResultCode` types.
  - [ ] Tests: `src/lib/logger.test.ts`, `src/lib/redact.test.ts` and `src/lib/result.test.ts` (Dev Notes → Logger tests and Leak tests).
- [ ] **Task 9: Error boundaries** (AC: 6, 7)
  - [ ] `src/components/route-error-screen.tsx` (`"use client"`): the presentational `RouteErrorScreen({ digest, onReload })` per Dev Notes → ErrorBoundary UX. It renders the digest only when it matches `/^[A-Za-z0-9_-]{1,64}$/`.
  - [ ] `src/components/route-error-boundary.tsx` (`"use client"`): `RouteErrorBoundary({ error })` (the shared body of every `error.tsx`). In `useEffect`: `logger.error("route.error_boundary", { error })` and, **only if the error has no `digest`** (a client-side error; server errors were already reported by `onRequestError`), `reportError(error)`. `onReload = () => window.location.reload()`. It never reads `error.message` for display.
  - [ ] `src/app/error.tsx`, `src/app/(auth)/error.tsx`, `src/app/(workspace)/error.tsx`: `"use client"` defaults exporting `({ error }: { error: unknown; retry: () => void }) => <RouteErrorBoundary error={error} />`. Next 16.4 passes `error: unknown` and `retry` (stable since 16.3); read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` and use the generated prop type if `next typegen` provides one.
  - [ ] `src/app/global-error.tsx`: `"use client"`, renders its own `<html lang="en" data-theme="blueprint">` + `<body className="min-h-full flex flex-col bg-surface-0 text-text font-sans">` around `RouteErrorBoundary`, and imports `./globals.css` (global-error does not get the root layout's styles). Set the `<title>` to "Plan Markup".
  - [ ] Tests: `src/components/route-error-screen.test.tsx` (jsdom; Dev Notes → Leak tests) and `src/components/route-error-boundary.test.tsx` (mocked logger and report: reports a digest-less error once; does not report a digest error; Reload calls `window.location.reload`).
- [ ] **Task 10: Lint rules** (AC: 3, 5)
  - [ ] `eslint.config.mjs` per Dev Notes → Lint rules:
    - extract the two Story 1.5 auth selectors into `const AUTH_SYNTAX = [...]` (behaviour unchanged);
    - add a block for `src/app/**/route.{ts,tsx}` with `"no-restricted-syntax": ["error", ...AUTH_SYNTAX, ...ROUTE_HANDLER_SYNTAX]` (flat config does not merge rule options, so the auth selectors must be repeated or route files would lose NFR11);
    - add `@sentry/*` to `CORE_BANNED.patterns` and to the UI-layer `no-restricted-imports` block (the `@supabase/*` block). Error boundaries go through `@/lib/sentry/*`.
  - [ ] `tools/lint/route-handler-origin.test.ts` and an extension of `tools/lint/boundaries.test.ts` / `auth-boundaries.test.ts` (Dev Notes → Lint tests).
- [ ] **Task 11: Origin helper** (AC: 3)
  - [ ] `src/lib/http/origin.ts` (pure, Web `Request`/`Headers` only): `isAllowedOrigin(headers: Headers, extraHosts: readonly string[] = EXTRA_ALLOWED_HOSTS): boolean` and `withOriginCheck(handler)`, per Dev Notes → Origin check.
  - [ ] `src/lib/http/origin.test.ts`: the table in Dev Notes → Origin check.
- [ ] **Task 12: Playwright and CI** (AC: 1, 4, 8)
  - [ ] `e2e/security-headers.spec.ts` per Dev Notes → E2E assertions. Reuse the `signIn` flow from `e2e/auth.spec.ts`: move `signIn`, `PASSWORD`, `ACTIVE` and `formAlert` into `e2e/helpers.ts` and import them from both specs.
  - [ ] `.github/workflows/ci.yml` `checks` job: after "Unit tests", add "Build (no Sentry secrets)" `npm run build` with a step-level `env` of `NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:56321` and `NEXT_PUBLIC_SUPABASE_ANON_KEY: ci-build-placeholder` (not secrets; no Sentry variables), then "Static route guard" `npm run check:dynamic-routes`. Raise `timeout-minutes` to 20. The `e2e` job is unchanged: it already exports the local Supabase env, which the CSP `connect-src` assertion uses.
  - [ ] `README.md`: a "Security headers and error tracking" section: where the CSP lives, the dev relaxations, "Sentry is off without `NEXT_PUBLIC_SENTRY_DSN`", what is scrubbed, the `withOriginCheck` rule for route handlers, and `check:dynamic-routes`.
  - [ ] `docs/decisions/0003-csp-and-error-tracking.md` (same short format as 0001/0002): nonce CSP + dynamic root layout, the deferred static marketing hash CSP, HSTS everywhere, Sentry 11.4.0 and the no-DSN behaviour.
- [ ] **Task 13: Verify** (AC: 1–8)
  - [ ] With Docker running: `npm run db:start`, `npm run env:local`, then `npm run typecheck`, `lint`, `test`, `build`, `check:dynamic-routes`, `e2e`, `check:pinned`, `check:env-files`, and `npm audit --omit=dev --audit-level=high`. Record the outputs in the Debug Log, including the route table printed by `next build` (every page must show `ƒ`).
  - [ ] Production proof: `npm run start` (port 3020) after the build, then `curl -sI` on `/`, `/sign-in`, `/workspace` (anonymous 307) and one `_next/static/...js`. Record:
    - CSP without `unsafe-eval`/`unsafe-inline` in `script-src`, with `upgrade-insecure-requests`;
    - HSTS and the other static headers;
    - no `X-Powered-By`.
    Load `/sign-in` in a real browser (Playwright script is fine) against `next start` and confirm zero CSP violations and a working sign-in form (hydrated: the password show/hide toggle works).
  - [ ] Error screen proof: temporarily `throw new Error("probe select * from profiles")` in `src/app/(workspace)/workspace/page.tsx`, and check `/workspace` against both `next dev` and `next start`: the error screen shows, no "select" text appears, and the Details disclosure shows the digest under `next start`. Revert and record.
  - [ ] Negative lint proof: add `export async function POST() { return new Response(); }` to a probe `src/app/api/__probe__/route.ts` → `npx eslint` fails with the NFR29 message. Remove it and record.
  - [ ] Stop the dev and prod servers, free port 3020, and `npm run db:stop` unless the orchestrator asks otherwise.
  - [ ] **Do not commit or push.** The orchestrator commits, pushes and watches `ci.yml` and `db.yml`.

## Dev Notes

### Context

Done so far:
- Story 1.1: Next 16.4.2, React 19.3.1, TS 6.0.3, Zod env (`src/lib/env.ts` already has optional `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_LOG_LEVEL`), `src/lib/logger.ts` (the only file allowed `console.*`), `@sentry/nextjs` installed but **not wired** (no wizard, no instrumentation files). `cacheComponents` / `partialPrefetching` are off in `next.config.ts`.
- Story 1.2: `ci.yml` (`checks`, `e2e`, `secrets`), `check:pinned`, `check:env-files`, `npm audit --omit=dev --audit-level=high` blocking.
- Story 1.3: local Supabase on 563xx (API `http://127.0.0.1:56321`).
- Story 1.4: tokens and themes, `Button`, `TextField`, near-sharp guard (`tools/lint/near-sharp.test.ts`: `rounded`, `shadow-1/2/3` only, no blur), jsdom per file via `// @vitest-environment jsdom`.
- Story 1.5: `src/proxy.ts` (session refresh, `PUBLIC_PATHS = {"/", "/sign-in"}`, default-deny, placeholder comment "Story 1.6 adds the nonce-based CSP and security headers here"), `src/lib/auth/proxy-session.ts` (`updateSession` returns `{ response, isAuthenticated }` and builds `NextResponse.next({ request })`), `src/lib/result.ts`, the auth lint blocks, `e2e/auth.spec.ts` with a real local stack, and the CI `e2e` job that starts Supabase and exports env via `scripts/supabase-env.mjs --github-env`.

Current state of the files this story changes (read each one before editing):
- `src/proxy.ts`: ~45 lines, returns `response` from `updateSession` or a redirect to `/sign-in`. **Preserve** all of its behaviour; only add CSP/nonce and headers.
- `src/lib/logger.ts`: variadic `logger.<level>(...args)`, env-gated. Four call sites (listed in Task 8).
- `src/lib/result.ts`: types only.
- `src/app/layout.tsx`: sync `RootLayout`, Inter font, `data-theme="blueprint"`. `src/app/page.tsx` is static today (`○ /` in the 1.5 build output). That is why the root layout must become dynamic.
- `next.config.ts`: `turbopack.rules` for `*.css` (Tailwind) only. Keep it.
- `eslint.config.mjs`: core purity, oracle, NFR11 auth selectors (`src/**` minus `src/lib/auth/**`), `@supabase/*` ban in UI layers and the proxy.
- `.github/workflows/ci.yml`: `checks` has no `next build` step today.

Out of scope (do not build):
- the marketing site, its hash manifest and a production-mode e2e (Story 13.1);
- any Web Worker file or `src/workers/rpc.ts` (Story 3.1 uses the pattern);
- CSP violation reporting (`report-to`), Trusted Types, Sentry tracing/Replay/user feedback, a Sentry tunnel route;
- `activity_events` and `audit_log` (AR21 other halves: Epics 6/10);
- any database migration (none is needed; do **not** run `npx supabase migration new`);
- the Vercel deploy and the Sentry project and DSN (Story 8.5, NFR46 "from the first deployed build").

### Facts carried from earlier stories and projects (must follow)

- Next.js 16: the request interceptor is `src/proxy.ts` (not `middleware.ts`), on the Node runtime by default, and a `runtime` export throws. Its matcher must stay a static literal.
- Flat ESLint config does **not** merge options of the same rule across blocks: the last matching block wins. That is why `AUTH_SYNTAX` is repeated in the route-handler block and the `@sentry/*` pattern is added **inside** the existing UI-layer `no-restricted-imports` block (a separate block would drop the `@supabase/*` ban for those files). The lint tests prove both.
- Zod v4 `z.string().uuid()` rejects non-RFC UUIDs (the seed ids `…-4000-8000-…` are fine, but other ids may not be). For the drawing-id tag use a permissive regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
- Never override the JWT `role` claim. This story does not touch auth or Supabase config.
- In Vitest, mock `server-only` per file with `vi.mock("server-only", () => ({}))` if you import a module that uses it. Keep the new security, http, redact and scrub modules pure (no `server-only`) so the proxy, `next.config.ts` and tests can import them.
- Agent shell: redirect stdin from `/dev/null` for CLI calls that might prompt (`npx … </dev/null`). Foreground `sleep` is blocked, so poll. Free port 3020 at the end (Story 1.5 found an orphaned `next start-server.js` child holding it).
- `e2e/auth.spec.ts` lesson: Next's `#__next-route-announcer__` is also `role="alert"`; reuse the `formAlert()` helper.

### Library versions

| Package | Version | Why |
|---|---|---|
| `@sentry/nextjs` | **11.4.0** (was 11.8.0) | Rule: an exact version at least two weeks old. 11.8.0 was published 2026-10-15 (3 days old), 11.4.0 on 2026-10-02 (16 days). Peer range `next: ^14.0 \|\| ^15.0.0-rc.0 \|\| ^16.0.0-0` covers Next 16.4.2; React comes through `@sentry/react` 11.4.0, which works with React 19. Engines `>=22.12.0 <23` matches `.nvmrc`. |

- The `withSentryConfig` options used below (`sourcemaps.disable`, `telemetry`, `silent`, `authToken`, `org`, `project`, `release.create`, `widenClientFileUpload`) exist in the 11.4.0 types (`build/types/config/types.d.ts` + `@sentry/core` `build-time-plugins/buildTimeOptionsBase.d.ts`). The only typed difference from 11.8.0 is the newer top-level `bundleSizeOptimizations`/`define`, which we do not use.
- Changelog 11.5–11.8 (checked 2026-10-18): 11.7.0 adds SDK-side query-param filtering for page URLs, breadcrumbs and request error context (#25233, #25262, #25289). Our own `beforeSend`/`beforeBreadcrumb` scrubbing covers the same ground, so 11.4.0 is safe. Upgrading to 11.7.0+ after 2026-10-26 is a later, optional bump.
- No other new dependency. If you add one anyway, pin it exactly (`npm i -E`).

### CSP policy

Exact production policy from `buildNonceCsp({ nonce, supabaseUrl: "http://127.0.0.1:56321", sentryDsn: undefined, isDev: false })`, directives in this order:

```
default-src 'self';
script-src 'self' 'nonce-<n>' 'strict-dynamic';
style-src 'self' 'nonce-<n>';
style-src-attr 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self';
connect-src 'self' http://127.0.0.1:56321 ws://127.0.0.1:56321;
worker-src 'self' blob:;
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

- With a DSN `https://abc@o123.ingest.us.sentry.io/456`, `connect-src` also gets `https://o123.ingest.us.sentry.io`. Without a DSN, no Sentry host appears.
- Supabase: an `https://x.supabase.co` URL gives `https://x.supabase.co wss://x.supabase.co`; `http://…` gives `ws://…`. Realtime arrives in Story 11.6, but the origin is allowed now so the later story only adds a client. An invalid URL throws (the env schema already validates it).
- `'strict-dynamic'`: scripts loaded by nonce'd scripts are trusted; CSP3 browsers then ignore `'self'` in `script-src`. `'self'` stays for CSP2 fallback.
- `style-src` uses the nonce in production (Next puts the nonce on the inline styles it generates). `style-src-attr 'unsafe-inline'` allows only `style="…"` **attributes**, because React SSR and Radix render inline style attributes and the canvas chrome will set panel sizes. Attribute styles cannot load scripts, and the risk is accepted. Browsers without `style-src-attr` fall back to `style-src`; Chrome and Edge (full support, NFR42) and current Firefox and Safari support it. If the production proof shows blocked style attributes anyway, record it and stop.
- `worker-src 'self' blob:` covers `new Worker(new URL(…, import.meta.url))` and pdf.js. Worker scripts under `_next/static` are outside the proxy matcher, so they carry no CSP of their own (only the next.config static headers). If pdf.js later needs WebAssembly **on the main thread**, Story 3.1 adds `'wasm-unsafe-eval'` with a test. Inside workers, no change is needed.
- `frame-src` is not set (falls back to `default-src 'self'`). Epic 8 print may need `blob:` there; that is its decision.
- `upgrade-insecure-requests` is production only (on `http://localhost` it would try to upgrade the local Supabase `http://` calls).
- Nonce: `generateNonce()` = 16 bytes (128 bits) from `crypto.getRandomValues`, base64 (`btoa(String.fromCharCode(...bytes))`). A new one for every proxy invocation. Never log it.

### Dev-only relaxations (`isDev = process.env.NODE_ENV === "development"`)

Only these, each asserted by `csp.test.ts`:
1. `script-src` adds `'unsafe-eval'`: React dev uses `eval` to rebuild server error stacks in the browser (Next CSP guide: "In development, 'unsafe-eval' is required … not required for production").
2. `style-src` becomes `'self' 'unsafe-inline'` **without** the nonce: Turbopack/HMR injects `<style>` tags, and a nonce in the list would make browsers ignore `'unsafe-inline'`. `style-src-attr` stays.
3. `connect-src` adds `ws://<devHost>` (from `request.nextUrl.host`, for example `ws://localhost:3020`) for the HMR socket.
4. No `upgrade-insecure-requests`.

`'unsafe-inline'` never appears in `script-src`, in dev or production. The production test asserts the absence of `unsafe-eval`, `unsafe-inline` (in `script-src`/`style-src`) and `ws://localhost`. `NODE_ENV=test` (Vitest) counts as non-dev, so pass `isDev` explicitly in tests.

### Static marketing CSP (deferred wiring, decided)

- Next.js has no built-in hash CSP for inline scripts: `experimental.sri` only adds `integrity` to external chunks, and a static page still contains inline `self.__next_f.push(…)` RSC scripts whose hashes are known only after prerendering. The proxy is compiled before those pages exist, and in dev the page is re-rendered per request with different scripts. So a real hash CSP needs a postbuild manifest (`hashInlineScripts` over `.next/server/app/**/*.html`) read by the proxy at runtime, plus Vercel file tracing for it, plus a production-mode e2e. That belongs with the first real marketing page (Story 13.1).
- Today the only public page, `/`, is a component demo with a Sign in link, not marketing. It gets the nonce CSP and becomes dynamic through the root layout. Cost: none that matters for a placeholder.
- What this story ships for the hash path: `buildStaticCsp`, the same directives as production except `script-src 'self' <hashes…>` (no `'strict-dynamic'`, no nonce) and `style-src 'self'`; `hashInlineScripts`; `MARKETING_PATHS` + `cspModeFor`; the fail-closed proxy branch; and `check:dynamic-routes`, which turns "a page silently became static and lost its nonces" into a CI failure. Story 13.1 will give `(marketing)` its own root layout (without `connection()`), fill `MARKETING_PATHS`, add the manifest, and extend the allowlist.

### Static headers

`STATIC_SECURITY_HEADERS` (exact values):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), fullscreen=(self)` |
| `X-Frame-Options` | `DENY` |
| `Cross-Origin-Opener-Policy` | `same-origin` |

- **HSTS in dev:** sent with the same value in every environment (one code path, one exact e2e assertion). Browsers ignore `Strict-Transport-Security` received over plain HTTP (RFC 6797 §8.1), so `http://localhost:3020` is unaffected. Caveat for the README: never run this project with `next dev --experimental-https`, or the browser would pin `localhost` to HTTPS for two years. No `preload` (a domain-level, hard-to-undo decision for the founder at launch).
- `X-Frame-Options: DENY` is the legacy twin of `frame-ancestors 'none'`. `fullscreen=(self)` keeps a possible canvas fullscreen mode available. Avoid unknown feature names: Chrome logs "Unrecognized feature" warnings, which the e2e console check could catch.
- Set in two places: `next.config.ts` `headers()` (applied first, for every path including `_next/static`; execution order in `proxy.md`) **and** `applyStaticSecurityHeaders()` in the proxy, which covers proxy-generated redirects regardless of how Next merges config headers into them. Duplicates with the same value are harmless; the unit and e2e tests check the value.

### Proxy flow

```ts
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const env = getPublicEnv();
  const isDev = process.env.NODE_ENV === "development";
  const nonce = cspModeFor(pathname) === "nonce" ? generateNonce() : null;
  const csp = nonce
    ? buildNonceCsp({ nonce, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN, isDev, devHost: request.nextUrl.host })
    : buildStaticCsp({ scriptHashes: [], supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN, isDev });

  // Next.js reads the nonce from the *request* CSP header during rendering.
  request.headers.set("content-security-policy", csp);
  if (nonce) request.headers.set("x-nonce", nonce); else request.headers.delete("x-nonce");

  const { response, isAuthenticated } = await updateSession(request);
  const result = !isAuthenticated && !isPublicPath(pathname) ? redirectToSignIn(request, response) : response;
  return withSecurityHeaders(result, csp);
}
```

- `withSecurityHeaders(res, csp)`: `res.headers.set("Content-Security-Policy", csp)` + `applyStaticSecurityHeaders(res.headers)`.
- Mutating `request.headers` before `updateSession` works because `NextResponse.next({ request })` forwards the request's headers (the same mechanism forwards the refreshed cookies). Verify with the e2e nonce assertion. If it fails, give `updateSession` an optional `requestHeaders` parameter and use `NextResponse.next({ request: { headers } })` in both places it builds a response, keeping cookie forwarding intact (`auth.spec.ts` must stay green).
- `getPublicEnv()` throws on missing Supabase env. That already happens in `updateSession` today, so it is no new failure mode.
- Do not add the Next docs' `missing: [next-router-prefetch]` matcher condition: the proxy also does auth refresh and redirects for those requests.

### Proxy tests (`src/proxy.test.ts`)

Build requests with `new NextRequest("http://localhost:3020/<path>", { headers })`. Stub env with `vi.stubEnv` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NODE_ENV`). Note that `getPublicEnv()` caches: reset modules between env cases (`vi.resetModules()` + dynamic import).
1. Authenticated `/workspace`: the response has `Content-Security-Policy` with a `'nonce-…'` in `script-src`, plus all six static headers.
2. The request seen by `updateSession` (capture it in the mock) has `content-security-policy` equal to the response header, and `x-nonce` equal to the nonce inside it.
3. A request that arrives with `content-security-policy: script-src 'nonce-attacker'` and `x-nonce: attacker` → both are overwritten.
4. Anonymous `/workspace` → 307 to `/sign-in?next=%2Fworkspace` **with** the CSP and static headers, and a refreshed cookie set by the mock is still copied (the Story 1.5 behaviour).
5. Two calls produce different nonces; each nonce matches `/^[A-Za-z0-9+/]+={0,2}$/` and decodes to 16 bytes.
6. `NODE_ENV=production`: no `unsafe-eval`, has `upgrade-insecure-requests`. `NODE_ENV=development`: `unsafe-eval` present, `ws://localhost:3020` present.
7. With `MARKETING_PATHS` mocked to contain `/`: `/` gets a policy with no nonce and no `x-nonce` request header (the fail-closed branch).

### next.config

```ts
import type { NextConfig } from "next";
import { withSentryConfig, type SentryBuildOptions } from "@sentry/nextjs";
import { STATIC_SECURITY_HEADERS } from "./src/lib/security/headers";

export const nextConfig: NextConfig = {
  poweredByHeader: false,
  // (keep the cacheComponents comment and turbopack.rules block as they are)
  async headers() {
    return [{ source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] }];
  },
  // Server actions: Next.js compares Origin with Host / X-Forwarded-Host and rejects
  // mismatches. Same-origin only, so serverActions.allowedOrigins stays unset. Add the
  // public host here (and to EXTRA_ALLOWED_HOSTS in src/lib/http/origin.ts) only if a
  // reverse proxy ever forwards a different host.
};

const hasAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN);
export const sentryBuildOptions: SentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !hasAuthToken },
  release: { create: hasAuthToken },
  widenClientFileUpload: false,
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
```

- Always wrap, so CI builds exercise the same wrapper the deploy will use. Without a token it must neither fail nor upload. Record any warning `next build` prints about the missing token. A warning is fine; an error is not.
- `next.config.ts` cannot use the `@/` alias reliably, so `headers.ts` is imported by relative path and must itself use only relative imports (it has none).
- If `withSentryConfig` 11.4.0 changes `turbopack.rules`, check that Tailwind still compiles in dev and build (the home page renders styled) before going on.
- Do not run the Sentry wizard: it would write its own config files and a DSN.

### Sentry options

`buildSentryOptions({ dsn, environment, runtime })` with a DSN returns:

```ts
{
  dsn,
  environment: environment ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
  sendDefaultPii: false,
  // No tracesSampleRate / tracesSampler: tracing stays off in M1 (errors only).
  maxBreadcrumbs: 50,
  attachStacktrace: true,
  includeLocalVariables: false,   // node only; harmless elsewhere (omit if the type rejects it in browser options)
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  integrations: (defaults) => defaults.filter((i) => !DENIED_INTEGRATIONS.has(i.name)),
}
```

- `DENIED_INTEGRATIONS = new Set(["Replay", "ReplayCanvas", "Feedback", "BrowserTracing"])`. None are default in 11.x, but the filter makes that a tested guarantee.
- No `Sentry.setUser` anywhere in this story. If a later story sets a user, it must be `{ id }` only; the scrubber enforces it.
- Without a DSN, `initSentry` returns before `Sentry.init`, so there are no global error handlers, no OpenTelemetry instrumentation on the server and no network calls. `captureException`, `captureRequestError` and `captureRouterTransitionStart` are safe no-ops without a client (the SDK's design). `init.test.ts` proves `init` is not called.

### Scrubbing rules (`src/lib/sentry/scrub.ts`, `src/lib/redact.ts`)

Default-deny: keep only what is listed.

- `scrubText(text, max = 500)`:
  - emails → `[email]`;
  - file-name-like tokens `[^\s/\\"'<>]+\.(pdf|btx|bpx|xml|json|csv|png|jpe?g|tiff?|dwg|dxf|zip)\b` (case-insensitive) → `[file]`;
  - `Key (…)=(…)` (Postgres unique violations) → `Key ([redacted])=([redacted])`;
  - `Bearer <token>` and `eyJ…` JWT-like strings → `[token]`;
  - `sb_secret_…` / `sb_publishable_…` → `[key]`;
  - URL query strings and fragments inside the text → removed;
  - result truncated to `max` characters.
- `scrubUrl(url)`: origin + path only (no query, no fragment). Each path segment is kept if it is a UUID or matches `/^[a-z][a-z0-9-]{0,39}$/`; otherwise it becomes `[redacted]` (file names, tokens in shared-link paths, mixed-case ids). Relative URLs keep the same path rule. Unparseable input → `[redacted-url]`.
- `scrubEvent(event)` returns a new event (do not mutate shared objects; returning `null` drops the event, which is never needed here):
  - `request`: keep only `method` and `url` (scrubbed). Delete `data`, `cookies`, `query_string`, `env` and `headers` (keep `user-agent` only);
  - `user`: keep only `id`, when it is a UUID; otherwise delete `user`;
  - `tags`: keep only `drawing_id` (UUID only), `worker` (`render|engine|export`), `log_event` (`/^[a-z][a-z0-9_.]{0,63}$/`) and `runtime`; drop all others;
  - `extra`: delete;
  - `contexts`: keep only `app`, `browser`, `os`, `runtime`, `device`, `culture`, `trace`, `react` (component stack only). Drop everything else, including `nextjs` request context if present (it may hold route params);
  - `message` and every `exception.values[].value`: `scrubText`. `exception.values[].type` stays;
  - stack frames: delete `vars`; `abs_path`/`filename` through `scrubUrl` when they are URLs;
  - `transaction`: `scrubUrl`-style path rule;
  - `breadcrumbs`: each through `scrubBreadcrumb`, dropping `null`s;
  - `server_name`: delete.
- `scrubBreadcrumb(crumb)`:
  - keep only categories `navigation`, `fetch`, `xhr` (and `http` on the server);
  - drop `console` (logger output), `ui.*` (selectors can carry markup text in `aria-label`/`title`), `sentry.*` and everything else (`null`);
  - for kept categories: `data` reduced to `{ method?, status_code?, url?/from?/to? }` with URLs scrubbed; `message` scrubbed.
- `isSafeDrawingId(value)`: the permissive UUID regex.

### Scrubber test cases (`scrub.test.ts`)

Use one "dirty" event fixture containing all of:
- `request.url = "https://app.example/d/AbCtoken123/Level%202%20Fire.pdf?email=a@b.co#x"`, `request.query_string`, `request.cookies`, `request.headers.authorization = "Bearer eyJhbGciOi…"`, `request.headers.cookie`, `request.data = "{\"text\":\"Riser note\"}"`;
- `user = { id: "<uuid>", email: "a@b.co", ip_address: "1.2.3.4", username: "x" }`;
- `tags = { drawing_id: "<uuid>", file_name: "L2.pdf", worker: "engine", random: "x" }`;
- `extra = { markupText: "Riser note" }`, `contexts.drawing = {…}`;
- an exception value `duplicate key … Key (name)=(Level 2 Fire.pdf) already exists for user a@b.co`;
- breadcrumbs: a console one, a `ui.click` with `[aria-label="Riser note"]`, a fetch to `http://127.0.0.1:56321/rest/v1/profiles?select=*&email=eq.a%40b.co`, a navigation to `/d/AbCtoken123?x=1`.

Assert that the JSON of the result contains **none of**: `a@b.co`, `a%40b.co`, `Level 2 Fire.pdf`, `L2.pdf`, `Riser note`, `AbCtoken123`, `eyJ`, `1.2.3.4`, `email=`, `select=`, `#x`. Also assert that it **keeps** `drawing_id` (UUID), `worker`, `user.id`, the exception `type`, the fetch breadcrumb with path `/rest/v1/profiles`, and `request.method`. Add separate cases for:
- a non-UUID `drawing_id` → dropped;
- an invalid `worker` → dropped;
- unparseable URLs;
- 600-char messages → 500;
- `scrubText` on each pattern (`it.each`);
- the input event object is not mutated.

### Worker errors

- Inside workers (Story 3.1+), the message handler wraps every request: `try { … } catch (e) { postMessage({ type: "error", reqId, error: serializeWorkerError(e) }) }`. The main-thread RPC helper rejects the caller's promise and calls `reportWorkerError(worker, error, drawingId)`. Uncaught worker errors (outside a request) reach the main thread as an `ErrorEvent` on the `Worker` object, which `attachWorkerErrorReporting` catches. Sentry is never initialised inside a worker: one client, one scrubber.
- `serializeWorkerError(value)`:
  - for an `Error`: `{ name, message: message.slice(0, 500), stack: stack?.slice(0, 4000) }` (the main thread scrubs again through `beforeSend`);
  - for a non-`Error` value: `{ name: "NonErrorThrown", message: \`Non-Error value thrown (${typeof value})\` }`. Never `String(value)` or JSON, because a thrown object could be drawing content.
- `attachWorkerErrorReporting`:
  - `error` event → `reportWorkerError(name, { name: "WorkerError", message: event.message || "Uncaught worker error" }, getDrawingId?.())` (no `filename`, which carries a chunk URL; line and column may be added to the message);
  - `messageerror` → `{ name: "WorkerMessageError", message: "Worker message could not be deserialised" }`.
  It returns a function that removes both listeners.
- Tests:
  - serialisation of `Error`, `TypeError` with a long message, a string, an object `{ text: "Riser note" }` (output must not contain "Riser"), `null`;
  - the reporter is called once per event with the right `worker` and `drawingId`;
  - detach stops reporting.

### Logger

```ts
export type LogValue = string | number | boolean | null | undefined | Error;
export type LogFields = Record<string, LogValue>;
export type ErrorReporter = (error: Error, event: string) => void;

logger.debug(event: string, fields?: LogFields): void   // also info / warn / error
setErrorReporter(reporter: ErrorReporter | null): void
```

- `event` is a constant, developer-written, `snake.dotted` string (`auth.rate_limiter_failed`). A JSDoc says never to interpolate user data into it.
- `redactFields(fields)`:
  - keys matching `/pass(word)?|secret|token|key|auth|cookie|session|email|name|file|content|text|body|note|comment/i` → `"[redacted]"`. Exceptions: `error`, `status`, `code`, `count`, `durationMs`, `drawingId` (UUID-checked) and the keys a call site passes that do not match;
  - other strings → `scrubText(value, 200)`;
  - `Error` → `{ name, message: scrubText(message, 300) }`, plus `stack` only when `NODE_ENV !== "production"`.
- Output:
  - production: one line, `console[level](JSON.stringify({ level, event, ...redacted }))`, so Vercel logs stay parseable;
  - otherwise: `console[level](event, redacted)`.
- `logger.error(event, fields)`: when a reporter is registered and `fields` contains an `Error` (first `Error` value), call `reporter(error, event)`, guarded by try/catch so logging never throws. The Sentry reporter calls `reportError(error, { event })`, which sets the `log_event` tag.
- Level gating unchanged: `NEXT_PUBLIC_LOG_LEVEL` literal read, default `info` in production, `debug` otherwise.

### Logger tests

- Level gating: with `vi.stubEnv` set to `warn`, `info` is not printed and `warn` is (spy on `console.*`).
- Redaction: `{ email: "a@b.co", password: "x", token: "t", fileName: "L2.pdf", status: 429 }` → only `status` survives in clear text.
- An `Error` whose message contains an email and a file name → scrubbed. Stack is absent with `NODE_ENV=production`.
- Production output is valid JSON on one line.
- The reporter receives the `Error` from `logger.error` and is not called for `warn`/`info`; a throwing reporter does not throw out of the logger.
- `setErrorReporter(null)` stops reporting.

### Leak tests

- `result.test.ts`: `internalError("x.failed", new Error('relation "profiles" … select * from profiles where email = \'a@b.co\'\n    at q (/app/src/lib/db/x.ts:1:1)'))` returns exactly `{ ok: false, code: "INTERNAL", message: SAFE_MESSAGES.INTERNAL }`. Its JSON contains none of `select`, `profiles`, `a@b.co`, ` at `, `.ts`. The logger was called with the event, and the logged fields are scrubbed (no email). `fail("NOT_FOUND")` uses the safe message. Every `ResultCode` has a non-empty safe message.
- `SAFE_MESSAGES` (exact copy, no apologies, no codes):

  | Code | Message |
  |---|---|
  | `NOT_FOUND` | "This item no longer exists." |
  | `FORBIDDEN` | "You don't have access to this." |
  | `CONFLICT` | "This changed somewhere else. Reload to see the latest version." |
  | `INVALID_INPUT` | "Check the highlighted fields." |
  | `RATE_LIMITED` | "Too many requests. Try again in a few minutes." |
  | `INTERNAL` | "Something went wrong on our side. Try again shortly." |
  | `UNAUTHENTICATED` | "Sign in to continue." |

  The existing sign-in action messages stay as they are (more specific copy).
- `route-error-screen.test.tsx` (jsdom): render `RouteErrorBoundary` (mocked logger and report) with `Object.assign(new Error("SELECT * FROM profiles WHERE email='a@b.co'"), { digest: "2918472301" })`:
  - the document text contains "Something stopped working", "Your markups are saved locally." and "Reload";
  - it contains neither "SELECT" nor "a@b.co";
  - the digest appears only inside the `<details>` (closed by default) as "Error ID 2918472301";
  - with digest `"<script>"` or 100 chars, no Error ID is rendered;
  - with a thrown string `"Riser note"` (not an `Error`), no "Riser" appears;
  - there is exactly one `<h1>`, and the Reload button is a primary `Button` (`data-variant="primary"`).

### ErrorBoundary UX (UX-DR30)

- Copy (exact):
  - heading (h1) "Something stopped working" (what happened, no apology);
  - body "Your markups are saved locally." (what is safe);
  - one primary `Button` `size="md"` "Reload" with a `RotateCw` icon (`aria-hidden`);
  - below, `<details><summary>Details</summary><p>Error ID {digest}</p></details>` (UX: "no codes in the main text, codes in Details").
  The UX spec writes this as "Your markups are saved locally · Reload": message + action.
- Layout: the same card as PendingActivation:
  - `w-full max-w-sm flex flex-col gap-6 rounded border border-border bg-surface-1 p-8 shadow-1`;
  - centred in `<main className="flex flex-1 items-center justify-center px-4 py-12">`;
  - a `CircleX` icon in `text-danger` next to the heading (status colour always with icon + text; orange is never a status colour);
  - `text-ad-xl font-semibold` heading, `text-ad-sm` body, `text-ad-sm text-muted` details.
  The near-sharp guard must stay green.
- Themes:
  - `(auth)/error.tsx` renders inside the `(auth)` layout's Daylight wrapper, so it inherits Daylight;
  - `(workspace)/error.tsx` and `app/error.tsx` inherit Blueprint from `<html>`;
  - `global-error.tsx` sets `data-theme="blueprint"` itself.
  Note the segment rule: an error thrown in `(workspace)/layout.tsx` (for example the profile query failing in `requireActiveUser`) is caught by `app/error.tsx`, not `(workspace)/error.tsx`. That is why the root `error.tsx` exists.
- Wrap the route error screens in `<main>`. Nested layouts may already render one: the `(auth)` layout has a `<main>`, so the auth error screen must not add a second one. Give `RouteErrorScreen` an `as` prop or render a `<div>` inside existing mains. Check one `<main>` per page in the jsdom test of each variant.
- Reload = `window.location.reload()` (a full reload: markups will come back from IndexedDB in Epic 6). Do not use `retry()`.
- Accessibility: the heading receives focus on mount (`tabIndex={-1}` + `ref.focus()`), so screen readers announce the failure. The button has a visible focus ring (Button already uses `focus-ring`).

### Origin check

```ts
export const EXTRA_ALLOWED_HOSTS: readonly string[] = []; // mirror of serverActions.allowedOrigins (unset)

export function isAllowedOrigin(headers: Headers, extraHosts = EXTRA_ALLOWED_HOSTS): boolean {
  // 1. origin = headers.get("origin"); missing, "null" or longer than 2048 → false
  // 2. parse with new URL(origin); failure → false; protocol must be http: or https:
  // 3. expected = (headers.get("x-forwarded-host")?.split(",")[0] ?? headers.get("host"))?.trim().toLowerCase()
  // 4. return url.host.toLowerCase() === expected || extraHosts.includes(url.host.toLowerCase())
}

export function withOriginCheck<Ctx>(handler: (request: Request, ctx: Ctx) => Response | Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> =>
    isAllowedOrigin(request.headers)
      ? handler(request, ctx)
      : Response.json({ ok: false, code: "FORBIDDEN", message: SAFE_MESSAGES.FORBIDDEN }, { status: 403 });
}
```

- It compares the host the way Next.js does for server actions (Origin host vs `x-forwarded-host` or `host`). On Vercel, `x-forwarded-host` is set by the platform. A cross-site browser form cannot set it, and a cross-origin `fetch` with custom headers is preflighted and fails.
- Stricter than Next's action check on purpose: a **missing** Origin is rejected. Browsers always send `Origin` on POST/PUT/PATCH/DELETE, and clients without it are not browsers (and have no victim cookies). A future webhook route that cannot send `Origin` must be reviewed and exempted explicitly (eslint-disable with a reason), never by weakening the helper.
- Test table (`origin.test.ts`):

  | Origin | Host / X-Forwarded-Host | Expected |
  |---|---|---|
  | `http://localhost:3020` | host `localhost:3020` | true |
  | `https://app.example.com` | xfh `app.example.com`, host `internal:3000` | true |
  | `https://APP.example.com` | host `app.example.com` | true |
  | `https://evil.com` | host `app.example.com` | false |
  | `https://app.example.com.evil.com` | host `app.example.com` | false |
  | `http://localhost:3021` | host `localhost:3020` | false |
  | missing | host `localhost:3020` | false |
  | `null` | host `localhost:3020` | false |
  | `not a url` | host `localhost:3020` | false |
  | `ftp://localhost:3020` | host `localhost:3020` | false |
  | `https://a.example` | xfh `a.example, b.example` | true (first entry) |
  | `https://proxy.example` | host `app.example`, extraHosts `["proxy.example"]` | true |

  Plus `withOriginCheck`: a forbidden call returns 403 with the exact JSON and never calls the handler; an allowed call returns the handler's response and forwards `ctx`.

### Lint rules

```js
const AUTH_SYNTAX = [ /* the two Story 1.5 selector objects, unchanged */ ];

const ROUTE_HANDLER_SYNTAX = [
  { selector: "ExportNamedDeclaration > FunctionDeclaration[id.name=/^(POST|PUT|PATCH|DELETE)$/]",
    message: "State-changing route handlers must be `export const POST = withOriginCheck(handler)` from @/lib/http/origin (NFR29)." },
  { selector: "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name=/^(POST|PUT|PATCH|DELETE)$/]:not([init.type='CallExpression'][init.callee.name='withOriginCheck'])",
    message: "Wrap state-changing route handlers with withOriginCheck() (NFR29)." },
  { selector: "ExportNamedDeclaration > ExportSpecifier[exported.name=/^(POST|PUT|PATCH|DELETE)$/]",
    message: "Export state-changing route handlers as `export const X = withOriginCheck(handler)` (NFR29)." },
];

// existing auth block becomes: "no-restricted-syntax": ["error", ...AUTH_SYNTAX]
{
  files: ["src/app/**/route.{ts,tsx}"],
  rules: { "no-restricted-syntax": ["error", ...AUTH_SYNTAX, ...ROUTE_HANDLER_SYNTAX] },
},
```

Put the route block **after** the auth block. Add `"@sentry/*"` to `CORE_BANNED.patterns[0].group` and a second pattern to the UI-layer block: `{ group: ["@sentry/*"], message: "Use @/lib/sentry (scrubbed reporting)." }`. `src/instrumentation*.ts` and `src/lib/sentry/**` are outside those blocks, so they may import Sentry.

### Lint tests

`tools/lint/route-handler-origin.test.ts`, in the style of `boundaries.test.ts` (`ESLint#lintText`, probe path `src/app/api/__probe__/route.ts`, 30 s timeout). Cases:
- `export async function POST() {}`, `export function DELETE() {}`, `export const PATCH = async () => new Response()`, `const h = withOriginCheck(x); export { h as PUT }` → `no-restricted-syntax`;
- `export const POST = withOriginCheck(async () => new Response())` and `export async function GET() {}` → clean;
- in the same route probe, `supabase.auth.getSession()` is still reported (AUTH_SYNTAX not lost);
- the same `export async function POST` in `src/features/__probe__.ts` is not reported (rule scoped to route files).

Extend the boundaries tests:
- `import * as Sentry from "@sentry/nextjs"` in `src/core/__probe__.ts`, `src/features/__probe__.ts` and `src/app/__probe__.tsx` → reported;
- the same import in `src/lib/sentry/__probe__.ts` and `src/instrumentation.ts` → clean;
- `@supabase/ssr` in `src/app/__probe__.tsx` is still reported (the merged block kept it).

### E2E assertions (`e2e/security-headers.spec.ts`, against `next dev` on 3020)

Helper `expectStaticHeaders(headers)`: exact values from the table above for all six headers, and no `x-powered-by`.

For each of `/` (anonymous), `/sign-in` (anonymous) and `/workspace` (after `signIn(page, ACTIVE)`; take the response of a fresh `page.goto("/workspace")`):
1. `const res = await page.goto(path)`; `res.status() === 200`; `expectStaticHeaders(res.headers())`.
2. `const csp = parseCsp(res.headers()["content-security-policy"])`:
   - `script-src` contains `'strict-dynamic'` and exactly one `'nonce-X'`, and does not contain `'unsafe-inline'`;
   - `worker-src` equals `['self', blob:]`;
   - `frame-ancestors` equals `['none']`; `object-src` equals `['none']`;
   - `connect-src` contains `new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin` and contains no `sentry.io` (no DSN in e2e).
   Import `parseCsp` from `../src/lib/security/csp`.
3. `const html = await res.text()`: every `<script…>` start tag (`/<script\b[^>]*>/g`) has `nonce="X"` equal to the header nonce, and there is at least one inline (no `src`) script. Use the raw HTML: browsers hide the `nonce` attribute in the DOM.
4. Collected `page.on("console")` messages of type `error` contain nothing matching `/Content Security Policy|Refused to (load|execute|apply)/`. Also wait for hydration on `/sign-in` (the password show/hide toggle changes the input type) to prove scripts ran under the CSP.

Plus:
5. Two `request.get("/sign-in")` calls → different nonces.
6. `request.get("/workspace", { maxRedirects: 0 })` (anonymous) → 307, with CSP and `expectStaticHeaders`.
7. The first `/_next/static/…` script `src` from the `/sign-in` HTML → `request.get(src)` has HSTS and `nosniff` (from `next.config.ts`).

Dev-only notes in the spec header: in dev `script-src` contains `'unsafe-eval'` by design. The spec does **not** assert its absence; `csp.test.ts` and the production proof (Task 13) do. If a CSP violation appears only in dev (for example from the dev overlay), report it and do not weaken the production policy.

### Project structure notes

New:
- `src/lib/security/{headers,csp,inline-script-hashes,route-policy}.ts` (+ tests);
- `src/lib/http/origin.ts` (+ test);
- `src/lib/sentry/{scrub,options,init,context,report,worker-errors}.ts` (+ tests);
- `src/lib/redact.ts` (+ test);
- `src/core/worker/error.ts` (+ test);
- `src/instrumentation.ts`, `src/instrumentation-client.ts`;
- `src/components/{route-error-screen,route-error-boundary}.tsx` (+ tests);
- `src/app/{error,global-error}.tsx`, `src/app/(auth)/error.tsx`, `src/app/(workspace)/error.tsx` (maybe `src/app/not-found.tsx`);
- `src/proxy.test.ts`, `src/lib/logger.test.ts`, `src/lib/result.test.ts`;
- `scripts/check-dynamic-routes.mjs` (+ test);
- `tools/config/next-config.test.ts`, `tools/lint/route-handler-origin.test.ts`;
- `e2e/security-headers.spec.ts`, `e2e/helpers.ts`;
- `docs/decisions/0003-csp-and-error-tracking.md`.

Modified: `src/proxy.ts`, `src/lib/logger.ts`, `src/lib/result.ts`, `src/lib/env.ts` (+ test), `src/lib/env.server.ts`, `src/app/layout.tsx`, `src/features/account/actions.ts`, `src/lib/auth/sign-in.ts`, `next.config.ts`, `eslint.config.mjs`, `tools/lint/boundaries.test.ts` and/or `auth-boundaries.test.ts`, `e2e/auth.spec.ts` (helpers import), `package.json` + `package-lock.json` (Sentry 11.4.0, one script), `.github/workflows/ci.yml` (`checks`: build + guard), `.env.example`, `README.md`, `_bmad-output/planning-artifacts/architecture.md` (Sentry version line).

Variance from architecture:
- architecture.md lists `src/lib/sentry.ts`. This story uses a `src/lib/sentry/` folder because there are six modules with separate tests.
- architecture.md puts "CSP/security headers" in `next.config.ts`. The static headers are there; the CSP lives in the proxy because the nonce is per request (architecture gap 1 already decided "nonce-based CSP in proxy.ts").
- `RouteErrorScreen` lives in `src/components/` (not `components/ui/`): it is an app screen, not a primitive.

Rules:
- English only; kebab-case files; `logger`, never `console`.
- Pure modules (`security/*`, `http/origin`, `redact`, `sentry/scrub`, `sentry/options`, `core/worker/error`) import no Next or React code. `scrub.ts` may use `import type` from `@sentry/nextjs`.
- `@sentry/nextjs` is imported only by `src/lib/sentry/{init,context,report}.ts`, `src/instrumentation*.ts` and `next.config.ts`.

### Previous story intelligence

- Story 1.5 debug log: `npm run build` route table was `○ /`, `ƒ /pending-activation`, `ƒ /sign-in`, `ƒ /workspace`, `ƒ Proxy (Middleware)`. After this story `/` must be `ƒ`.
- Story 1.5: `@supabase/ssr` silently overrode `cookieOptions.maxAge`. Lesson: library defaults can override your options, so verify behaviour on real responses (headers via curl, events via the scrub round-trip), not only by reading the config.
- Story 1.5: the first e2e failures came from locators, not from the app. Keep e2e assertions on raw headers and raw HTML where possible.
- Story 1.2/1.5 lint lesson: flat config replaces rule options per block. Repeat options and prove them with a lint test (applied twice in this story).
- Review cadence: every story gets a separate code review. Leave clear seams for review fixes (pure builders, one constant per policy).

### Git intelligence

Recent commits: `0405201` Record CI runs for Story 1.5, `950a8e3` Add sign in, sign out and pending activation (Story 1.5), `ffb53c0` Add Story 1.5, `a24457a` profiles.name cap. Conventions: tests co-located (`*.test.ts` beside the module), scripts are plain ESM with exported pure helpers and `*.test.mjs`, one commit per story implementation plus one for CI records.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.6: Security headers, error tracking and logging]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] AR16 (result shape), AR21 (observability)
- [Source: _bmad-output/planning-artifacts/prd.md#Non-Functional Requirements] NFR27–NFR29, NFR32, NFR33, NFR42 (browser matrix), NFR43, NFR46
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security] (Headers), [#Observability], [#Process Patterns] (Errors, Logging), [#Format Patterns] (Result, worker messages), [#Complete Project Directory Structure], [#Gap Analysis Results] item 1 (nonce vs static marketing)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Special States (A14)], [#Feedback Patterns] ("App failure … Your markups are saved locally · Reload"; codes only in Details), [#Button Hierarchy], [#Emotional Design Principles] ("Say what is safe"), UX-DR30
- [Source: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md] (nonce via request CSP header, dynamic rendering requirement, dev `unsafe-eval`, SRI limits)
- [Source: node_modules/next/dist/server/route-modules/app-page/parse-request-headers.js] + [server/app-render/get-script-nonce-from-header.js] (nonce read from request `content-security-policy`, `CSP_NONCE_SOURCE_REGEX`)
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md#Execution order] (config headers before proxy; server functions and matcher)
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md] (`error: unknown`, `retry`, global-error own document and styles)
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md], [instrumentation-client.md] (`register`, `onRequestError`, `onRouterTransitionStart`, 16 ms budget)
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md] (`allowedOrigins`; a missing Origin is allowed with a warning), [headers.md] (Strict-Transport-Security), [poweredByHeader.md]
- [Source: npm registry, 2026-10-18] `@sentry/nextjs` publish times (11.4.0 2026-10-02, 11.8.0 2026-10-15), peerDependencies; sentry-javascript CHANGELOG 11.5–11.8
- [Source: RFC 6797 §8.1] (UAs ignore STS over non-secure transport)
- [Source: _bmad-output/implementation-artifacts/1-5-sign-in-and-sign-out.md] (proxy, lint, e2e and CI patterns), [1-1-scaffold-the-app-with-the-pinned-stack.md] (env, logger, Sentry install-only)

### Founder decisions (2026-10-18)

Final. They override anything above that disagrees:
1. Static marketing hash CSP: wiring deferred to Story 13.1; `/` uses the nonce CSP and becomes dynamic now.
2. `@sentry/nextjs` pinned to 11.4.0 (two-week rule), not 11.8.0.
3. HSTS `max-age=63072000; includeSubDomains`, sent in every environment, no `preload`.
4. Sentry errors only (no tracing, no Replay) in M1.
5. **Changed from the draft:** `RouteErrorScreen` takes a `variant`. The `(auth)` group's `error.tsx` uses `variant="auth"`: heading "Something stopped working" and the "Reload" button only, **without** "Your markups are saved locally." (there are no markups on auth pages). The root `error.tsx`, `(workspace)/error.tsx` and `global-error.tsx` keep the full copy including "Your markups are saved locally.". Tests: assert the markups line is present for the workspace variant and absent for the auth variant.
6. `style-src-attr 'unsafe-inline'` is accepted (style attributes only; never in `script-src`).
7. `next build` is added to the CI `checks` job (timeout 20 minutes).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
