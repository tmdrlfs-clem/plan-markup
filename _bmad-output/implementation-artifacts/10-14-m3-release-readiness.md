# Story 10.14: M3 release readiness

Status: done (closed on the in-repo part by the founder, 2026-11-17, who kept D1–D6; AC 1 and AC 2 are done with the production project, docs/release.md → "M3 gate")

## Story

As the founder,
I want the SaaS foundation ready before the first pilot company,
so that their data is safe and support is possible.

## Acceptance Criteria

1. Supabase Pro with 7-day point-in-time recovery is enabled (NFR39, AR22).
2. Production email delivery (verification, reset, invite, activation) is verified end to end.
3. The RLS matrix covers every role × table and passes in CI.
4. A security review pass is completed with no open High findings (NFR36).

## Tasks / Subtasks

- [x] AC 3: `supabase/tests/rls_matrix.test.sql` (184), run by CI's Database job with the rest of pgTAP:
  - 8 roles: anonymous, pending (a company member not yet activated), active in no company, the owner (company admin), member, viewer, another company's admin, the platform admin;
  - 22 lines: every table in `public` and `app` and the `zones` view, with tool sets, tools and the use → hazard map split into their personal / company / platform rows;
  - each cell: rows read, rows updated, rows deleted, and an insert of a forged copy of the owner's row; writes are undone; one assertion per table and role, so a failure names both;
  - catalog checks: every table and view has a line; every line covers every role; no `TRUNCATE` / `TRIGGER` / `REFERENCES` for the API roles; `anon` holds no table privilege and runs no SECURITY DEFINER function; every view is `security_invoker`; a new table grants nothing to the API roles.
- [x] Fix from the matrix (security review M2): `20261127090000_revoke_table_extras.sql` revokes `TRUNCATE`, `TRIGGER` and `REFERENCES` from `anon` and `authenticated` on every table (five still had them; TRUNCATE ignores RLS) and changes the `postgres` role's default privileges in `public` so a new table grants nothing to them until its migration says so.
- [x] AC 4: `docs/security-review-m3.md`: no High. M2 fixed here; M3 (direct calls to Supabase Auth skip Turnstile, our rate limits and HIBP) open by the founder's decision of 2026-11-12, with Leaked password protection added to the setup; M1 and L3 with the cloud setup; L6–L8 noted. M2's L5 closed by 10.13.
- [x] `docs/release.md`: step 1 gains Pro and PITR (7 days, a practice restore); step 2 gains Leaked password protection; a new **M3 gate** checklist covers AC 1, AC 2 (each email to real inboxes on two providers), the Auth settings, the protected environment, the matrix in CI and the review.
- [ ] AC 1 (founder, production): Pro, PITR 7 days, practice restore.
- [ ] AC 2 (founder, production): the five emails of the M3 gate, end to end.

## Dev Notes

- **D1, AC 1 and AC 2 are left open in the repo,** like Story 8.5's cloud setup: they need the production project, which does not exist yet. The story stays in review until they are ticked in `docs/release.md`, or the founder closes it on the in-repo part as with 8.5.
- **D2, the matrix tests other people's rows, not each role's own writes.** Each line holds rows that belong to the owner (or to nobody); the other roles try to read, change, delete and forge them. A role's work on its own rows is covered by each table's own test file (all still run). For the owner, the insert cell is "-".
- **D3, the matrix states what each role gets, not only what it must not get.** A cell that gives more or less than written fails, so a policy that starts hiding rows from the people who need them fails too.
- **D4, M2 is Medium, not High.** TRUNCATE is not reachable through the API, and nobody gets a direct database connection as `authenticated`. It is fixed anyway, with a test that keeps it fixed.
- **D5, M3 stays open** (founder's choice on 2026-11-12, "raise it again before public launch"). A pilot is not a public launch; Leaked password protection at the setup closes the HIBP part of it.
- **D6, the default-privileges change applies to new tables only.** A future migration must grant what its table needs; the matrix test fails until the table has a line.

## Dev Agent Record

### File List

- supabase/migrations/20261127090000_revoke_table_extras.sql (new); supabase/tests/rls_matrix.test.sql (new); supabase/schema.sql
- docs/security-review-m3.md (new); docs/release.md
