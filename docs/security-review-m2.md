# M2 security review (Story 9.13, NFR36)

Date: 2026-11-10 · Scope: what Epic 9 added since the M1 review (`docs/security-review-m1.md`): the rule tables, zones, the engine worker, zone layouts, the 4541 panel and the advisory notice.
Result: **no open High findings.**

The M1 findings are unchanged: M1 (protect the GitHub `production` environment) and L3 (production Auth settings) are still to be done with the cloud setup in `docs/release.md`.

## What was checked

| Area | Check | Result |
|---|---|---|
| New tables | `rule_figures`, `use_hazard_map`, `zone_layouts`: RLS on, policies present (`check:rls`: 14 tables; `rls_coverage.test.sql`). pgTAP per table; the whole suite is 239 assertions, all passing | Pass |
| Rule tables | Read: active users. Write: platform admin only (`fn_is_platform_admin`), tested as a normal user and as an admin. No grant to `anon` | Pass |
| Zones view | `public.zones` is `security_invoker` and `security_barrier`: the caller's RLS on `markups` applies. Select only | Pass |
| Zone layouts | Insert needs owner or edit access to the markup set and `created_by = auth.uid()`; select needs access; no update or delete. Size limits per JSON column (1 MiB), 120 rows a minute per user | Pass (see L4) |
| SECURITY DEFINER | `fn_zone_layout_defaults` only sets the time and calls the rate limit; `search_path = ''`; EXECUTE revoked from `public`, `anon`, `authenticated` | Pass |
| Server actions | `getUseHazardMap`, `saveZoneLayouts`: `getAuthUser()` first, strict Zod input, fixed safe error codes | Pass |
| Engine worker | Every request is validated with Zod at the worker boundary (finite coordinates, at most 50 zones, 20,000 points a ring, 5,000 heads); replies carry no stack traces. Placement has a fixed operation budget, so no input runs unbounded | Pass |
| Drawing content | Zone layouts hold geometry in mm and figures, no file content. The `sprinkler.placed` activity event holds counts only | Pass |
| Advisory notice | A fixed string drawn into the PDF; no user text is involved | Pass |
| XSS sinks | No `dangerouslySetInnerHTML`, `innerHTML =`, `eval` or `new Function` in `src`. Zone names, uses and rule-break messages are rendered as text; markers are painted on the canvas | Pass |
| Rule figures in use | Placement and the live check read the built-in ruleset file. CI fails when the database seed differs (`check:rules`) | Pass (see L5) |
| Dependencies | No runtime dependency added since M1. `npm audit --omit=dev`: 0 high, 0 critical, 5 moderate (the same `glob` / `minimatch` advisories as M1, L2) | Pass |

## Findings

- **L4 (Low, integrity)**: a saved zone layout's `report` is what the client's oracle produced; the server stores it and does not run the oracle again. It is a record of a run, not proof of compliance. Nothing reads it back yet. Action: when reports are shown to other people (sharing, Epic 10 and later), compute them again from the saved inputs.
- **L5 (Low, change control)**: the platform admin can already edit `rule_figures` in the database, but placement uses the built-in file until Epic 10 wires the table in. That is the safe direction (a database edit cannot silently change layouts). Action: when it is wired in, the audit log (NFR34) and the `verified` flag must go with it.

## Not covered here

- Penetration testing by a third party (post-pilot).
- Company administration, invitations and sharing (Epic 10): reviewed with that epic.
