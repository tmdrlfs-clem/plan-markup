# Story 8.4: Record export and print events

Status: review

## Story

As the platform admin,
I want export and print events recorded without drawing content,
so that I can measure real use during the pilot.

## Acceptance Criteria

1. **Events (FR80, AR21):** when an export completes (the file is handed to the browser), a `markup.exported` row is written with kind `editable` or `flattened`. When a print completes (the browser's print dialog is opened), a `drawing.printed` row is written with kind `with_markups` or `without_markups`. Each row has the server's time, the user, the user's markup set for the file (null when they have none yet), the page count and the markup count. Nothing else is recorded: no file name, no title, no drawing content. Failed or cancelled exports and prints write nothing.
2. **Never in the way:** recording is fire and forget after the action. A failure (offline, rate limited) never blocks or fails the export or print and is never shown to the user.
3. **Migration with RLS and tests:** `public.activity_events` has these rules:
   - Insert own: the caller as user, active users only, only into their own markup set.
   - Select by the platform admin only.
   - No update or delete for users; nothing for anon.
   - The table has no free-text or JSON column; the name and kind are checked lists.
   - The time is set by the server.
   - At most 120 events a minute per user (`consume_rate_limit`).
   - pgTAP `activity_events_rls.test.sql` (17).
4. `npm run typecheck`, `lint`, `test`, `build`, `check:*`, `db:test` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: DB** — migration `20261110090000_activity_events.sql` (table, checks, indexes, `app.fn_activity_event_defaults` trigger, RLS, grants); pgTAP test; `types.gen.ts` and `schema.sql` regenerated.
- [x] **Task 2: Server** — `core/activity/activity-event.ts` (strict schema, kind per name), `lib/db/activity.ts` (insert; SQLSTATE → code), `features/activity/actions.ts` `recordActivity` (session user, Result).
- [x] **Task 3: Client** — `run-export.ts`: `deps.record` after a completed export or print, `reportActivity` adds the markup set id (`markupSetIdOf` in markup-set sync).
- [x] **Task 4: Tests** — schema (1), action (2), run-export/print record calls; e2e: print and flatten rows checked in the database (`activityEvents()` helper; the per-test account's events are cleared).

## Dev Notes

- The page count is the pages chosen (export) or sheets printed (print). The markup count is the markups written (annotations + flattened) or printed.
- The trigger keeps the user as given. RLS, which is checked after BEFORE triggers, refuses anyone but the caller. The trigger overwrites `occurred_at` with `now()`.
- The remote database still needs the Story 6.x–8.4 migrations deployed (Story 8.5).

## Dev Agent Record

### File List

- supabase/migrations/20261110090000_activity_events.sql (new), supabase/tests/activity_events_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/core/activity/activity-event.ts (new), activity-event.test.ts (new)
- src/lib/db/activity.ts (new)
- src/features/activity/actions.ts (new), actions.test.ts (new)
- src/features/export/run-export.ts, run-export.test.ts; src/features/markup-set/sync.ts; src/features/workspace/workspace-shell.test.tsx
- e2e/helpers.ts, e2e/print.spec.ts, e2e/export-pdf.spec.ts
