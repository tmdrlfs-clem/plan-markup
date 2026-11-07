# M1 security review (Story 8.5, NFR36)

Date: 2026-11-08 · Scope: the M1 workspace at the Story 8.5 commit (Epics 1–8),
the release pipeline and the production configuration it needs.
Result: **no open High findings.**

## What was checked

| Area | Check | Result |
|---|---|---|
| Database access | Every table in `public` and `app` has RLS and a policy (`check:rls`, `rls_coverage.test.sql`); pgTAP RLS tests per table (202 assertions) | Pass |
| SECURITY DEFINER | Each function checks its caller (`auth.uid()`, `app.fn_is_active_user()`, ownership via `fn_owns_drawing` / `fn_effective_access`), uses `search_path = ''`, and has EXECUTE revoked from `public` / `anon` (`consume_rate_limit`: service_role only) | Pass |
| Anonymous access | No `grant … to anon` on any table; storage buckets `signatures` and `tool-assets` are private, owner-folder policies only | Pass |
| Server actions | Every exported action calls `getAuthUser()` before work (sign-in / sign-out excepted by design), validates input with strict Zod schemas, and returns fixed safe messages (no error text, SQL or stack) | Pass |
| Rate limits | Sign-in (IP + e-mail), markup ops (600/min), activity events (120/min), all through `consume_rate_limit` | Pass |
| Redirects | `next` is sanitised (`sanitizeNextPath`, every decoded layer) on the sign-in page and in the action | Pass |
| XSS sinks | No `dangerouslySetInnerHTML`, `innerHTML =`, `eval` or `new Function` in `src` | Pass |
| CSP / headers | Nonce CSP per request, `object-src 'none'`, static headers (`security-headers.spec.ts`) | Pass (see L1) |
| Secrets | Only `NEXT_PUBLIC_*` reach the browser; the service-role key is read only in `env.server.ts` / `lib/supabase/admin.ts`; no tracked `.env` files (`check:env-files`) | Pass |
| Drawing content | PDFs never leave the browser (hash, filename and page geometry only, NFR26); activity events have no free-text column (Story 8.4) | Pass |
| Dependencies | `npm audit --omit=dev`: 0 high / 0 critical, 5 moderate | Pass (see L2) |
| Health endpoint | `/api/health` is public, `no-store`, and returns only up/down states | Pass |
| Release pipeline | Deploy jobs run only after CI succeeds on `main`, in the `production` environment, with pinned CLI versions | Pass (see M1) |

## Findings

- **M1 (Medium, config)**: protect the GitHub `production` environment with a required reviewer and limit it to `main`, so a compromised workflow change cannot push migrations unreviewed. Action: set when the environment is created (docs/release.md step 4).
- **L1 (Low)**: `frame-src 'self' blob:` (Story 8.3) lets the app frame blob URLs it creates itself for printing. Blob URLs are origin-bound; no third-party framing is allowed. Accepted.
- **L2 (Low)**: 5 moderate advisories in `glob` / `minimatch` (build-time file matching, ReDoS on attacker-controlled patterns, which the app never passes). Track; update when a non-breaking fix is released.
- **L3 (Low, ops)**: the production Supabase project needs Auth settings matching the app: sign-ups disabled (accounts are created by the admin; a self-made account would stay pending and see nothing through RLS anyway) and the site URL set to the production domain (docs/release.md step 2).

## Not covered here

- Penetration testing by a third party (post-pilot).
- Sharing and reviewer access (Epic 10, M2) — reviewed with that epic.
