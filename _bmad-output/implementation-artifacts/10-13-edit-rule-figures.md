# Story 10.13: Edit rule figures

Status: done (the founder kept D1–D10, 2026-11-17)

## Story

As the platform admin,
I want to maintain the default rule figures and mapping,
so that corrections to the standard reach everyone safely.

## Acceptance Criteria

1. Given admin → Rule figures, when I edit a figure, then a new ruleset version is created (old versions stay for existing layouts), marked verified only when I confirm, and audit-logged (FR79 admin editing, A7).
2. Layouts show which version they were placed with.

## Tasks / Subtasks

- [x] Migration `20261126090000_rule_figures_admin.sql`:
  - `rule_figures` gains `id` (the target of its audit rows), `created_by`, `verified_at`, `verified_by`.
  - `public.admin_create_rule_figures(actor, ruleset, hazards, source)`: adds the next version as a draft (verified false), with the extra tables of the newest version carried over; the same figures again write nothing. `public.admin_verify_rule_figures(actor, ruleset, version)`: confirms the newest version only (PT409 for an older draft).
  - `public.admin_set_default_use_hazard_map(actor, uses)` replaces the platform default mapping as a whole (the next version, a draft again); `public.admin_verify_default_use_hazard_map(actor, version)` marks the mapping in place as verified (PT409 when it has changed since the admin looked).
  - All four: service_role only, check that the actor is an active platform admin, write `audit_log` in the same transaction (`rules.figures_created`, `rules.figures_verified`, `rules.use_hazard_map_changed`, `rules.use_hazard_map_verified`; target types `rule_figures`, `use_hazard_map`).
  - Nobody writes `rule_figures` or `use_hazard_map` directly any more: the platform admin's write policies and the table write grants are gone.
- [x] The app uses the rule figures in the database (until now it used the built-in JSON only): `getRuleSetInUse` returns the newest verified version; `rulesStore` holds it for the session; Place heads, the live check, the coverage overlay and the zone's figures all read it. The built-in v1 stands in until it is read, or when it cannot be.
- [x] A head the engine places carries the version it was placed with (`head.rules = { id, version }` in the head markup). The selected zone's figures say "Heads placed with NZS 4541 vN." and, when that is no longer the version in use, that the check uses the figures in use and that Place heads lays the zone out with them. `zone_layouts` goes on recording the version of every run.
- [x] admin → Rule figures (`/admin/rules`, in the Admin nav; `src/features/admin/rules-*.tsx`, `rule-figures-form.tsx`, `confirm-version.tsx`):
  - Placement figures: the version in use; the draft, when there is one, with what changed and Confirm vN (asks first); the figures as an editable table (5 figures × 4 hazard classes) with the source of the change; Save as a new version.
  - Versions: each version with its status (In use, Draft, Earlier, Draft replaced), source, changes, dates.
  - Default use → hazard class: the same table as Company → 4541 settings (`UseMapForm`, now given its save action), Save mapping, and Confirm mapping vN while it is a draft.
- [x] Tests:
  - pgTAP `rule_figures_admin.test.sql` (41): privileges; every refusal writes and records nothing; a draft, the same figures again, a second draft, confirming (only the newest, once), v1 untouched; the mapping replaced, confirmed, both recorded. `rule_figures_rls.test.sql` and `company_use_hazard_map.test.sql`: direct writes are refused for everyone.
  - Unit: `rules.test.ts` (the version in use, the save schema), `heads.test.ts` (the version on a head, `placedWith`), `rules-store.test.ts`, `sprinkler/actions.test.ts`, `place-run.test.ts` (a re-run after a new version; undo brings back the earlier heads with their version), `sprinkler-panel.test.tsx`, `admin/rules-actions.test.ts`, `admin/rules-screen.test.tsx`.
  - e2e `admin-rules.spec.ts`: the admin is refused bad figures at the cell, saves an edit as the next version (a draft) and sees what changed; the same figures again add nothing; another user gets 404 on the page and their new zone still shows the version in use and its figures; the audit row; axe clean.

## Dev Notes

- **D1, a draft is used by nobody.** Saving figures never changes what people place and check with. The newest version goes into use only when the admin confirms it. This is stricter than the criterion's wording ("marked verified only when I confirm"), which would also allow an unverified version to be used with a warning: for figures that decide compliance, an unchecked edit should not reach a drawing at all.
- **D2, only the newest version can be confirmed.** A draft replaced by a later edit stays a draft for good ("Draft, replaced" in the list). A wrong confirmed version is corrected by a new version, never by going back: there is no un-confirm and no delete.
- **D3, the app now reads the figures from the database.** Before this story the database rows were a seed that nothing read. The built-in v1 JSON remains the fallback (offline, a failed read). A session reads the figures once: a user sees a newly confirmed version after reloading the workspace (as with the mapping, 10.12 D10).
- **D4, the version is kept on each placed head,** not read back from `zone_layouts`. It stays right through undo, redo and working offline. Heads placed before this story carry no version and are shown as v1, the only version there was. Heads added or moved by hand are not the engine's and do not count.
- **D5, the check always uses the figures in use.** A zone placed with v1 is checked against v2 once v2 is in use, so a stricter figure shows as rule breaks on existing layouts; the panel says which version the heads were placed with and that the check uses the newer one. Nothing is re-placed by itself.
- **D6, the figures edited are the five placement figures of the four hazard classes.** The extra tables (`wallReduced`, `designDensity`: unverified, not used in placement) are carried from version to version unchanged and are not editable here.
- **D7, limits:** each figure a number above 0 (areas up to 100 m², distances up to 50 m), each minimum below its maximum; a source of 1 to 500 characters is required. The database checks the same.
- **D8, the default mapping differs from the figures in one way:** a saved mapping is in use at once, shown as a draft until confirmed (as the seeded v1 has been since Story 9.1). It only proposes a class for a new zone, the drafter sees and can change it, and the table holds one version at a time. Companies with a mapping of their own are not touched.
- **D9, all writes go through the audited functions.** The platform admin could write both tables directly through RLS since Story 9.1; that is removed, so no change can miss the audit log.
- **D10, the e2e does not confirm a version.** The specs run in parallel on one database and several assert "NZS 4541 v1" and the default mapping; a confirmed version cannot be taken back. Confirming is covered by pgTAP and unit tests. The draft the spec adds is deleted at its end.
- Also fixed: error text on the admin page background (Daylight) did not meet WCAG AA contrast; the form-level errors of this screen and of Company → 4541 settings now sit on a light box.
- `check:rules` still compares a freshly migrated database with the JSON (v1 and the seeded mapping), unchanged.

## Dev Agent Record

### File List

- supabase/migrations/20261126090000_rule_figures_admin.sql (new); supabase/tests/rule_figures_admin.test.sql (new), rule_figures_rls.test.sql, company_use_hazard_map.test.sql; supabase/schema.sql; src/lib/db/types.gen.ts
- src/core/sprinkler/rules/rules.ts, rules.test.ts; src/core/sprinkler/heads.ts, heads.test.ts; src/core/sprinkler/use-map.ts; src/core/schema/markup.ts
- src/lib/db/rules.ts
- src/features/sprinkler/rules-store.ts (new), rules-store.test.ts (new), actions.ts, actions.test.ts, live-check.ts, place-run.ts, place-run.test.ts, sprinkler-panel.tsx, sprinkler-panel.test.tsx
- src/features/editor/coverage-overlay.ts, index.ts
- src/features/admin/rules-actions.ts, rules-actions.test.ts, rules-screen.tsx, rules-screen.test.tsx, rule-figures-form.tsx, confirm-version.tsx (new); admin-nav.tsx
- src/features/company/use-map-form.tsx; src/features/workspace/workspace-shell.test.tsx
- src/app/(admin)/admin/rules/page.tsx (new)
- e2e/admin-rules.spec.ts (new)
