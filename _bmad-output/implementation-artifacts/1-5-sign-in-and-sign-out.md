# Story 1.5: Sign in and sign out

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user with an account created by the platform admin,
I want to sign in and sign out with email and password,
so that only I can reach my workspace.

## Acceptance Criteria

1. **Given** an active account, **when** I submit correct credentials on `/sign-in`, **then** I land on the workspace (`/workspace`), and `@supabase/ssr` sets the session cookie(s) with `HttpOnly`, `Secure` and `SameSite=Lax`.
2. Wrong credentials show one generic message, "Email or password is incorrect.". The message is the same for a wrong password and for an email that does not exist, so it never reveals whether the email exists (NFR16).
3. Sign-in attempts are rate-limited per client IP and per account (normalised email), with the limits in Dev Notes → Rate limiting. Over the limit, the form shows "Too many sign-in attempts. Try again in N minutes." and Supabase Auth is not called (NFR15).
4. `getAuthUser()` in `src/lib/auth` is the only way server code identifies the user:
   - it verifies the token server-side (Supabase `getUser()`, called only inside `src/lib/auth`);
   - it returns a user only when `profiles.status = 'active'`, and anything else (pending, deactivated, missing profile) counts as not signed in to the workspace;
   - it never reads `user_metadata` or `app_metadata`: status and admin flag come from `profiles` only (NFR11, NFR12).
   An ESLint rule bans `.getSession()`, `.getUser()` and `.getClaims()` calls outside `src/lib/auth/**`, and a Vitest test proves the rule is active (NFR11).
5. `src/proxy.ts` refreshes the session on every matched request and redirects unauthenticated requests on protected routes to `/sign-in?next=<path>`. After sign-in, the user is sent only to an allowlisted path: `//evil.com`, `https://evil.com`, `/\evil.com` and their encoded variants fall back to `/workspace` (NFR19).
6. A pending or deactivated user who signs in sees the PendingActivation screen at `/pending-activation`, styled with the Story 1.4 tokens. They cannot reach `/workspace` or any workspace data: the server redirects them back, and the new helper `app.fn_is_active_user()` exists for every future data policy (FR5).
7. Sign out, from a minimal user menu on the workspace page and from the PendingActivation screen, ends the session server-side and returns to `/sign-in`. Afterwards `/workspace` redirects to `/sign-in` again.
8. `supabase/config.toml`:
   - `jwt_expiry = 600` (10 minutes);
   - refresh-token rotation is on;
   - `[auth.sessions]` sets `inactivity_timeout = "168h"` (7 days) and `timebox = "720h"` (30 days);
   - `site_url` and `additional_redirect_urls` point at the dev port 3020.
   A Vitest test asserts these values (NFR17).
9. Every server action and route handler calls `getAuthUser()` (or `getAuthState()` for the sign-out and PendingActivation flows) itself. Every protected page calls the guard itself; `proxy.ts` and layouts are never the only gate (NFR13).
10. `npm run admin:create-user -- --email <e> --name <n>` creates a confirmed auth user with an `active` profile. It runs server-side only (a Node script outside `src/`, using the service/secret key) and is never part of the client bundle.
11. Tests pass locally and in CI:
    - Vitest: `getAuthUser`/`getAuthState`, the redirect sanitiser, the rate limiter wrapper, client-IP parsing, the auth config, the lint rules and the script helpers;
    - pgTAP: the new table and functions;
    - Playwright e2e on a real local Supabase: sign-in success with the cookie flags, the generic wrong-password message, pending and deactivated users reaching PendingActivation, sign-out, the unauthenticated redirect, open-redirect attempts and the rate-limited message.

## Tasks / Subtasks

- [x] **Task 1: Supabase auth config** (AC: 8, 10)
  - [x] Edit `supabase/config.toml` `[auth]` (Dev Notes → Session and auth config has exact keys and values): `site_url = "http://localhost:3020"`, `additional_redirect_urls = ["http://localhost:3020", "http://127.0.0.1:3020"]`, `jwt_expiry = 600`, keep `enable_refresh_token_rotation = true` and `refresh_token_reuse_interval = 10`, set `minimum_password_length = 12` (NFR14, needed for `admin:create-user`).
  - [x] Uncomment `[auth.sessions]` and set `timebox = "720h"` and `inactivity_timeout = "168h"`. Go duration syntax has no `d` unit, so use hours.
  - [x] Leave `enable_signup = true` (FR1, open by design: new profiles start `pending`), `[auth.email] enable_confirmations = false` (NFR18 is Epic 10), `[auth.rate_limit]` defaults, and the auth hook commented out. Do **not** add a custom access token hook.
  - [x] `tools/config/supabase-auth-config.test.ts`: reads `supabase/config.toml` with a small section-aware line parser (no new dependency). It asserts every value above, including the `[auth.sessions]` keys being uncommented, and that no `[auth.hook.custom_access_token]` section is enabled.
- [x] **Task 2: Migration `<ts>_auth_rate_limits_and_active_helper.sql`** (AC: 3, 6)
  - [x] Create the file directly as `supabase/migrations/20261018090000_auth_rate_limits_and_active_helper.sql` (any timestamp later than `20261017105639` works). **Do not run `npx supabase migration new`**: it reads stdin and hangs in the agent shell.
  - [x] Write it per Dev Notes → Migration design: `app.rate_limits` (RLS on, deny-all policy, no grants), `public.consume_rate_limit(...)` (SECURITY DEFINER, `search_path = ''`, EXECUTE for `service_role` only), and `app.fn_is_active_user()`.
  - [x] Seed: add `deactivated@plan-markup.test` (fixed id `00000000-0000-4000-8000-00000000000d`, status `deactivated`) to `supabase/seed.sql` in the same style as the other three accounts, and add it to the README seed table.
  - [x] Run `npm run db:reset` → `npm run db:schema` → `npm run db:types` → `npm run db:test`. Commit-ready `supabase/schema.sql` and `src/lib/db/types.gen.ts` must include the new objects.
- [x] **Task 3: pgTAP tests** (AC: 3, 6, 11)
  - [x] `supabase/tests/rate_limits.test.sql` (self-contained `begin; select plan(n); … finish(); rollback;`). Cases:
    - calls 1..N with `p_max_hits = N` return `allowed = true` and `retry_after_seconds = 0`, and call N+1 returns `allowed = false` with `0 < retry_after_seconds <= window`;
    - a different `key_hash` or `bucket` is counted separately;
    - after moving `window_started_at` back past the window (as `postgres`), the next call is allowed and `hits` restarts at 1;
    - an invalid `key_hash` (not 64 lowercase hex), an invalid bucket name, and out-of-range `p_max_hits`/`p_window_seconds` raise an error;
    - `has_function_privilege` is false for `anon` and `authenticated` and true for `service_role`;
    - `anon` and `authenticated` cannot select from `app.rate_limits` (permission denied, 42501);
    - RLS is enabled on `app.rate_limits`.
  - [x] `supabase/tests/active_user_helper.test.sql`: `app.fn_is_active_user()` is true for an active user, false for pending and deactivated users and for a user with no profile, and `anon` has no EXECUTE.
  - [x] Existing `rls_coverage.test.sql` and `npm run check:rls` must stay green with the new table (it has a policy).
- [x] **Task 4: Supabase clients and the result type** (AC: 1, 4)
  - [x] `src/lib/supabase/server.ts`: `createServerSupabase()` uses `createServerClient<Database>` from `@supabase/ssr` with `getPublicEnv()`, `await cookies()` (`getAll`/`setAll`; `setAll` wrapped in try/catch because Server Components cannot set cookies), and `cookieOptions` = `{ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 2592000 }`. It creates a new client per call and never shares one across requests.
  - [x] `src/lib/supabase/admin.ts`: `import "server-only"`. `createAdminSupabase()` uses `createClient<Database>` from `@supabase/supabase-js` with `SUPABASE_SERVICE_ROLE_KEY` from `getServerEnv()` and `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`. It throws a clear error if the key is missing; the key stays optional in the env schema so `next build` works without it.
  - [x] **No browser client** (`src/lib/supabase/client.ts`) in this story: HttpOnly cookies are not readable by browser JS (Dev Notes → HttpOnly and later browser access).
  - [x] `src/lib/result.ts`: `type Result<T> = { ok: true; data: T } | { ok: false; code: ResultCode; message: string }`. The codes are `NOT_FOUND | FORBIDDEN | CONFLICT | INVALID_INPUT | RATE_LIMITED | INTERNAL | UNAUTHENTICATED`. `UNAUTHENTICATED` is new, so add it to the AR16 code list in `architecture.md` → Format Patterns in the same change (pattern changes are edited there first).
  - [x] `src/lib/db/profiles.ts`: `getOwnProfile(client, userId): Promise<Profile | null>` selects `id, name, email, status, is_platform_admin` and maps them to camelCase `Profile { id, name, email, status, isPlatformAdmin }`. The architecture puts casing conversion only in `src/lib/db/*`. It throws on a query error.
- [x] **Task 5: `src/lib/auth`** (AC: 2, 3, 4, 5, 6, 9)
  - [x] `src/lib/auth/get-auth-user.ts` (`import "server-only"`):
    - `readAuthState(): Promise<AuthState>`, uncached, for use right after sign-in;
    - `getAuthState(): Promise<AuthState>` = `cache(readAuthState)` (React `cache`), so the page, layout and actions of one request share it;
    - `getAuthUser(): Promise<AuthUser | null>`, which returns `state.user` only for `kind === "active"`;
    - `requireActiveUser(nextPath?: string): Promise<AuthUser>` for pages: `anonymous` → `redirect("/sign-in?next=…")`, `inactive` → `redirect("/pending-activation")`.
    Types and logic are in Dev Notes → getAuthUser contract.
  - [x] `src/lib/auth/redirect.ts`: `sanitizeNextPath(raw: unknown): string`, plus `DEFAULT_AFTER_SIGN_IN = "/workspace"` and `ALLOWED_NEXT_PREFIXES = ["/workspace"]` (Dev Notes → Redirect allowlist). It is a pure module with no `server-only`, so the proxy and tests can import it.
  - [x] `src/lib/auth/client-ip.ts`: `getClientIp(headers: Headers): string` (pure): `x-real-ip`, else the first `x-forwarded-for` entry, trimmed, at most 64 chars, else `"unknown"`.
  - [x] `src/lib/auth/rate-limit-key.ts`: `rateLimitKeyHash(bucket, value)` = SHA-256 hex of `` `${bucket}:${value}` `` (`node:crypto`). Pure, so the e2e test can import it.
  - [x] `src/lib/auth/rate-limit.ts` (`server-only`): `checkSignInRateLimit({ ip, email }, consume = rpcConsume)`. It consumes the `sign_in_ip` and `sign_in_email` buckets, with the limits from `SIGN_IN_LIMITS`, via `createAdminSupabase().rpc("consume_rate_limit", …)`. It returns `{ allowed: true } | { allowed: false, retryAfterSeconds }` (the max of the blocked buckets). On an RPC error it **fails closed**: it throws, and the action maps that to `INTERNAL`. Only hashes reach the database, never the raw email or IP.
  - [x] `src/lib/auth/sign-in.ts` (`server-only`): `signInWithPassword(email, password)` and `signOutCurrentSession()` (`supabase.auth.signOut({ scope: "local" })`), using `createServerSupabase()`. They map Supabase errors to `"invalid" | "rate_limited" | "unavailable"` with no detail passed upward.
  - [x] `src/lib/auth/proxy-session.ts`: `updateSession(request: NextRequest)` per Dev Notes → Proxy. It returns `{ response, isAuthenticated }`.
  - [x] `src/lib/auth/index.ts` re-exports the server API (`getAuthState`, `getAuthUser`, `requireActiveUser`, types). The proxy imports `proxy-session.ts` and `redirect.ts` directly.
- [x] **Task 6: Proxy** (AC: 5, 9)
  - [x] `src/proxy.ts`: `export async function proxy(request: NextRequest)` plus `export const config = { matcher: [...] }` (Next 16 file convention, Node runtime by default; never `middleware.ts`, never a `runtime` export). Logic in Dev Notes → Proxy. Keep the structure easy to extend, because Story 1.6 adds the nonce CSP here.
- [x] **Task 7: Server actions** (AC: 1, 2, 3, 6, 7, 9)
  - [x] `src/features/account/actions.ts` (`"use server"`):
    - `signIn(prevState, formData)` follows Dev Notes → Sign-in action exactly: Zod parse → rate limit → Supabase sign-in → status check → `redirect`;
    - `signOut()` calls `getAuthState()`, then `signOutCurrentSession()` if signed in, then `redirect("/sign-in")`. It is the one action open to non-active users, which is why it uses `getAuthState()` rather than `getAuthUser()`.
  - [x] `src/features/account/sign-in-schema.ts`: `SignInSchema` (Zod v4) and `type SignInInput`.
- [x] **Task 8: Routes and UI** (AC: 1, 2, 3, 6, 7)
  - [x] `src/app/layout.tsx`: change `metadata.title` to `{ default: "Plan Markup", template: "%s · Plan Markup" }`. The home page title stays "Plan Markup", which the smoke test checks.
  - [x] `src/app/(auth)/layout.tsx`: a centred single-column shell inside `<div data-theme="daylight" className="flex flex-1 flex-col bg-surface-0 text-text">` (Dev Notes → UX). No auth logic here.
  - [x] `src/app/(auth)/sign-in/page.tsx` (server). It awaits `searchParams` (a Promise in Next 16) and calls `getAuthState()`:
    - active → `redirect(sanitizeNextPath(next))`;
    - inactive → `redirect("/pending-activation")`;
    - anonymous → renders `<SignInForm next={sanitizeNextPath(next)} />`.
    `metadata.title = "Sign in"`.
  - [x] `src/features/account/sign-in-form.tsx` (`"use client"`): `useActionState(signIn, initialState)`. It has Email and Password `TextField`s (password with the existing show/hide toggle), a hidden `next` input and a primary `Button` "Sign in". The form-level error goes in a `role="alert"` box with a `CircleX` icon and text. Field errors show inline. On a failed submit, focus moves to the first invalid field. While pending, the button reads "Signing in…" and ignores repeat submits. Copy is in Dev Notes → UX.
  - [x] `src/app/(auth)/pending-activation/page.tsx` (server): `getAuthState()`:
    - anonymous → `redirect("/sign-in")`;
    - active → `redirect("/workspace")`;
    - inactive → renders `PendingActivation` with copy for `pending` or `deactivated`, the signed-in email, and a Sign out form (`<form action={signOut}>` + secondary `Button type="submit"`).
    `metadata.title = "Waiting for approval"`.
  - [x] `src/features/account/pending-activation.tsx`: the presentational screen (heading, explanation, "What happens next" text, sign-out slot).
  - [x] `src/app/(workspace)/layout.tsx`: `await requireActiveUser()` (defence in depth only). Render `children`.
  - [x] `src/app/(workspace)/workspace/page.tsx`: `const user = await requireActiveUser("/workspace")` (**the page calls the guard itself**, because layouts do not re-run on client navigation). It shows a placeholder heading "Workspace", one sentence ("Your drawings will appear here."), and `<UserMenu user={user} />`. Story 1.8 replaces the body with the workspace shell.
  - [x] `src/features/account/user-menu.tsx`: the minimal user menu, a header strip showing the user's name (or email if the name is empty) and a `<form action={signOut}>` with a secondary `Button type="submit"` "Sign out". No Radix menu: the Menu components come in Story 1.7, and Story 1.8 moves Sign out into the File and account menus.
  - [x] `src/app/page.tsx`: keep it public and unchanged, except for a ghost "Sign in" link to `/sign-in` (a styled `next/link`, not a nested `<button>`).
- [x] **Task 9: Lint rules** (AC: 4)
  - [x] `eslint.config.mjs`: add the two blocks in Dev Notes → Lint rules (`no-restricted-syntax` against raw auth calls outside `src/lib/auth/**`, and `no-restricted-imports` banning `@supabase/*` in `src/app/**`, `src/components/**`, `src/features/**` and `src/proxy.ts`). Do not touch the existing core/oracle blocks.
  - [x] `tools/lint/auth-boundaries.test.ts`, in the same style as `tools/lint/boundaries.test.ts` (`ESLint#lintText` with probe file paths, 30 s timeout). Cases:
    - `supabase.auth.getSession()`, `supabase.auth.getUser()`, `supabase.auth.getClaims()`, `auth?.getUser()` and `auth["getSession"]()` in `src/features/__probe__.ts` are reported as `no-restricted-syntax`;
    - the same `getUser()` call in `src/lib/auth/__probe__.ts` passes;
    - `import { createServerClient } from "@supabase/ssr"` in `src/app/__probe__.tsx` and `src/proxy.ts` is reported as `no-restricted-imports`, and the same import in `src/lib/supabase/__probe__.ts` passes;
    - `supabase.auth.admin.getUserById()` is **not** flagged.
- [x] **Task 10: Admin script and env helper** (AC: 10, 11)
  - [x] `scripts/admin-create-user.mjs` per Dev Notes → admin:create-user. Add the npm script `"admin:create-user": "node --env-file-if-exists=.env.local scripts/admin-create-user.mjs"`. Export the pure helpers (`parseArgs`, `validateInput`, `isLocalUrl`, `generatePassword`) and test them in `scripts/admin-create-user.test.mjs`.
  - [x] `scripts/supabase-env.mjs`: runs `npx supabase status -o json` and maps it to `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Dev Notes → CI e2e). Modes:
    - `--github-env` appends `KEY=value` lines to the file named by `$GITHUB_ENV` and prints only the key names;
    - `--write .env.local` updates those three keys in `.env.local`, keeping every other line.
    Export and test the pure `mapStatusToEnv(json)` and `mergeEnvFile(text, vars)` (`scripts/supabase-env.test.mjs`). Add the npm script `"env:local": "node scripts/supabase-env.mjs --write .env.local"`.
- [x] **Task 11: Unit tests (Vitest)** (AC: 2, 3, 4, 5, 11)
  - [x] `src/lib/auth/get-auth-user.test.ts` (node env; `vi.mock("server-only", () => ({}))`, mock `@/lib/supabase/server` with a fake client whose `auth.getSession` **throws if called**). Cases:
    - no user → anonymous and `getAuthUser()` is null;
    - `getUser()` error → anonymous;
    - active profile → `AuthUser` built from the profile, while `user_metadata = { name: "Evil", is_platform_admin: true }` and `app_metadata.role = "admin"` are ignored;
    - pending → inactive/pending and `getAuthUser()` is null;
    - deactivated → inactive/deactivated;
    - no profile row → inactive/pending;
    - profile query error → throws (fail closed);
    - `requireActiveUser` calls the mocked `redirect` with `/sign-in?next=%2Fworkspace` for anonymous and `/pending-activation` for inactive.
  - [x] `src/lib/auth/redirect.test.ts`: the full table in Dev Notes → Redirect allowlist (every row is one `it.each` case).
  - [x] `src/lib/auth/client-ip.test.ts`: `x-real-ip` wins; first `x-forwarded-for` entry; whitespace trimmed; over-long values truncated; missing → `"unknown"`.
  - [x] `src/lib/auth/rate-limit.test.ts` (injected `consume`):
    - both buckets are called with 64-hex hashes, and neither hash contains the raw email or IP;
    - IP blocked → not allowed;
    - email blocked → not allowed;
    - both blocked → `retryAfterSeconds` is the max;
    - `consume` throws → `checkSignInRateLimit` rejects;
    - `rateLimitKeyHash` is deterministic and bucket-scoped.
  - [x] `src/features/account/actions.test.ts` (mock `@/lib/auth`, `@/lib/auth/rate-limit`, `@/lib/auth/sign-in`, `next/navigation`, `next/headers`):
    - an invalid email returns `INVALID_INPUT` with a field error and calls neither the rate limiter nor Supabase;
    - rate-limited returns `RATE_LIMITED` with "Try again in 15 minutes." and Supabase is not called;
    - `invalid` returns `UNAUTHENTICATED` with exactly "Email or password is incorrect.";
    - a Supabase 429 maps to `RATE_LIMITED`;
    - success + active → `redirect` to the sanitised `next`;
    - success + pending → `redirect("/pending-activation")`;
    - a limiter failure → `INTERNAL`, "Sign-in is unavailable right now. Try again shortly.".
  - [x] `src/features/account/sign-in-form.test.tsx` (jsdom): labels associated; the alert renders the server message with an icon; submitting an empty form shows inline errors and focuses the email field.
- [x] **Task 12: Playwright e2e and CI** (AC: 1, 2, 3, 5, 6, 7, 11)
  - [x] `e2e/global-setup.ts`: connect with `pg` to `process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres"` and run `delete from app.rate_limits`, so reruns are not throttled. If the connection fails, throw "Local Supabase is not running (npm run db:start)". Register it as `globalSetup` in `playwright.config.ts`.
  - [x] `e2e/auth.spec.ts`, using the seed accounts (Dev Notes → E2E cases). Each test uses a fresh browser context (Playwright default).
  - [x] `.github/workflows/ci.yml`: turn the `e2e` job into "Playwright e2e (local Supabase)" per Dev Notes → CI e2e. Keep the job name stable apart from the label, and keep the failure artifact upload. `db.yml` stays as it is.
  - [x] Update `.env.example` comments (keys come from `npm run env:local`) and the README: a "Sign-in" section with the seed table (including `deactivated@`), `npm run env:local`, `npm run admin:create-user`, the protected routes, and the e2e prerequisite (local stack running).
- [x] **Task 13: Verify** (AC: 1–11)
  - [x] With Docker running:
    - `npm run db:start` (or `db:reset`), then `npm run db:test`, `check:rls`, `check:schema`, `check:types`;
    - `npm run env:local`, then `npm run typecheck`, `lint`, `test`, `build`, `e2e`, `check:pinned`, `check:env-files`.
    Record the outputs in the Debug Log.
  - [x] Manual proof:
    - `npm run admin:create-user -- --email pilot@plan-markup.test --name "Pilot One"` → sign in with the printed password at http://localhost:3020/sign-in → land on `/workspace` → Sign out;
    - in DevTools → Application → Cookies, check `HttpOnly` ✓, `Secure` ✓, `SameSite Lax` on `sb-*-auth-token*`;
    - run `npx supabase status` and confirm that the Auth container picked up the session settings (`docker inspect` the `supabase_auth_plan-markup` container env for `GOTRUE_SESSIONS_TIMEBOX=720h` / `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=168h` / `GOTRUE_JWT_EXP=600`, or the equivalent names). Record what you saw.
  - [x] Negative proof, then revert and record: add `supabase.auth.getSession()` to a file in `src/features/` → `npm run lint` fails with the NFR11 message.
  - [x] Stop the dev server, free port 3020, and stop the stack (`npm run db:stop`) unless the orchestrator asks otherwise.
  - [x] **Do not commit or push.** The orchestrator commits, pushes and watches `ci.yml` and `db.yml`.

## Dev Notes

### Context

Done so far:
- Story 1.1: Next 16.4.2, React 19.3.1, TS 6.0.3, ESLint 9 boundary rules, Zod env (`src/lib/env.ts`, `src/lib/env.server.ts` with `server-only`), Vitest 5, Playwright 1.64.1 (`baseURL http://localhost:3020`, `webServer: npm run dev`), dev port 3020.
- Story 1.2: `ci.yml` (checks / e2e smoke / gitleaks), `check:pinned`, `check:env-files`, `tools/lint/boundaries.test.ts`.
- Story 1.3: local Supabase on 563xx, `profiles` (status `pending|active|deactivated`, `is_platform_admin`, name ≤100 chars) with RLS `profiles_select_self` / `profiles_update_self` (name only), `app.fn_is_platform_admin()`, the new-user trigger (`pending`), seed accounts, `db.yml`, and the drift and RLS-coverage checks. The Postgres image is pinned via `supabase/postgres-version` (ADR 0002); `npm run db:start` / `db:reset` apply it, so always use those scripts rather than raw `supabase start`.
- Story 1.4: tokens and themes (`data-theme="blueprint"` on `<html>`, Daylight and Contrast blocks), `Button` (`variant`, `size` sm 28 / md 40, default `type="button"`), `TextField` (label above, `error` with `CircleX`, `aria-invalid`/`aria-describedby`, password show/hide, `"use client"`), Vitest jsdom per file via `// @vitest-environment jsdom`, and `vitest.setup.ts`.

Pinned deps already present: `@supabase/supabase-js@2.118.0`, `@supabase/ssr@0.12.7`, `zod@4.6.7`, `server-only@0.0.1`, `pg@8.23.1`, `lucide-react@1.58.0`. **No new dependencies are needed.** If you add one anyway, pin it exactly (`npm i -E`), because `check:pinned` fails on ranges.

Out of scope (do not build):
- sign-up, password reset, email verification, Turnstile (Stories 10.1 and 10.2);
- the admin users UI, deactivation with admin sign-out, the audit log (Story 10.4);
- profile editing (Story 10.3);
- CSP and security headers (Story 1.6; leave a clear spot in `proxy.ts`);
- Radix menus (Story 1.7);
- the workspace shell (Story 1.8);
- a browser Supabase client;
- an auth hook or custom claims.

### Facts carried from Story 1.3 review and earlier projects (must follow)

- Sign-up is open by design (FR1): anyone can call the Auth API sign-up with the anon key, and the trigger gives them a `pending` profile. So `getAuthUser()` must treat **anything other than `status = 'active'`** (pending, deactivated, missing row) as not allowed into the workspace.
- `auth.site_url` was still the CLI default `http://127.0.0.1:3000`. This story sets it and `additional_redirect_urls` to port 3020.
- `profiles.name` is capped at 100 chars (`profiles_name_length`). The admin script must validate `--name` ≤ 100 after trimming.
- Next.js 16: the request interceptor is `src/proxy.ts`, exporting `proxy` (named, or default) and an optional `config.matcher`. The `middleware.ts` file convention is deprecated. Proxy runs on the Node.js runtime by default, and a `runtime` export throws [node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md].
- Never override the top-level JWT `role` claim (PostgREST uses it for `SET LOCAL role`). This story adds **no** auth hook. Status comes from `profiles` (server-controlled: authenticated users have UPDATE on `name` only), never from `user_metadata` (NFR12).
- `getUser()` returns no custom JWT claims, which is fine because we use none. The project wrapper `getAuthUser()` is the only allowed entry point. Raw `getSession()/getUser()/getClaims()` outside `src/lib/auth` is banned by lint, with a unit test in the `tools/lint/` style.
- Zod v4 `z.string().uuid()` rejects non-RFC UUIDs. The seed UUIDs are already v4-shaped (`…-4000-8000-…`); keep that shape for `…0d`. Use `z.uuid()` only where an id is parsed. Sign-in parses no ids.
- `npx supabase migration new` reads stdin and hangs in the agent shell. Create migration files directly with a timestamped name.
- PostgREST may return an empty result instead of an error for a wrong filter or a missing grant. Tests assert exact values (status, row presence), not just "no error".
- `npx supabase db query --local` runs a single statement only. Use pgTAP files or `pg` for multi-statement work.
- Windows: Docker Desktop must be running (`docker info`). Foreground `sleep` is blocked, so poll instead. Disk space was a problem in Story 1.3 (C: full); check `df -h /c` before image pulls.
- In `npx supabase status`, the CLI prints **publishable/secret** keys (`sb_publishable_…`, `sb_secret_…`). Our env names stay `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable) and `SUPABASE_SERVICE_ROLE_KEY` (secret).

### Session and auth config (NFR17) — exact keys for CLI 2.121.0

All keys below exist in the generated `supabase/config.toml` (the comments name them). Final `[auth]` values:

| Requirement | Key | Value |
|---|---|---|
| JWT (access token) expiry 10 min | `[auth] jwt_expiry` | `600` |
| Refresh-token rotation | `[auth] enable_refresh_token_rotation` | `true` (already) |
| Rotation grace for concurrent tabs | `[auth] refresh_token_reuse_interval` | `10` (already) |
| Idle timeout 7 days | `[auth.sessions] inactivity_timeout` | `"168h"` |
| Absolute lifetime 30 days | `[auth.sessions] timebox` | `"720h"` |
| Redirect base (emails, later stories) | `[auth] site_url` | `"http://localhost:3020"` |
| Redirect allowlist (Auth side) | `[auth] additional_redirect_urls` | `["http://localhost:3020", "http://127.0.0.1:3020"]` |
| Password minimum (NFR14) | `[auth] minimum_password_length` | `12` |

- `localhost` (not `127.0.0.1`) is the canonical dev origin because Playwright's `baseURL` is `http://localhost:3020`, and cookies are host-bound.
- The cookie `maxAge` (30 days = 2592000 s) matches `timebox`, so the browser drops the cookie when the server session ends anyway. The server-side session limits are the real control.
- The seed passwords (`password123`, 11 chars) still work: Auth checks the minimum length only on sign-up and password change, not on sign-in. Do not change the seed passwords.
- **Hosted note (not this story):** `config.toml` applies to the local stack only. The hosted project's settings (JWT expiry, sessions, rate limits, site URL) are applied at deploy (`supabase config push` or the dashboard) in the M1 release-readiness story. Supabase documents session timebox and inactivity timeout as a Pro-plan feature (see Questions in the final report).

### Rate limiting (NFR15): decision

**Approach: a Postgres-backed fixed-window limiter, called from the sign-in server action through the service client, with Supabase Auth's built-in per-IP limits kept as an outer backstop.**

Why:
- architecture.md → Authentication & Security says "Rate limiting: Supabase Auth built-ins + per-user limits … (Postgres-side counter)". This reuses the same pattern, and the op-write limits in Epic 6 will reuse the table and function;
- it works identically locally and in CI with no new service (no Redis or Upstash);
- Auth's built-in `sign_in_sign_ups` limit alone is not enough: sign-in runs in a Next.js server action, so in production Auth sees the **Vercel function's IP**, not the user's. It cannot limit per user IP or per account;
- an in-memory limiter would not hold across serverless instances.

Limits (constants in `src/lib/auth/rate-limit.ts`, `SIGN_IN_LIMITS`):

| Bucket | Key (hashed) | Max attempts | Window |
|---|---|---|---|
| `sign_in_ip` | client IP (`getClientIp`) | 30 | 900 s (15 min) |
| `sign_in_email` | trimmed, lower-cased email | 10 | 900 s (15 min) |

- Every attempt counts, successful or not, because the counter is consumed before Auth is called. The account limit is keyed by the submitted email, whether or not the account exists, so the limiter reveals nothing (NFR16).
- Blocked responses report the remaining window rounded up to whole minutes ("Try again in 15 minutes.", and "1 minute" in the singular).
- Supabase Auth `[auth.rate_limit] sign_in_sign_ups = 30` per 5 min per IP stays at the default. An Auth 429 (`over_request_rate_limit`) is mapped to the same `RATE_LIMITED` message.
- `getClientIp`: on Vercel, `x-real-ip` / `x-forwarded-for` are set by the platform and cannot be spoofed. Locally they may be absent (`"unknown"` is one shared bucket), which is fine for dev.
- The limiter fails closed: if the RPC errors (for example a missing service key), sign-in returns `INTERNAL` "Sign-in is unavailable right now. Try again shortly." and Auth is not called. Log the error with `logger.error` (no email, no IP, no key).

### Migration design

```sql
-- Story 1.5: rate limiter (NFR15) and active-user helper (FR5).

-- Fixed-window counters. Only hashes are stored (no emails or IPs).
create table app.rate_limits (
  bucket text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  hits integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, key_hash),
  constraint rate_limits_bucket_check check (bucket ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint rate_limits_key_hash_check check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint rate_limits_hits_check check (hits >= 0)
);
comment on table app.rate_limits is 'Fixed-window rate-limit counters. Written only by public.consume_rate_limit (service_role).';

alter table app.rate_limits enable row level security;
revoke all on app.rate_limits from public, anon, authenticated;
-- Deny-all marker policy: satisfies the RLS coverage rule; service_role bypasses RLS.
create policy rate_limits_all_none on app.rate_limits
  for all to anon, authenticated using (false) with check (false);
```

`public.consume_rate_limit(p_bucket text, p_key_hash text, p_max_hits integer, p_window_seconds integer) returns table (allowed boolean, retry_after_seconds integer)`:
- `language plpgsql volatile security definer set search_path = ''`. Fully qualify everything (`app.rate_limits`, `pg_catalog.now()`, `pg_catalog.make_interval(secs => …)`, `pg_catalog.random()`).
- It validates its inputs first: `p_max_hits between 1 and 10000`, `p_window_seconds between 1 and 86400`, and bucket/key regexes. On failure it raises `errcode = '22023'` (invalid_parameter_value) with a short message.
- One atomic upsert: `insert … values (p_bucket, p_key_hash, v_now, 1, v_now) on conflict (bucket, key_hash) do update set window_started_at = case when r.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now else r.window_started_at end, hits = case when … then 1 else r.hits + 1 end, updated_at = v_now returning hits, window_started_at`.
- It returns `allowed = hits <= p_max_hits`, and `retry_after_seconds = 0` when allowed, else `ceil(extract(epoch from window_started_at + window - v_now))::int` (at least 1).
- Housekeeping: `if pg_catalog.random() < 0.01 then delete from app.rate_limits where updated_at < v_now - interval '1 day'; end if;`.
- It lives in `public` because PostgREST exposes only `public` and `graphql_public` (`[api] schemas`), and the service client calls it via `.rpc()`. Supabase's default privileges grant EXECUTE on new public functions to `anon` and `authenticated`, so revoke explicitly: `revoke execute on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated; grant execute on function … to service_role;`.
- NFR22 says SECURITY DEFINER functions "verify the caller inside the function". This function has no user context: its caller check is the EXECUTE grant (service_role only), and pgTAP asserts that grant. Say so in a comment.

`app.fn_is_active_user()`: `returns boolean language sql stable security definer set search_path = ''`. Body: `select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')`. `revoke execute … from public, anon; grant execute … to authenticated;`. Comment: every future data policy (drawings, markups, tool sets, …) must AND this helper (or a helper built on it), so pending and deactivated users read no data (FR5). `profiles_select_self` stays as it is: pending users must be able to read their own status.

Seed addition (same columns as the existing rows): `('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', 'deactivated@plan-markup.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Dev Deactivated"}', now(), now(), '', '', '', '')`. Add its id to the identities `where` list, then `update public.profiles set status = 'deactivated' where id = '…0d';`. Update the header comment.

### getAuthUser contract

```ts
// src/lib/auth/get-auth-user.ts
export type AuthUser = { id: string; email: string; name: string; isPlatformAdmin: boolean };
export type AuthState =
  | { kind: "anonymous" }
  | { kind: "inactive"; userId: string; email: string; status: "pending" | "deactivated" }
  | { kind: "active"; user: AuthUser };
```

`getAuthState`:
1. `const supabase = await createServerSupabase()`.
2. `const { data, error } = await supabase.auth.getUser()`. This is the **only** `getUser()` call in app code besides `proxy-session.ts`. It verifies the JWT with the Auth server, which also rejects sessions that were signed out. An error or no user → `{ kind: "anonymous" }`.
3. `const profile = await getOwnProfile(supabase, data.user.id)` (user-scoped client under RLS `profiles_select_self`). A query error **throws** (fail closed; the route error boundary from Story 1.6 will catch it). Never fall back to "active".
4. `profile === null` → inactive/pending. `profile.status !== "active"` → inactive with that status. Otherwise active, with `user = { id, email: profile.email, name: profile.name, isPlatformAdmin: profile.isPlatformAdmin }`.
5. Never touch `data.user.user_metadata` or `app_metadata`.

`requireActiveUser(nextPath)`: `redirect` from `next/navigation` throws, so call it outside any try/catch. Build the sign-in URL with `` `/sign-in?next=${encodeURIComponent(sanitizeNextPath(nextPath))}` ``, or plain `/sign-in` when no path is given.

Pattern for every later server action or route handler (document it in a JSDoc on `getAuthUser`):
```ts
const user = await getAuthUser();
if (!user) return { ok: false, code: "UNAUTHENTICATED", message: "Sign in to continue." };
```

### Proxy

`src/lib/auth/proxy-session.ts` (the standard `@supabase/ssr` pattern; read `node_modules/@supabase/ssr/dist/main/createServerClient.d.ts` for the `setAll(cookiesToSet, headers)` signature in 0.12.7):

```ts
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } = getPublicEnv();
  const supabase = createServerClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS, // shared constant with server.ts: httpOnly, secure, lax, path "/", maxAge 2592000
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v)); // Cache-Control: no-store on refresh
      },
    },
  });
  // Do not run code between createServerClient and getUser(): it refreshes the session.
  const { data } = await supabase.auth.getUser();
  return { response, isAuthenticated: Boolean(data.user) };
}
```

`src/proxy.ts`:
- `PUBLIC_PATHS = ["/", "/sign-in"]` (exact match). Everything else matched by the proxy is protected (default-deny). The marketing site (Epic 13) will add its paths here or exclude them in the matcher.
- `matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"]`, a constant literal (Next analyses it statically).
- Flow: `const { response, isAuthenticated } = await updateSession(request)`.
  - If the path is protected and the user is not authenticated: on `GET`/`HEAD`, redirect to `/sign-in?next=<encodeURIComponent(pathname + search)>`; on other methods, redirect to `/sign-in`. **Copy the refreshed cookies from `response` onto the redirect response** (`response.cookies.getAll().forEach(c => redirect.cookies.set(c))`), or a refresh would be lost.
  - Otherwise return `response`.
- The proxy only checks "is there a verified user". It does **not** check `profiles.status`: the pages and actions do (AC 9). PendingActivation is protected by the proxy (anonymous → sign-in) and by its page.
- Server actions are POSTs to the page route, so they pass through the proxy. Still check auth inside every action (Next docs: "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone").

### Redirect allowlist (NFR19)

`sanitizeNextPath(raw)` returns a safe same-origin path, or `DEFAULT_AFTER_SIGN_IN` (`/workspace`):
1. Not a string, empty, or longer than 512 chars → default.
2. It must start with exactly one `/`. Reject if the 2nd char is `/` or `\`.
3. Reject any backslash, any ASCII control char or whitespace (`/[\u0000- \u007f\\]/`; browsers strip tabs and newlines, which turns `/\t/evil.com` into `//evil.com`).
4. Decode up to 3 times (`decodeURIComponent` in try/catch; a malformed encoding → default). After **each** decode, re-apply rules 2–3 and reject if the result contains `://` or starts with `//`.
5. `const url = new URL(raw, "http://plan-markup.invalid")`. It must have `url.origin === "http://plan-markup.invalid"`.
6. `url.pathname` must equal an allowlisted prefix or start with `prefix + "/"` (`ALLOWED_NEXT_PREFIXES = ["/workspace"]`). Later stories extend the list (`/drawings`, `/d`, `/settings`, `/admin`). `/sign-in` and `/pending-activation` are never allowed.
7. Return `url.pathname + url.search + url.hash`, the re-serialised value and **not** the raw input.

Test table (`redirect.test.ts`):

| Input | Expected |
|---|---|
| `undefined`, `null`, `42`, `""` | `/workspace` |
| `/workspace` | `/workspace` |
| `/workspace?tab=recent#x` | `/workspace?tab=recent#x` |
| `/workspace/sub/page` | `/workspace/sub/page` |
| `/workspacex` | `/workspace` (prefix must end at a segment) |
| `/sign-in`, `/pending-activation`, `/` | `/workspace` |
| `//evil.com`, `///evil.com`, `//evil.com/workspace` | `/workspace` |
| `https://evil.com`, `http://evil.com/workspace`, `javascript:alert(1)` | `/workspace` |
| `/\evil.com`, `\/evil.com`, `/workspace\..\evil` | `/workspace` |
| `%2F%2Fevil.com`, `/%2F%2Fevil.com`, `/%2fevil.com` | `/workspace` |
| `/%5Cevil.com`, `/%5cevil.com` | `/workspace` |
| `%252F%252Fevil.com` (double-encoded), `/%252F%252Fevil.com` | `/workspace` |
| `/\tevil.com`, `/\n/evil.com`, ` /workspace` (leading space) | `/workspace` |
| `/workspace/%2E%2E/%2E%2E/evil` | `/workspace` (normalises outside the prefix) |
| `/%E0%A4%A` (malformed) | `/workspace` |
| a 600-char `/workspace/aaa…` | `/workspace` |

The e2e test also proves the end-to-end path: `/sign-in?next=//evil.com` → after sign-in the page URL origin is `http://localhost:3020` and the path is `/workspace`.

### Sign-in action

```ts
"use server";
export type SignInState =
  | { status: "idle" }
  | { status: "error"; code: ResultCode; message: string; fieldErrors?: { email?: string; password?: string } };

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  // 1. Parse (SignInSchema). email: z.string().trim().toLowerCase().min(1, "Enter your email address.").max(254)
  //    .pipe(z.email({ error: "Enter a valid email address." })); password: z.string().min(1, "Enter your password.").max(1024)
  //    (no 12-char rule at sign-in); next: z.string().max(2048).optional().
  //    Failure → { status: "error", code: "INVALID_INPUT", message: "Check the highlighted fields.", fieldErrors }.
  // 2. const ip = getClientIp(await headers()); rate limit (try/catch → INTERNAL). Blocked → RATE_LIMITED.
  // 3. const r = await signInWithPassword(email, password); "invalid" → UNAUTHENTICATED "Email or password is incorrect.";
  //    "rate_limited" → RATE_LIMITED; "unavailable" → INTERNAL.
  // 4. const state = await getAuthState()  — NOTE: getAuthState is React-cache'd per request; the cached value from
  //    before sign-in would be "anonymous". Use an uncached variant (export `readAuthState()` uncached and build the
  //    cached `getAuthState` on it) here, right after sign-in.
  // 5. inactive → redirect("/pending-activation"); active → redirect(sanitizeNextPath(next)).
}
```

- Never log the email or password. Never put `error.message` from Supabase in the response.
- `redirect()` throws a control-flow error, so do not wrap it in try/catch (if you must, rethrow with `unstable_rethrow` from `next/navigation`).
- Right after `signInWithPassword`, the cookies set via `cookies().set` in the action belong to the same request. `readAuthState()` creates a new server client that reads the request cookie store, and Next's `cookies()` in a server action reflects cookies set earlier in that action. Verify this in the e2e test (pending user → `/pending-activation` directly). If it does not hold, use the `data.user.id` returned by `signInWithPassword` plus `getOwnProfile` on the same client instead, and record which way you went.

### Lint rules

```js
// Raw auth calls only inside src/lib/auth (NFR11).
{
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/lib/auth/**"],
  rules: {
    "no-restricted-syntax": ["error",
      { selector: "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(getSession|getUser|getClaims)$/]",
        message: "Use getAuthUser()/getAuthState() from @/lib/auth. Raw Supabase auth calls are banned outside src/lib/auth (NFR11)." },
      { selector: "CallExpression[callee.type='MemberExpression'][callee.property.value=/^(getSession|getUser|getClaims)$/]",
        message: "Use getAuthUser()/getAuthState() from @/lib/auth (NFR11)." },
    ],
  },
},
// UI layers and the proxy never import Supabase directly; they go through src/lib.
{
  files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}", "src/proxy.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: [{ group: ["@supabase/*"], message: "Use src/lib/supabase or src/lib/auth." }] }],
  },
},
```

- Optional chaining (`auth?.getUser()`) wraps the call in a `ChainExpression`, but the inner node is still a `CallExpression` with a `MemberExpression` callee, so the selector matches. The lint test proves it.
- `auth.admin.getUserById` has a different property name and is not matched. The tests may use admin APIs.
- These blocks do not overlap with the `src/core/**` `no-restricted-imports` blocks (different files), so the flat-config "no merge" problem from Story 1.2 does not arise. If a future file matches both, repeat the options as done for the oracle block.

### UX

- **Theme:** the `(auth)` group renders in **Daylight** through a wrapper `data-theme="daylight"`. The UX spec puts admin and marketing on Daylight, and auth forms follow the admin form pattern (label above, 14 px, 40 px controls); see the open question in the final report. The workspace stays Blueprint.
- **Layout:** centred card, `max-w-sm`, `bg-surface-1`, `border border-border`, `rounded` (2 px), `shadow-1` (hard offset), padding `p-8`, gap `gap-6`. Heading "Sign in to Plan Markup" (`text-ad-xl font-semibold`). Below the form: muted text "Accounts are created by the Plan Markup administrator during the pilot." No sign-up or forgot-password links yet (Epic 10).
- **Fields:** "Email" (`type="email"`, `autoComplete="username"`, `inputMode="email"`, `autoFocus`), "Password" (`type="password"`, `autoComplete="current-password"`). Validate on blur and on submit, never on each keystroke. Errors go inline under the field (TextField `error`). After a failed submit, focus the first invalid field.
- **Messages (exact copy):**
  - wrong credentials (and unknown email): "Email or password is incorrect.";
  - rate limited: "Too many sign-in attempts. Try again in N minutes." (singular "1 minute");
  - unavailable: "Sign-in is unavailable right now. Try again shortly.";
  - empty email: "Enter your email address."; bad email: "Enter a valid email address."; empty password: "Enter your password.".
  - Form-level messages go in a `role="alert"` box: danger border plus `CircleX` icon plus text. Colour is never used alone, and orange is never a status colour.
- **Button:** one primary "Sign in" (`size="md"`, full width), `type="submit"`. While pending, the label is "Signing in…" and `aria-busy="true"`.
- **PendingActivation** (UX-DR30), same card style:
  - pending: heading "Your account is waiting for approval". Body: "The Plan Markup administrator activates new accounts. You can't open drawings or markups until your account is active." Then "What happens next", "Once your account is activated, sign in again to open your workspace.";
  - deactivated: heading "Your account is not active". Body: "This account has been deactivated. Contact your Plan Markup administrator if you think this is a mistake.";
  - both: "Signed in as <email>", then a secondary "Sign out" button.
- **Workspace placeholder:** Blueprint. The `UserMenu` sits top-right (name or email in `text-ws-lg text-muted` plus a `size="sm"` secondary "Sign out"). Story 1.8 replaces it.
- Accessibility (NFR43): one `<main>` and one `<h1>` per page, labelled inputs, visible focus (token `focus-ring`), 40 px hit targets on auth forms, and an error alert announced by the `role="alert"`.

### HttpOnly and later browser access (read before Epic 6 and 11)

Default `@supabase/ssr` cookie options have `httpOnly: false` (`node_modules/@supabase/ssr/dist/main/utils/constants.js`), so the browser client can read the session. The AC requires HttpOnly, so this story sets `httpOnly: true` and builds **no** browser Supabase client. Consequence: client-side PostgREST reads and Realtime (architecture: "Reads: supabase-js from the client under RLS", Story 11.6) cannot get the token from the cookie. The later stories must choose a pattern (server actions or route handlers for data, or a short-lived token handoff from a server action to an in-memory browser client). This is flagged to the founder; do not solve it here.

### admin:create-user

`scripts/admin-create-user.mjs` (Node ESM, outside `src/`, so it can never be bundled; uses `process.stdout`/`stderr` like the other scripts):
- Usage: `npm run admin:create-user -- --email <email> [--name "<name>"] [--password-stdin] [--yes]`.
- Env (via `--env-file-if-exists=.env.local`): `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. If either is missing, exit 1 with "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (npm run env:local for the local stack)".
- Safety: if the URL host is not `localhost`/`127.0.0.1`, print the target host and require `--yes`. Without it, exit 1.
- Validation: email trimmed and lower-cased, simple shape check, ≤254. Name trimmed, ≤100 chars (`profiles_name_length`). Password from stdin (only with `--password-stdin`; never read stdin otherwise, because it hangs the agent shell) must be 12–128 chars. Otherwise generate one: `crypto.randomBytes(18).toString("base64url")` (24 chars).
- Steps:
  1. `createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })`;
  2. `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })` (the trigger creates a `pending` profile; `user_metadata.name` only seeds the display name, never authorization);
  3. `from("profiles").update({ status: "active" }).eq("id", user.id).select("id, status").single()`, and verify `status === "active"`;
  4. if step 3 fails, `auth.admin.deleteUser(user.id)` (roll back) and exit 1.
  An existing email → exit 1 with "A user with this email already exists." (admin tool, so enumeration is not a concern).
- Output: `Created active user <email> (<id>).` and, only for a generated password, `Temporary password: <pw>` once. Never log the service key.
- `is_platform_admin` is never set by this script (platform admin = SQL/seed only in M1).

### CI e2e

Decision: **the auth e2e tests run in `ci.yml`'s existing `e2e` job, which now starts the local Supabase stack.** They do not run in `db.yml`, because `db.yml` only runs on `supabase/**` and similar path changes, while sign-in can break from any app change. A separate third workflow would duplicate the setup. No secrets are needed: the local stack's keys are generated per run and printed by `supabase status`.

New `e2e` job steps (keep `timeout-minutes: 20`):
1. `actions/checkout@v7` → `actions/setup-node@v7` (`.nvmrc`, npm cache) → `npm ci`.
2. `supabase/setup-cli@v3` with `version: 2.121.0` → `node scripts/pin-postgres-image.mjs` → `supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor` (the same exclusion list that is proven in `db.yml`).
3. `node scripts/supabase-env.mjs --github-env`. It writes `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` into `$GITHUB_ENV`; the Playwright `webServer` (`npm run dev`) inherits them.
4. `npx playwright install --with-deps chromium` → `npm run e2e`.
5. Upload the report on failure (unchanged) → `supabase stop --no-backup` with `if: always()`.

`supabase-env.mjs` mapping: read `npx supabase status -o json`. Use the API URL for `NEXT_PUBLIC_SUPABASE_URL`, the publishable key (fall back to the anon key) for `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the secret key (fall back to the service-role key) for `SUPABASE_SERVICE_ROLE_KEY`. **Check the actual JSON key names** printed by CLI 2.121.0 on the running stack (the binary contains `ANON_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY`; confirm the publishable and URL key names) and keep a fixture of the real output (keys redacted) in the unit test. Do not use `supabase status -o env` piped straight into `$GITHUB_ENV`: it prints `NAME="value"` with quotes, and `$GITHUB_ENV` would keep the quotes.

### E2E cases (`e2e/auth.spec.ts`)

Seed accounts: `user@` (active), `pending@`, `deactivated@`, all with `password123`.
1. **Unauthenticated redirect:** `goto("/workspace")` → URL is `/sign-in?next=%2Fworkspace`; the heading "Sign in to Plan Markup" is visible.
2. **Sign-in success + cookie flags:** sign in as `user@` → URL `/workspace`, heading "Workspace" visible. `context.cookies()` has at least one cookie whose name matches `/^sb-.+-auth-token(\.\d+)?$/`, and every such cookie has `httpOnly: true`, `secure: true`, `sameSite: "Lax"`. Chromium accepts `Secure` cookies on `http://localhost`. If it does not on the CI runner, stop and report; do not weaken `secure`.
3. **Generic error:** a wrong password for `user@` and any password for `nobody@plan-markup.test` both show exactly "Email or password is incorrect." (compare the two alert texts for equality), and the URL stays `/sign-in`.
4. **Pending:** sign in as `pending@` → URL `/pending-activation` with "Your account is waiting for approval". Then `goto("/workspace")` → back at `/pending-activation`.
5. **Deactivated:** sign in as `deactivated@` → `/pending-activation` with "Your account is not active".
6. **Sign out:** sign in as `user@` → click "Sign out" → URL `/sign-in`. `goto("/workspace")` → redirected to `/sign-in?next=%2Fworkspace`, and no `sb-*-auth-token` cookie remains.
7. **Open redirect:** `goto("/sign-in?next=%2F%2Fevil.com")` and sign in as `user@` → `new URL(page.url())` has origin `http://localhost:3020` and pathname `/workspace`. Repeat with `next=https%3A%2F%2Fevil.com`.
8. **Rate limited:** use `pg` to upsert `app.rate_limits` with `bucket = 'sign_in_email'`, `key_hash = rateLimitKeyHash("sign_in_email", "ratelimit@plan-markup.test")`, `hits = 10`, `window_started_at = now()`. Submit that email → the alert reads "Too many sign-in attempts. Try again in 15 minutes." No Auth call happens (the email does not exist, so a call would have produced the generic message instead).
9. The existing `e2e/smoke.spec.ts` stays green (`/` is public).

### Project structure notes

New:
- `src/proxy.ts`;
- `src/lib/auth/{index,get-auth-user,redirect,client-ip,rate-limit,rate-limit-key,sign-in,proxy-session}.ts` (+ tests);
- `src/lib/supabase/{server,admin}.ts`, `src/lib/db/profiles.ts`, `src/lib/result.ts`;
- `src/features/account/{actions,sign-in-schema,sign-in-form,pending-activation,user-menu}.ts(x)` (+ tests);
- `src/app/(auth)/{layout,sign-in/page,pending-activation/page}.tsx`, `src/app/(workspace)/{layout,workspace/page}.tsx`;
- `supabase/migrations/20261018090000_auth_rate_limits_and_active_helper.sql`, `supabase/tests/{rate_limits,active_user_helper}.test.sql`;
- `scripts/{admin-create-user,supabase-env}.mjs` (+ tests);
- `tools/lint/auth-boundaries.test.ts`, `tools/config/supabase-auth-config.test.ts`;
- `e2e/{global-setup,auth.spec}.ts`.

Modified: `supabase/config.toml`, `supabase/seed.sql`, `supabase/schema.sql` and `src/lib/db/types.gen.ts` (generated), `eslint.config.mjs`, `package.json` (two scripts), `playwright.config.ts` (`globalSetup`), `.github/workflows/ci.yml` (e2e job), `src/app/layout.tsx` (title template), `src/app/page.tsx` (Sign in link), `.env.example`, `README.md`, `_bmad-output/planning-artifacts/architecture.md` (one line: the `UNAUTHENTICATED` code).

Variance from architecture:
- architecture.md lists `(auth)/login/`. The epics AC names `/sign-in`, so the route is `sign-in/`.
- `src/lib/auth/get-auth-user.ts` matches the architecture tree. The extra files sit beside it in `src/lib/auth/`.

Rules:
- English only; kebab-case files; `logger`, never `console`.
- `server-only` goes in every module that touches cookies, the service key or Supabase on the server (`get-auth-user`, `rate-limit`, `sign-in`, `supabase/server`, `supabase/admin`). Keep `redirect.ts`, `client-ip.ts` and `rate-limit-key.ts` pure.
- In Vitest, mock `server-only` per test file with `vi.mock("server-only", () => ({}))`: its default export throws outside the `react-server` condition.
- Next 16: `cookies()`, `headers()`, `params` and `searchParams` are async, so `await` them.

### Previous story intelligence

- Story 1.3 notes:
  - the CLI 2.121.0 mail container is `mailpit` (not `inbucket`) in `-x` lists;
  - anon has **no** SELECT grant on `profiles`, so anon reads fail with 42501 (stricter than 0 rows);
  - Supabase grants ALL on new public tables to anon/authenticated by default, and EXECUTE on new public functions too, so revoke explicitly;
  - the drift scripts normalise CRLF;
  - CI `db.yml` takes about 3 min.
- Story 1.4: the `TextField` error icon is `CircleX`. `Button` has `data-variant`. Daylight `--accent` is `#C24E00` (passes 4.5:1 with white). Use `text-warning-text` (not `text-warning`) for any warning text. The near-sharp guard (`tools/lint/near-sharp.test.ts`) fails on `rounded-xl`+, `shadow-sm/md/lg…` and `blur-*`; use `rounded`, `shadow-1`.
- Review cadence: each story gets a separate code review and usually one review-fix migration (1.3 got `profiles_name_length`). Write the SQL so that a later `create or replace` is easy.

### Git intelligence

Recent commits: `a24457a` Cap profiles.name at 100 characters (Story 1.3 review), `7c72c2a` design tokens and base UI (1.4), `eb7f6f1` local Supabase and RLS baseline (1.3). Conventions: each migration is committed with the regenerated `schema.sql` and `types.gen.ts`; tests are co-located; scripts are plain ESM with exported pure functions and `*.test.mjs` next to them.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5: Sign in and sign out]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] (AR4 auth pattern, AR16 result shape)
- [Source: _bmad-output/planning-artifacts/prd.md#Security — Authentication & Sessions] (NFR11–NFR19), FR2, FR5, NFR13, NFR22, NFR32, NFR43
- [Source: _bmad-output/planning-artifacts/architecture.md#Authentication & Security], [#Format Patterns], [#Process Patterns], [#Complete Project Directory Structure], [#Gap Analysis Results] (item 3: status check + 10 min JWT)
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Form Patterns], [#Feedback Patterns], [#Button Hierarchy], [#Dialogs and screens] (PendingActivation), [#Design Direction Decision] (Daylight for admin and marketing), UX-DR30, UX-DR32–34, UX-DR38
- [Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md] (exports, matcher, Node runtime, server functions note)
- [Source: node_modules/next/dist/docs/01-app/02-guides/authentication.md#Layouts and auth checks] (layouts do not re-run on navigation)
- [Source: node_modules/@supabase/ssr/dist/main/createServerClient.d.ts] and [utils/constants.js] (cookie defaults: `httpOnly: false`, maxAge 400 days)
- [Source: supabase/config.toml] `[auth]`, `[auth.sessions]`, `[auth.rate_limit]` comments
- [Source: _bmad-output/implementation-artifacts/1-3-local-supabase-with-profiles-and-rls-baseline.md], [1-4-design-tokens-and-themes.md]
- [Source: docs/decisions/0002-pin-supabase-postgres-image.md]

### Founder decisions (2026-10-18)

All open questions from story authoring were accepted with the recommended defaults:

1. Session cookies stay HttpOnly. The browser data-access pattern (server actions / route handlers or a short-lived token handoff) is decided before Epic 6.
2. Hosted Supabase stays on the free plan for M1. The 7-day idle and 30-day absolute session limits are set in config.toml and apply locally; on hosted they take effect when the project moves to Pro (M3 gate). Accept the gap for M1.
3. `/sign-in` and `/pending-activation` use the Daylight theme.
4. The workspace lives at `/workspace`; `/` stays public.
5. Rate limits: 30 attempts per 15 minutes per IP, 10 per 15 minutes per normalised email.

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (`claude-opus-5-5`), BMAD dev-story workflow, 2026-10-18.

### Implementation Plan

Followed the task order. Config and migration first (verified against the running Auth container and pgTAP), then `src/lib/{supabase,auth,db}`, proxy, actions, UI, lint rules, scripts, unit tests, e2e and CI. Status always comes from `profiles` through `getAuthState()`; the proxy only checks "is there a verified user". The rate limiter runs before Auth and fails closed.

### Debug Log References

All outputs below are real, from this session (Windows 11, Docker 29.5.2, CLI 2.121.0, Postgres image 17.6.1.155).

- `npm run db:start -- -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,supavisor`: started. `supabase status -o json` keys on CLI 2.121.0: `ANON_KEY, API_URL, DB_URL, GRAPHQL_URL, JWT_SECRET, PUBLISHABLE_KEY, REST_URL, S3_PROTOCOL_ACCESS_KEY_ID, S3_PROTOCOL_ACCESS_KEY_SECRET, S3_PROTOCOL_REGION, SECRET_KEY, SERVICE_ROLE_KEY, STORAGE_S3_URL` (fixture in `scripts/supabase-env.test.mjs`, values redacted).
- `npm run db:reset`: applied `20261017024840`, `20261017105639`, `20261018090000_auth_rate_limits_and_active_helper.sql`, seeded. `db:schema` and `db:types` regenerated `supabase/schema.sql` (+119 lines) and `src/lib/db/types.gen.ts` (`app.rate_limits`, `app.fn_is_active_user`, `public.consume_rate_limit`).
- Auth container env (`docker inspect supabase_auth_plan-markup`): `GOTRUE_JWT_EXP=600`, `GOTRUE_SESSIONS_TIMEBOX=720h0m0s`, `GOTRUE_SESSIONS_INACTIVITY_TIMEOUT=168h0m0s`, `GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true`, `GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL=10`, `GOTRUE_SITE_URL=http://localhost:3020`, `GOTRUE_URI_ALLOW_LIST=http://localhost:3020,http://127.0.0.1:3020`, `GOTRUE_PASSWORD_MIN_LENGTH=12`.
- Final run after a fresh `npm run db:reset`:
  - `npm run db:test`: `Files=5, Tests=57 … Result: PASS` (active_user_helper 6, rate_limits 19, plus the existing 3 files).
  - `npm run check:rls`: `RLS coverage OK: 2 table(s) in public/app, all with RLS and at least one policy.`
  - `npm run check:schema`: `supabase/schema.sql matches the local database. No drift.`
  - `npm run check:types`: `src/lib/db/types.gen.ts matches the local database. No drift.`
  - `npm run env:local`: `Updated NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in .env.local.`
  - `npm run typecheck`: exit 0 (`✓ Types generated successfully`, tsc clean).
  - `npm run lint`: exit 0, 0 problems.
  - `npm test`: `Test Files 25 passed (25)`, `Tests 262 passed (262)`.
  - `npm run check:pinned`: `All dependencies are pinned to exact versions.` (no new dependencies).
  - `npm run check:env-files`: `No forbidden .env files are tracked.`
  - `npm run build`: exit 0. Routes: `○ /`, `ƒ /pending-activation`, `ƒ /sign-in`, `ƒ /workspace`, `ƒ Proxy (Middleware)`. `grep` of `.next/static` for `sb_secret_`, `SUPABASE_SERVICE_ROLE_KEY`, `consume_rate_limit`: 0 hits.
  - `npm run e2e`: `12 passed (14.5s)` (11 in `auth.spec.ts`, 1 smoke).
- First e2e run: 10/12. Two failures were a locator problem, not the app: Next's `#__next-route-announcer__` is also `role="alert"`, so `getByRole("alert")` hit strict mode. Fixed with a `formAlert()` helper.
- First jsdom run of `sign-in-form.test.tsx` caught a real bug: `e.currentTarget` read inside a `setState` updater (null by then). Fixed by reading the value before calling the setter.
- Manual proof (dev server on 3020 against the local stack):
  - `npm run admin:create-user -- --email pilot@plan-markup.test --name "Pilot One"` → `Created active user pilot@plan-markup.test (e4f3fca2-…)` and `Temporary password: …`. Profile: `status active`, `is_platform_admin false`, `name "Pilot One"`. A rerun → `A user with this email already exists.`; a 101-char name → `--name must be at most 100 characters.`
  - Signed in as the pilot in Chromium (Playwright script, real browser): sign-in action response `Set-Cookie: sb-127-auth-token=base64-…; Path=/; Expires=…; Max-Age=2592000; Secure; HttpOnly; SameSite=lax`, `Cache-Control: no-store`. Landed on `/workspace`, user menu showed "Pilot One", `document.cookie` was `""`. Sign out → `/sign-in`.
  - curl with the pending user's session cookie: `GET /workspace` → `307 -> /pending-activation`; `GET /pending-activation` → `200`. Anonymous: `GET /workspace` → `307 -> /sign-in?next=%2Fworkspace`; `POST /workspace` → `307 -> /sign-in`.
  - Pending user's access token against PostgREST: `GET /rest/v1/profiles` → only their own row (`pending`); `POST /rest/v1/rpc/consume_rate_limit` → `42501 permission denied for function consume_rate_limit` (same for anon). No workspace data tables exist yet; `app.fn_is_active_user()` returns false for pending (pgTAP) and every future data policy must AND it.
- Negative lint proof: added `supabase.auth.getSession()` to `src/features/account/__negative_probe__.ts`, `npx eslint` on it → `error Use getAuthUser()/getAuthState() from @/lib/auth. Raw Supabase auth calls are banned outside src/lib/auth (NFR11) no-restricted-syntax`, exit 1. File removed.
- Cleanup: dev server stopped (an orphaned `next start-server.js` child, PID 21140, held 3020 and was stopped by PID), port 3020 free, `npm run db:stop` → `Stopped supabase local development setup.` (with backup, so the `pilot@` user stays in the local DB until the next `db:reset`).

### Completion Notes List

- AC 1: sign-in at `/sign-in` lands on `/workspace`; cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (e2e + raw header check).
- AC 2: one message for wrong password and unknown email (e2e compares the two alert texts).
- AC 3: Postgres fixed-window limiter (`app.rate_limits`, `public.consume_rate_limit`, service_role only), 30/15 min per IP and 10/15 min per normalised email, consumed before Auth; only SHA-256 hashes stored; fails closed with `INTERNAL`. Auth 429 maps to the same `RATE_LIMITED` message. e2e proves Auth is not called when over the limit.
- AC 4: `getAuthUser()` / `getAuthState()` / `readAuthState()` / `requireActiveUser()` in `src/lib/auth/get-auth-user.ts`; status and admin flag from `profiles` only, unit test proves `user_metadata`/`app_metadata` are ignored and `getSession` is never called. Lint rule plus `tools/lint/auth-boundaries.test.ts` (10 cases).
- AC 5: `src/proxy.ts` refreshes on every matched request, default-deny with `PUBLIC_PATHS = ["/", "/sign-in"]`, redirect carries refreshed cookies. `sanitizeNextPath` passes all 33 rows of the Dev Notes table; e2e covers `//evil.com`, `https://evil.com` and `/\evil.com`.
- AC 6: pending and deactivated users land on `/pending-activation` (Daylight, Story 1.4 tokens); `/workspace` sends them back; `app.fn_is_active_user()` exists with pgTAP coverage.
- AC 7: Sign out from the workspace user menu and from PendingActivation ends the session server-side (`signOut({ scope: "local" })`). e2e also replays the old cookies after sign-out and is still sent to `/sign-in`.
- AC 8: `config.toml` values asserted by `tools/config/supabase-auth-config.test.ts` and confirmed in the Auth container env.
- AC 9: pages call `requireActiveUser()` / `getAuthState()` themselves; layouts only add defence in depth; `signOut` uses `getAuthState()`. `signIn` is the unauthenticated entry point, so it does not start with `getAuthUser()`; it calls `readAuthState()` after Auth succeeds.
- AC 10: `npm run admin:create-user` works against the local stack (manual proof above); pure helpers unit-tested.
- AC 11: Vitest 262/262, pgTAP 57/57, Playwright 12/12; CI `e2e` job now starts the local stack.
- Dev Notes question resolved: `cookies()` inside the server action does see the cookies set earlier by `signInWithPassword`, so `readAuthState()` right after sign-in works. The pending e2e test proves it (a stale read would have returned `INTERNAL` and stayed on `/sign-in`). The fallback (`data.user.id` + `getOwnProfile`) was not needed.

**Deviations and additions (for review):**

1. `@supabase/ssr` 0.12.7 ignores `cookieOptions.maxAge`: it always writes its own 400-day default (`cookies.js`, `setCookieOptions = { ...DEFAULT, ...cookieOptions, maxAge: DEFAULT.maxAge }`). Added `src/lib/supabase/cookie-options.ts` with `AUTH_COOKIE_OPTIONS` (shared by `server.ts` and `proxy-session.ts`) and `withAuthCookieOptions()`, which every `setAll` applies: it forces `httpOnly/secure/sameSite/path` and caps `maxAge` at 2592000 (removals stay `maxAge: 0`). Unit-tested; e2e checks the cookie expiry is at most 30 days.
2. Sign-in form: the email input is controlled, because React 19 resets uncontrolled fields after a form action and the email would be cleared on every wrong password. The password is still cleared.
3. `getOwnProfile()` throws on an unknown `status` value instead of passing it through (fail closed).
4. A password longer than 1024 characters fails the schema with the field error "Email or password is incorrect." (no new copy, and it reveals nothing).
5. The form unit test mocks `useActionState` (the server action module cannot load in jsdom).
6. Extra e2e cases beyond the Dev Notes list: pending user signs out from PendingActivation; replayed cookies after sign-out stay rejected; a third open-redirect variant (`/\evil.com`); cookie lifetime cap.
7. The negative lint proof ran `npx eslint` on the probe file rather than the whole `npm run lint` (same config, faster).
8. The anonymous `GET /pending-activation` redirect carries `next=/pending-activation`, which `sanitizeNextPath` drops to `/workspace` (by design: it is not allowlisted).
9. `--password-stdin` was unit-tested only through `validateInput`; the stdin path itself was not run manually (it reads stdin, which hangs the agent shell).

**For the reviewer, security-sensitive spots:**

- `src/lib/auth/redirect.ts` (decode loop, rejects anything still encoded after 3 decodes, re-serialises from `URL`).
- `src/lib/supabase/cookie-options.ts` and the two `setAll` implementations (the library `maxAge` override above).
- `supabase/migrations/20261018090000_…sql`: `consume_rate_limit` is SECURITY DEFINER in `public` with EXECUTE for `service_role` only (pgTAP and a live PostgREST call both show 42501 for anon/authenticated).
- `src/features/account/actions.ts`: order is parse → limiter → Auth → `readAuthState()` → `redirect`; `redirect()` is outside try/catch; no email, password, IP or Supabase message is logged or returned.
- `src/proxy.ts`: default-deny; any new public page must be added to `PUBLIC_PATHS`.
- `.github/workflows/ci.yml` `e2e` job: first CI run of the stack inside that job (Chromium `Secure` cookies on `http://localhost` worked locally; if the runner disagrees, stop and report rather than weakening `secure`).

### File List

New:
- `src/proxy.ts`
- `src/lib/auth/index.ts`
- `src/lib/auth/get-auth-user.ts`
- `src/lib/auth/get-auth-user.test.ts`
- `src/lib/auth/redirect.ts`
- `src/lib/auth/redirect.test.ts`
- `src/lib/auth/client-ip.ts`
- `src/lib/auth/client-ip.test.ts`
- `src/lib/auth/rate-limit.ts`
- `src/lib/auth/rate-limit.test.ts`
- `src/lib/auth/rate-limit-key.ts`
- `src/lib/auth/sign-in.ts`
- `src/lib/auth/proxy-session.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/supabase/cookie-options.ts`
- `src/lib/supabase/cookie-options.test.ts`
- `src/lib/db/profiles.ts`
- `src/lib/result.ts`
- `src/features/account/actions.ts`
- `src/features/account/actions.test.ts`
- `src/features/account/sign-in-schema.ts`
- `src/features/account/sign-in-form.tsx`
- `src/features/account/sign-in-form.test.tsx`
- `src/features/account/pending-activation.tsx`
- `src/features/account/user-menu.tsx`
- `src/app/(auth)/layout.tsx`
- `src/app/(auth)/sign-in/page.tsx`
- `src/app/(auth)/pending-activation/page.tsx`
- `src/app/(workspace)/layout.tsx`
- `src/app/(workspace)/workspace/page.tsx`
- `supabase/migrations/20261018090000_auth_rate_limits_and_active_helper.sql`
- `supabase/tests/rate_limits.test.sql`
- `supabase/tests/active_user_helper.test.sql`
- `scripts/admin-create-user.mjs`
- `scripts/admin-create-user.test.mjs`
- `scripts/supabase-env.mjs`
- `scripts/supabase-env.test.mjs`
- `tools/lint/auth-boundaries.test.ts`
- `tools/config/supabase-auth-config.test.ts`
- `e2e/global-setup.ts`
- `e2e/auth.spec.ts`

Modified:
- `supabase/config.toml`
- `supabase/seed.sql`
- `supabase/schema.sql` (generated)
- `src/lib/db/types.gen.ts` (generated)
- `eslint.config.mjs`
- `package.json` (scripts `env:local`, `admin:create-user`)
- `playwright.config.ts` (`globalSetup`)
- `.github/workflows/ci.yml` (`e2e` job)
- `src/app/layout.tsx` (title template)
- `src/app/page.tsx` (Sign in link)
- `.env.example`
- `README.md`
- `_bmad-output/planning-artifacts/architecture.md` (`UNAUTHENTICATED` code)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/1-5-sign-in-and-sign-out.md` (this file)

Local only (git-ignored, not committed): `.env.local` (written by `npm run env:local`).

### Change Log

- 2026-10-18: Implemented Story 1.5 (sign in and sign out): Supabase auth config, rate-limit table and RPC, active-user helper, `src/lib/auth`, proxy, server actions, sign-in / PendingActivation / workspace placeholder screens, lint boundaries, admin and env scripts, Vitest, pgTAP and Playwright coverage, CI e2e on a local stack. Status → review.
