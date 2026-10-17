# Plan Markup

![CI](https://github.com/tmdrlfs-clem/plan-markup/actions/workflows/ci.yml/badge.svg) ![Database](https://github.com/tmdrlfs-clem/plan-markup/actions/workflows/db.yml/badge.svg)

Web-based PDF plan markup for fire protection work, with an NZS 4541 sprinkler placement engine. Built with Next.js 16, React 19, Supabase and PDF.js.

## Commands

- `npm run dev` - dev server on http://localhost:3020
- `npm run build` / `npm start` - production build and server (port 3020)
- `npm run typecheck` - TypeScript check
- `npm run lint` - ESLint (includes the `src/core` and 4541 oracle boundaries)
- `npm test` - Vitest unit tests
- `npm run e2e` - Playwright smoke tests (starts the dev server; run `npx playwright install chromium` once)

Copy `.env.example` to `.env.local` and fill it in before using Supabase features.

## Local database

Local Supabase runs in Docker (Docker Desktop must be running). It uses the **563xx** port block, so it can run next to other local Supabase projects (543xx and 553xx).

| Service | Port |
| --- | --- |
| API (Kong) | 56321 |
| Postgres | 56322 |
| Shadow database (`db diff`) | 56320 |
| Connection pooler (disabled by default) | 56329 |
| Studio | 56323 |
| Mail testing UI (Mailpit / inbucket) | 56324 |
| Analytics (Logflare) | 56327 |
| Edge runtime inspector | 56383 |
| SMTP / POP3 (commented out in config, if enabled) | 56325 / 56326 |

- `npm run db:start` - start the stack (applies migrations and `supabase/seed.sql`)
- `npm run db:stop` - stop the stack
- `npx supabase status` - print URLs and keys. Put the publishable key (`sb_publishable_...`) in `NEXT_PUBLIC_SUPABASE_ANON_KEY` and the secret key (`sb_secret_...`) in `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`
- `npm run db:reset` - recreate the local database from migrations and seed
- `npm run db:test` - pgTAP tests in `supabase/tests/`
- `npm run check:rls` / `check:schema` / `check:types` - the same checks CI runs (`.github/workflows/db.yml`)

After adding a migration (`npx supabase migration new <name>`):

1. `npm run db:reset`
2. `npm run db:schema` - updates `supabase/schema.sql`
3. `npm run db:types` - updates `src/lib/db/types.gen.ts`
4. `npm run db:test`

Commit the migration together with `schema.sql` and `types.gen.ts`. Every new table needs RLS and at least one policy, or CI fails.

Seed accounts (local and CI only, password `password123`):

| Email | Status |
| --- | --- |
| admin@plan-markup.test | active, platform admin |
| user@plan-markup.test | active |
| pending@plan-markup.test | pending |
| deactivated@plan-markup.test | deactivated |

## Sign-in

Email and password sign-in through Supabase Auth, with session cookies that are `HttpOnly`, `Secure` and `SameSite=Lax`.

1. `npm run db:start`, then `npm run env:local`. It writes `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase status` into `.env.local` and keeps your other lines. The service key is required: sign-in rate limiting uses it.
2. `npm run dev` and open http://localhost:3020/sign-in. Sign in with a seed account above. Pending and deactivated accounts see the PendingActivation screen.

Routes:

| Path | Access |
| --- | --- |
| `/`, `/sign-in` | public |
| `/workspace` | active users only (others are redirected) |
| `/pending-activation` | signed-in users whose account is pending or deactivated |
| anything else matched by `src/proxy.ts` | signed-in users (default-deny) |

Create a pilot user (confirmed, `active` profile, never a platform admin):

```sh
npm run admin:create-user -- --email pilot@example.com --name "Pilot One"
```

It prints a generated temporary password once. Pass `--password-stdin` to pipe in your own (12 to 128 characters). Against a non-local Supabase URL it refuses to run without `--yes`.

Sign-in attempts are rate-limited per client IP (30 per 15 minutes) and per email (10 per 15 minutes) in `app.rate_limits`.

The Playwright suite (`npm run e2e`) needs the local stack running (`npm run db:start` and `npm run env:local`). Its global setup clears the rate-limit counters.

## Documents

- Planning artifacts (PRD, architecture, UX, epics): `_bmad-output/planning-artifacts/`
- Project docs and decisions: `docs/`
