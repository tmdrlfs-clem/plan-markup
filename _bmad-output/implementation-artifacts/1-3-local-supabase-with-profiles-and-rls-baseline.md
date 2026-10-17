# Story 1.3: Local Supabase with profiles and RLS baseline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the founder,
I want a local Supabase stack with the first table under default-deny RLS and CI checks for it,
so that data access is secure from the first migration.

## Acceptance Criteria

1. **Given** Docker is running, **when** `supabase start` is run, **then** the stack starts on custom ports that do not clash with other local projects, and the ports are documented in `README.md`.
2. A migration creates `profiles` with these columns:
   - `id` = auth user id (FK to `auth.users` with on delete cascade);
   - `name`, `email`;
   - `status` text with a CHECK in `pending|active|deactivated`, default `pending`;
   - `is_platform_admin` boolean, default false, server-controlled;
   - `created_at`, `updated_at`.
   RLS is enabled with the policies `profiles_select_self` and `profiles_update_self`. The update policy can change `name` only.
3. A helper schema `app` exists with `app.fn_is_platform_admin()`. Every SECURITY DEFINER function sets `search_path` and revokes EXECUTE from `anon` and `public`.
4. A `db.yml` CI workflow:
   - starts Supabase and applies migrations;
   - fails if any table lacks RLS or policies;
   - fails on schema drift;
   - fails on `supabase gen types` drift against `src/lib/db/types.gen.ts`;
   - runs the RLS tests in `supabase/tests/`: a user cannot read another user's profile, and anon reads nothing (NFR20, NFR47).
5. `seed.sql` creates a dev platform admin and a dev active user for local use only.
6. The workflow is proven on GitHub: it ran on a real push to `main` and all its jobs finished green. The orchestrator records the run URL.

## Tasks / Subtasks

- [x] **Task 1: Init and ports** (AC: 1)
  - [x] `npx supabase init` (CLI 2.121.0 is already a pinned dev dependency, so use `npx supabase …` everywhere). `project_id = "plan-markup"`.
  - [x] Set ports in `supabase/config.toml` (the **563xx** block; Fire Impairment Manager uses 543xx and Online Booking uses 553xx, and all three can run at once): api 56321, db 56322, shadow_port 56320, db pooler 56329, studio 56323, inbucket 56324, analytics 56327, edge-runtime inspector 56383. Change any other port the generated file exposes to a 563xx value too, and list them all in the README.
  - [x] Keep the defaults otherwise. Story 1.5 changes the auth settings (JWT expiry 10 min, refresh rotation, sessions), so do not change auth settings here. Do not add the auth hook either.
  - [x] Update `.env.example`: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:56321`, with a comment that the anon/publishable key comes from `npx supabase status`. Add the npm scripts `db:start`, `db:stop`, `db:reset` (`supabase db reset`), `db:test` (`supabase test db`), `db:types` (generate `src/lib/db/types.gen.ts`), `db:schema` (dump `supabase/schema.sql`), `check:rls`, `check:schema`, `check:types`.
- [x] **Task 2: Migration `<ts>_profiles_and_app_helpers.sql`** (AC: 2, 3)
  - [x] Name the file `supabase/migrations/YYYYMMDDHHMMSS_profiles_and_app_helpers.sql` (create it with `npx supabase migration new profiles_and_app_helpers`). Write it per Dev Notes → Migration design.
- [x] **Task 3: Seed** (AC: 5)
  - [x] `supabase/seed.sql` (local only; `supabase db reset` runs it, and production never does):
    - `admin@plan-markup.test`: active, `is_platform_admin = true`;
    - `user@plan-markup.test`: active;
    - `pending@plan-markup.test`: pending (Story 1.5 needs it for the PendingActivation screen).
    All passwords are `password123`, inserted with `crypt(…, gen_salt('bf'))` into `auth.users` **and** `auth.identities` (provider `email`), so password sign-in works. Use fixed UUIDs with a valid version nibble (e.g. `00000000-0000-4000-8000-00000000000a`). The Zod v4 `uuid()` pitfall rejects version-0 ids.
  - [x] Profiles come from the trigger. The seed then updates `status` and `is_platform_admin` as the `postgres` role. Add a header comment saying this file is for local dev and CI only.
- [x] **Task 4: RLS tests (pgTAP)** (AC: 4)
  - [x] `supabase/tests/profiles_rls.test.sql`, run by `npx supabase test db`. Each file runs `begin; select plan(n); … select * from finish(); rollback;`. Create the test users inside the transaction (insert into `auth.users`; the trigger makes profiles) so the tests do not depend on the seed. Simulate users with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`, and anon with `set local role anon;`.
  - [x] Minimum cases:
    - user A sees exactly their own row and 0 rows of user B;
    - anon sees 0 rows and cannot insert;
    - user A can update their own `name`;
    - user A's update of their own `status` or `is_platform_admin` raises an error (column privilege);
    - user A's update of user B's name changes 0 rows;
    - authenticated users cannot insert or delete profiles;
    - `app.fn_is_platform_admin()` returns true for the admin and false for a normal user;
    - anon has no EXECUTE on `app.fn_is_platform_admin()` (`has_function_privilege`);
    - the new-user trigger creates a `pending` profile with the auth email.
  - [x] `supabase/tests/rls_coverage.test.sql`: a pgTAP assertion that every table in schemas `public` and `app` has `relrowsecurity = true` and at least one policy. It must keep working for future tables, so query `pg_class`/`pg_policies` rather than listing tables.
- [x] **Task 5: Drift and coverage scripts** (AC: 4)
  - [x] `scripts/check-rls.mjs`: runs the same coverage query outside pgTAP and prints offending tables by name (clear CI output). Connect with `pg` at `postgresql://postgres:postgres@127.0.0.1:56322/postgres` (add `pg@8.23.1` and `@types/pg` as exact dev deps), or shell out to `npx supabase db query --local`. Keep the pure "find offenders" function exported and unit-tested.
  - [x] `scripts/check-schema-drift.mjs`: dumps `npx supabase db dump --local --schema public,app` to a temp file. It compares that with the committed `supabase/schema.sql` after normalising (drop `SET …`/`set_config` lines and blank lines, trim line ends, normalise CRLF), and fails with the first differing lines. Port it from the Fire Impairment Manager pattern (see References), but in English, without emojis, using `logger`-free `process.stdout`/`stderr` (scripts are not under `src/`).
  - [x] `scripts/check-types-drift.mjs`: runs `npx supabase gen types typescript --local --schema public,app`, compares it with `src/lib/db/types.gen.ts` (normalise CRLF and trailing whitespace) and fails on drift. `scripts/generate-types.mjs` (or the `db:types` script) writes the file.
  - [x] Commit the generated `supabase/schema.sql` and `src/lib/db/types.gen.ts`. Add `src/lib/db/types.gen.ts` to ESLint ignores. It must still pass `tsc`.
- [x] **Task 6: `db.yml` workflow** (AC: 4, 6)
  - [x] `.github/workflows/db.yml`, triggered on push to `main` and pull requests, path filter `supabase/**`, `scripts/check-*.mjs`, `src/lib/db/**`, `.github/workflows/db.yml`, `package*.json`. Job "Database: migrations, RLS, drift" with `timeout-minutes: 20`:
    - steps: checkout@v7 → setup-node@v7 (`.nvmrc`, npm cache) → `npm ci` → `supabase/setup-cli@v3` with `version: 2.121.0`;
    - then `supabase start` (exclude unneeded services for speed: `-x studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor`; drop any service name this CLI rejects);
    - then `npm run check:rls` → `npm run db:test` → `npm run check:schema` → `npm run check:types`;
    - finally `supabase stop` (`if: always()`).
  - [x] `supabase start` applies migrations and seed. Do not call `db reset` again in CI.
  - [x] `permissions: contents: read`. No secrets.
- [x] **Task 7: README and docs** (AC: 1)
  - [x] README "Local database" section: the ports table, `npm run db:start`, how to get keys (`npx supabase status`), `db:reset`, the routine after adding a migration (`db:reset` → `db:schema` → `db:types` → `db:test`), and the seed accounts.
- [x] **Task 8: Verify locally** (AC: 1–5)
  - [x] With Docker running: `npm run db:start`, then `npm run db:reset`, `npm run db:test`, `npm run check:rls`, `npm run check:schema`, `npm run check:types`, plus the existing `typecheck`, `lint`, `test`, `check:pinned`. Record outputs.
  - [x] Negative proofs (revert afterwards, record outputs):
    - create a throwaway table without RLS in a scratch migration: `check:rls` and `rls_coverage` fail;
    - edit `supabase/schema.sql` by one line: `check:schema` fails;
    - edit one line of `types.gen.ts`: `check:types` fails.
    Delete the scratch migration, run `db:reset`, and confirm everything is green again.
  - [x] Stop the stack when finished (`npm run db:stop`) unless the orchestrator asks otherwise.
  - [x] **Do not commit or push.** The orchestrator commits, pushes and watches the `db.yml` run.

## Dev Notes

### Context

Done so far: Story 1.1 (Next 16.4.2, TypeScript 6.0.3, ESLint 9 boundaries, Zod env, Vitest, Playwright, port 3020) and Story 1.2 (`ci.yml`: checks / Playwright / gitleaks; `check:pinned`, `check:env-files`, lint-boundary tests; `.gitattributes` LF). Private GitHub repo: `tmdrlfs-clem/plan-markup`. Pinned deps already include `@supabase/supabase-js@2.118.0`, `@supabase/ssr@0.12.7` and `supabase@2.121.0` (CLI). Node 24 (`.nvmrc`).

Out of scope:
- auth UI, `getAuthUser()`, `proxy.ts`, JWT expiry and session settings (Story 1.5);
- `companies` and `company_members` (Epic 10), and every other table;
- Supabase clients in `src/lib/supabase/*` (Story 1.5);
- Storage buckets.

Create only `profiles` and the `app` helper.

### Migration design

```sql
-- schema for RLS helpers
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;   -- policies call app.fn_* as the caller

create table public.profiles (
  id uuid primary key,
  name text not null default '',
  email text not null,
  status text not null default 'pending',
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_profiles_user foreign key (id) references auth.users (id) on delete cascade,
  constraint profiles_status_check check (status in ('pending', 'active', 'deactivated'))
);
alter table public.profiles enable row level security;

-- column-level privileges: RLS cannot restrict columns
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
```

- `app.fn_is_platform_admin()`: `language sql stable security definer set search_path = ''`. Body: `select coalesce((select p.is_platform_admin from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'), false)`. Then `revoke execute on function app.fn_is_platform_admin() from public, anon; grant execute … to authenticated;`. It is SECURITY DEFINER so later policies can call it without RLS recursion. Fully qualify every name, because `search_path` is empty.
- `app.fn_handle_new_user()` trigger (`after insert on auth.users`): SECURITY DEFINER, `set search_path = ''`. It inserts `public.profiles(id, email, name)` from `new.id`, `new.email`, and `coalesce(new.raw_user_meta_data->>'name', '')`. Revoke EXECUTE from `public, anon, authenticated` (only the trigger calls it).
- `app.fn_set_updated_at()` trigger function (`before update on public.profiles`). It is not SECURITY DEFINER, but still `set search_path = ''`. Revoke EXECUTE from public, anon and authenticated.
- `(select auth.uid())` inside policies is the Supabase-recommended form: the planner evaluates it once per statement.
- Naming per architecture: plural snake tables, `fk_<table>_<ref>`, policies `<table>_<action>_<who>`, helpers `app.fn_*`, enums as text plus CHECK, timestamps `created_at`/`updated_at`. No `active` boolean, ever (an earlier project mixed soft-delete styles and kept getting bugs).
- There is no insert or delete policy for `authenticated`: profiles are created by the trigger and removed by the FK cascade. Platform-admin writes use the service client later (Epic 10).
- Never put custom claims into the top-level JWT `role` (pitfall: PostgREST uses it for `SET ROLE`). This story adds no claims.

### Pitfalls from earlier Supabase projects

- The CLI now issues **publishable/secret** keys (`sb_publishable_…`) in `supabase status`. Keep our env names (`NEXT_PUBLIC_SUPABASE_ANON_KEY` holds the publishable key, `SUPABASE_SERVICE_ROLE_KEY` the secret key). Note this in `.env.example`.
- `npx supabase db query --local` runs a single statement only.
- PostgREST may return an empty result instead of an error for wrong filters. Tests must assert exact row counts, not just "no error".
- SECURITY DEFINER RPCs must re-check ownership internally. There are none yet, but keep the pattern in mind.
- Windows: Docker Desktop must be running. On this machine it may still be starting, so wait for `docker info` to succeed before running `supabase start` (poll it; foreground `sleep` is blocked).
- Python on Windows writes CRLF line endings; `.gitattributes` normalises them to LF in the repo. Drift scripts must normalise CRLF before comparing.

### Project structure notes

- New: `supabase/{config.toml, migrations/, seed.sql, schema.sql, tests/}`, `src/lib/db/types.gen.ts`, `scripts/check-{rls,schema-drift,types-drift}.mjs` (+ tests for the pure parts), `.github/workflows/db.yml`. Remove `supabase/.gitkeep`.
- `supabase/.temp/` and `supabase/.branches/` are already git-ignored.
- English only. Kebab-case script names. The `check:*` scripts must work the same locally and in CI.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3: Local Supabase with profiles and RLS baseline]
- [Source: _bmad-output/planning-artifacts/epics.md#Additional Requirements] (AR2 custom ports, AR3 CI, AR5 RLS helpers, AR6 naming)
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] and [#Authentication & Security]
- [Source: _bmad-output/planning-artifacts/prd.md] (NFR20 RLS default-deny + CI check, NFR47 drift checks)
- Prior art (founder's own project, reuse the pattern, not the code verbatim): `C:\Users\cchoi\.local\bin\fire-impairment-manager\scripts\{check-schema-drift,check-types-drift,rls-smoke-test}.mjs`

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- 2026-10-17: `npx supabase --version` -> 2.121.0; `docker info` -> 29.5.2 at start.
- `npx supabase init --force` -> "Finished supabase init." (project_id plan-markup). Ports rewritten to 563xx; a grep of config.toml for 5xxxx/8083 shows only 56321, 56322, 56320, 56329, 56323, 56324, 56325 (comment), 56326 (comment), 56383, 56327.
- `npx supabase start` (first run, image pulls) FAILED: the C: drive filled to 100% during the image pulls. Log: "Error response from daemon: Docker Desktop is unable to start", retries on ghcr.io/supabase/postgres:17.11.0.004, storage-api, studio. `df -h /c` -> "C: 238G 238G 117M 100%". One `npm run typecheck` attempt failed with "npm error nospc". No other drive has free space (K:, Q: 0 GB).
- Checks that do not need Docker, run after the failure: `npx eslint .` exit 0; `npx next typegen && npx tsc --noEmit` exit 0; `npx vitest run` -> "Tests 43 passed (43)" (includes 13 new script tests); `check:pinned` -> "All dependencies are pinned to exact versions."; `check:env-files` -> "No forbidden .env files are tracked."
- NOT RUN (blocked by disk): db:start, db:reset, db:test, check:rls, check:schema, check:types, negative proofs, generation of supabase/schema.sql and src/lib/db/types.gen.ts.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- HALTED (2026-10-17): local verification is blocked because the C: drive is full (about 0.1 GB free) and Docker Desktop stopped. Freeing disk space is the founder's decision; nothing outside this project was deleted.
- Written but not yet executed against a database: migration, seed, both pgTAP files, and the check-rls / check-schema-drift / check-types-drift / generate-types scripts. Their pure functions are unit-tested and green.
- Deviation: CLI 2.121.0 renamed the mail container; the `-x` list uses `mailpit` instead of `inbucket`. The config section is still `[local_smtp]` on port 56324.
- Deviation: anon has no SELECT grant on profiles, so "anon reads nothing" is asserted as permission denied (42501), which is stricter than 0 rows.
- Note: `auth.site_url` stays at the CLI default (http://127.0.0.1:3000). Story 1.5 owns auth settings and should set it to port 3020.
- RESUMED (2026-10-17, orchestrator): Docker build cache pruned (3.6 GB). `supabase start` then failed with DbSetupError ("no schema has been selected to create in") on postgres 17.11.0.004, also with no migrations and with realtime excluded. Pinned postgres 17.6.1.155 via `supabase/postgres-version` + `scripts/pin-postgres-image.mjs` (ADR 0002); start, migration and seed then succeed.
- Verified: db:test "Files=2, Tests=29 ... Result: PASS"; check:rls OK (1 table); check:schema and check:types "No drift"; typecheck, lint, vitest 43/43, check:pinned all green.
- Negative proofs: scratch table without RLS -> check:rls lists public.scratch_no_rls (exit 1) and rls_coverage fails 2/2; schema.sql edited one line -> check:schema exit 1 at line 42; types.gen.ts edited one line -> check:types exit 1 at line 1. Reverted, db reset, all four green again.
- CI (eb7f6f1): Database run 38999208663 success (2m52s), CI run 38999208662 success.
- Previously remaining (now done): `npm run db:start`, `db:schema`, `db:types`, `db:test`, `check:rls`, `check:schema`, `check:types`, `typecheck` (with types.gen.ts), the negative proofs, then `db:stop`.

### File List

- .env.example (modified)
- .github/workflows/db.yml (new)
- README.md (modified)
- eslint.config.mjs (modified)
- package.json, package-lock.json (modified: db/check scripts, pg 8.23.1, @types/pg 8.23.1)
- scripts/check-rls.mjs, scripts/check-rls.test.mjs (new)
- scripts/check-schema-drift.mjs, scripts/check-schema-drift.test.mjs (new)
- scripts/check-types-drift.mjs, scripts/check-types-drift.test.mjs (new)
- scripts/generate-types.mjs (new)
- supabase/.gitkeep (deleted)
- supabase/.gitignore, supabase/config.toml (new, from supabase init)
- supabase/migrations/20261017024840_profiles_and_app_helpers.sql (new)
- supabase/seed.sql (new)
- supabase/tests/profiles_rls.test.sql, supabase/tests/rls_coverage.test.sql (new)
- supabase/schema.sql, src/lib/db/types.gen.ts (new, generated)
- supabase/postgres-version, scripts/pin-postgres-image.mjs (new, image pin)
- docs/decisions/0002-pin-supabase-postgres-image.md (new)
