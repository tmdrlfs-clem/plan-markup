# Story 6.1: Identify the file and create its markup set

Status: review

## Story

As a drafter,
I want the app to recognise the exact PDF I opened,
so that my work is tied to that file and never to a different version.

## Acceptance Criteria

1. **Identity:** the SHA-256 of the bytes, computed in a worker in parallel with rendering (A1, AR9; it is computed in `render.worker` per ADR 0006 with the other per-file work), is the file's identity.
2. **Tables:** a migration creates `drawings` (owner, title, storage_enabled), `drawing_files` (sha256, pdf.js fingerprint, page_count, filename, parent_file_id, storage_path null), `pages` (stable `page_id`, index, rotation, crop box, size) and `calibrations` (per page_id), with owner RLS for active users only and pgTAP tests (AR5, AR6).
3. **First edit:** the first edit or calibration of a hash unknown to the user makes the drawing, file and page rows in one transaction (`ensure_drawing_file`, SECURITY INVOKER, one set per user and hash under an advisory lock); opening a file makes nothing.
4. **Calibrations:** Epic 4's calibrations save by server page id after each change (do, undo, redo; batched ~300 ms); a failed save goes with the next change.
5. **No bytes:** no request carries PDF bytes and nothing touches Storage (NFR26).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run db:test`, `check:schema`, `check:types`, `check:rls` pass; CI e2e on `fixtures/pdf/scales.pdf`: open (no rows), use the detected scale (drawing, file, 5 pages, page 1's calibration 1:100), undo (calibration gone, set kept), no PDF bytes sent.

## Tasks / Subtasks

- [x] **Task 1: Database** — migration 20261106090000_drawings.sql (4 tables, `app.fn_owns_drawing`, owner policies, `public.ensure_drawing_file`); supabase/tests/drawings_rls.test.sql (24); schema.sql and types.gen.ts regenerated.
- [x] **Task 2: Core and server** — core/markup-set/markup-set.ts (inputs, `pageGeometryOf`, `setFilename`); lib/db/drawings.ts (casing, AR7); features/markup-set/actions.ts (`ensureMarkupSet`, `saveSetCalibrations`); unit tests.
- [x] **Task 3: Client** — editor `subscribeAppliedOps` (every applied op); features/markup-set/sync.ts (`createMarkupSetSync`, `useMarkupSetSync` in the workspace shell); unit tests.
- [x] **Task 4: Tests** — `e2e/markup-set.spec.ts` (AC 6), reading the rows from the local database.

## Dev Notes

- The client keeps its page keys (`<sha256>:<index>`, Story 4.3); the server's page ids are mapped by index when saving. Restoring (Story 6.4) maps them back.
- File identity and pages never change once made (no UPDATE grant on `drawing_files` / `pages`): an in-app page edit will be a new file with `parent_file_id` (A2).
- Defaults chosen here, to confirm with the founder: D1 a new set is titled by the filename; D2 the pdf.js fingerprint column stays null for now (Story 6.5 uses the filename; the fingerprint is added when a hint needs it); D3 the same user opening the same bytes under another name joins the existing set (the first filename is kept); D4 another user's set with the same hash is never joined (each user has their own until sharing, Epic 8); D5 a set is made on any applied op (markup or calibration, incl. layers), not on selection or view changes.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1], A1, A2, AR5, AR6, AR9, NFR26
- [Source: docs/decisions/0006-snap-and-scale-in-render-worker.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: Supabase's default privileges give `authenticated` every privilege on new public tables; the migration revokes them all and grants back only what is used (pgTAP checks no UPDATE on files).
- Task 2–3: the sync asks for the set once per document (a failure is forgotten so the next edit asks again); calibration changes wait in a map by key and are kept when the set or the save fails.
- Tests: unit 1919 pass; db:test 114 pass; local e2e `e2e/markup-set.spec.ts` passes (dev server).

### File List

- supabase/migrations/20261106090000_drawings.sql (new), supabase/tests/drawings_rls.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/core/markup-set/markup-set.ts (new), markup-set.test.ts (new)
- src/lib/db/drawings.ts (new)
- src/features/markup-set/actions.ts (new), actions.test.ts (new), sync.ts (new), sync.test.ts (new)
- src/features/editor/commands.ts, index.ts
- src/features/workspace/workspace-shell.tsx, workspace-shell.test.tsx
- e2e/markup-set.spec.ts (new)
