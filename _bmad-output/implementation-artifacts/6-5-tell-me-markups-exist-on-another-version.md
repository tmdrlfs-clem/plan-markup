# Story 6.5: Tell me markups exist on another version

Status: done

## Story

As a drafter,
I want a hint when I open a newer copy of a file I marked up,
so that I can find my earlier work without it being moved.

## Acceptance Criteria

1. **Hint:** opening a file whose bytes have no set while one of my sets has a file of the same name shows the HintBar "Markups exist on another version of this file · Open markup set list" (info), dismissible, never wording that suggests loss (FR81, UX-DR11, UX-DR17).
2. **Nothing moved:** markups are not copied or moved.
3. **The list it opens** (the list part of Story 6.6, so the action is never a dead end): File → Markup sets… shows my sets newest first with filename, page count, markup count and last modified, and an empty state.
4. `npm run typecheck`, `lint`, `test`, `build`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Database** — migration `20261108090000_list_markup_sets.sql`: `public.list_markup_sets()` (SECURITY INVOKER; first file, live markups, newest change of set/markups/calibrations); index on `drawing_files.filename`; pgTAP `list_markup_sets.test.sql` (5).
- [x] **Task 2: Server** — `lib/db/markups.ts` `listMarkupSets`, `hasOtherVersion`; actions `listMyMarkupSets`, `hasMarkupsOnOtherVersion`.
- [x] **Task 3: Client** — restore asks for another version when the server has no set for the bytes; `markup-sets-ui.tsx` (store, `useOtherVersionHint`, `MarkupSetListDialog`); File → Markup sets…; File → Save now sends (Ctrl+S, Story 6.3).
- [x] **Task 4: Tests** — unit (sync ×2, UI ×2); `e2e/other-version.spec.ts`.

## Dev Notes

- The check runs only when the opened bytes have no set (a file with a set restores silently, UX "same bytes → restore silently"). The filename is the opened file's name as the set records it (`setFilename`).
- Dismissal is per document and tab, like the other HintBar notices (`dismissNotice`).
- Story 6.6 adds opening a set from the list (asking for the matching PDF, or blank pages) and the EmptyWorkspace recent list.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.5, #Story 6.6], FR51, FR81, UX-DR11, UX-DR17

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- CI green (faed0c7). db:test pass (list_markup_sets 5); unit markup-set/workspace pass; e2e other-version, restore-markups, workspace-shell pass (dev).

### File List

- supabase/migrations/20261108090000_list_markup_sets.sql (new), supabase/tests/list_markup_sets.test.sql (new), supabase/schema.sql, src/lib/db/types.gen.ts
- src/lib/db/markups.ts, src/features/markup-set/actions.ts, sync.ts, sync.test.ts, markup-sets-ui.tsx (new), markup-sets-ui.test.tsx (new), save-indicator.test.tsx
- src/features/viewer/index.ts (dismissNotice export)
- src/features/workspace/workspace-shell.tsx, workspace-shell.test.tsx, workspace-menu-bar.tsx
- e2e/other-version.spec.ts (new)
