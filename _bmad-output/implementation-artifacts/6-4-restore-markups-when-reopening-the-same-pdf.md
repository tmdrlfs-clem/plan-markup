# Story 6.4: Restore markups when reopening the same PDF

Status: done

## Story

As a drafter,
I want my markups back when I reopen the same file,
so that I can continue where I left off.

## Acceptance Criteria

1. **Restore:** opening a file whose SHA-256 has a markup set shows its markups and calibrations from IndexedDB first, then reconciles with the server, and the status shows `✓ Saved` (FR50, UX-DR17).
2. **Other bytes:** a file changed outside the app (different hash) opens as a new drawing with no markups moved.
3. **Never blocks:** loading never blocks rendering; markups appear after the first frame.
4. `npm run typecheck`, `lint`, `test`, `build` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Server read** — `lib/db/markups.ts` `loadMarkupSet` (file by hash, pages, live markups by z, calibrations; paged by 1000; rows that are not valid markups skipped); action `loadMarkupSet`.
- [x] **Task 2: Local copy** — `pm-sync` IndexedDB v2 store `sets`: each set as last in step with the server (markups, z, calibrations, local layers), written when the queue empties and after a restore.
- [x] **Task 3: Restore** — `sync.restore(documentId)` after the viewer is ready (first frame): skipped when this tab's session already holds the document; the local copy, then the queue is sent, then the server's set (unless the user edited meanwhile or changes still wait); the snapshot and versions are seeded so the next edit sends only itself.
- [x] **Task 4: Tests** — unit (sync restore ×5); `e2e/restore-markups.spec.ts` (own seed user `restore@`); e2e specs signing in as the shared admin now get an account per test attempt (`e2e/helpers.ts`).

## Dev Notes

- Precedence: this tab's session (reload, Story 4.5) > the local copy > the server; an edit made before the server answers wins (its changes are queued against the copy shown).
- Layers stay local (6.2 D4): the local copy brings them back on this computer; elsewhere markups keep their layer ids (shown, as a markup on an unknown layer is).
- Since files are restored, specs sharing `admin@` would see each other's markups on the same fixture: `signIn(page, "admin@plan-markup.test")` now signs in as `e2e-<testId>-r<retry>@plan-markup.test` (active, platform admin, its sets cleared), made on demand.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.4], FR50, UX-DR17, NFR3

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Unit: 1953 (2 files timed out under load in a full run, pass alone); full local e2e 73 passed, 13 skipped (local-only perf), 0 failed.

### File List

- src/lib/db/markups.ts, src/features/markup-set/actions.ts
- src/lib/idb/op-queue.ts (v2: sets)
- src/features/markup-set/sync.ts, sync.test.ts
- src/features/editor/index.ts (exports)
- supabase/seed.sql (restore@)
- e2e/restore-markups.spec.ts (new), e2e/helpers.ts
