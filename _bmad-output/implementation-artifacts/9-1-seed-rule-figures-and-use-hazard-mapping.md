# Story 9.1: Seed rule figures and use → hazard mapping

Status: done (the founder's baseline timing, AC 4, is carried as a gate on Story 9.4)

## Story

As a sprinkler designer,
I want the verified NZS 4541 figures and default use mapping built in,
so that every layout is checked against the same numbers.

## Acceptance Criteria

1. **Versioned JSON (A7, AR24):** `src/core/sprinkler/rules/nzs4541.v1.json` holds ruleset `nzs4541` v1 with `verified: true`:
   - ELH: Amax 21 m², Smax 4.6 m, Wmax 2.3 m.
   - OH1–3: Amax 12 m², Smax 4.0 m, Wmax 2.0 m.
   - All hazards: Smin 1.8 m, Wmin 0.05 m.

   The schema (`rules.ts`) allows extra named tables, each with its own `verified` flag (`wallReduced`, `designDensity`, both unverified). `use-hazard.v1.json` holds the draft mapping (`verified: false`).
2. **Migration:**
   - It creates `rule_figures` and `use_hazard_map` (`company_id` nullable).
   - RLS: active signed-in users read; only the platform admin writes; nothing for anon.
   - It seeds v1 and the draft mapping, with Office as the default use:
     - Office, Meeting, Corridor → ELH
     - Kitchen, Plant → OH1
     - Storage, Retail, Carpark → OH2
   - pgTAP `rule_figures_rls.test.sql` (14).
3. **Seed = JSON:** `npm run check:rules` (`scripts/check-rule-seed.mjs`) fails when the DB seed and the JSON disagree. It runs in CI's Database job.
4. **Baseline (A16):** `docs/spikes/m2-baseline.md` is ready for the founder's manual timing on the 3 baseline drawings. **Open (founder):** record the times before the engine (9.4–9.7) is run on those drawings.

## Tasks / Subtasks

- [x] Rules: `nzs4541.v1.json`, `use-hazard.v1.json`, `rules.ts` (Zod schemas: Smin < Smax, Wmin < Wmax, strict fields, named tables; `coverageRadius`, `rowSpacingLimit`, `hazardOf`), with tests (4).
- [x] Migration `20261111090000_rule_figures.sql`:
  - unique use per company (case-insensitive) and one default per company;
  - `updated_at` trigger;
  - RLS, grants and the seed.
- [x] `check:rules` script with tests (2), wired into `db.yml` (also on changes to the rules folder).
- [x] `types.gen.ts`, `schema.sql` regenerated.
- [x] `docs/spikes/m2-baseline.md` template.
- [ ] Founder: baseline times (before 9.4).

## Dev Notes

- `companies` does not exist yet, so `use_hazard_map.company_id` has no foreign key. It is added with the companies table, and company rows (FR72) arrive in M3.
- Admin editing and its audit log (NFR34) come with the admin console (M3). Until then the platform admin writes only through SQL.
- `check:rules` compares a freshly migrated DB. In production the admin may change the rows later, and that is expected.

## Dev Agent Record

### File List

- src/core/sprinkler/rules/nzs4541.v1.json, use-hazard.v1.json, rules.ts, rules.test.ts (new)
- supabase/migrations/20261111090000_rule_figures.sql (new), supabase/tests/rule_figures_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- scripts/check-rule-seed.mjs, check-rule-seed.test.mjs (new); package.json; .github/workflows/db.yml
- docs/spikes/m2-baseline.md (new)
