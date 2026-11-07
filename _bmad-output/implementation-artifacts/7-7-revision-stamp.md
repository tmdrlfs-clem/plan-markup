# Story 7.7: Revision stamp

Status: done

## Story

As a drafter,
I want a revision stamp,
so that each as-built shows its revision, date, author and description.

## Acceptance Criteria

1. **Place (FR37):** with a drawing open, the rail's Revision stamp (FileBadge, no key) arms the tool (HintBar "Revision stamp: click where it goes…", a half-strength ghost under the pointer); a click places a stamp centred there, upright on screen, 180 × 54 pt: the revision after the document's latest (A → B, Z → AA, 3 → 4, P1 → P2; first "A"), "As-built", the signed-in user's name and today's local date; one undo step "Add revision stamp"; then Select has it.
2. **Shows (UX-DR27):** a box (white fill, the markup's colour and width) with a header row, "Rev C" bold on the left and the date on the right, a rule under it, then the description and the author; text at the markup's font size, clipped to the box. Its live content comes from its fields (never stored text). Markups List and layer 2 label it "Revision C — As-built".
3. **Edit in Properties:** for one selected stamp, Revision, Description, Author and Date fields (committed on Enter or leaving, Esc reverts) next to subject, colour, fill, width, opacity and font size; one undo step "Edit revision stamp"; a value that would not make a valid stamp (empty revision, a date not YYYY-MM-DD, too long) is refused with a toast saying why and the stamp keeps its own.
4. **Behaves like a markup:** select, move, resize, rotate (no vertex handles), copy/paste, group, lock, layers, subject, delete, undo; saved and synced like others (type `revision`, its fields in `props`); a valid tool in the Tool Chest.
5. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Model** — `revisionMarkupSchema` (`points` four corners, `revision {rev ≤ 10, description ≤ 200, author ≤ 100, date YYYY-MM-DD}`) in the union; `core/markup/revision.ts` (`nextRevision`, `latestRevision`, `localDate`, `newRevisionMeta`, `revisionMarkupAt`, `revisionText`, `revisionLabel`, `REVISION_SIZE_PT`, `DEFAULT_REVISION_STYLE`).
- [x] **Task 2: Editor** — viewer tool `revision`; `features/editor/revision-tool.ts` (`placeRevision`, `revisionAt`, `setRevisionAuthor`, `ADD_REVISION`); painter `paintRevision` + ghost; hit test (box), no vertex handles; Properties `revision` field and `withChange`; Markups List icon; rail button and hint; the shell sets the author.
- [x] **Task 3: Tests** — `revision.test.ts` (5), `revision-tool.test.ts` (2), shell rail count; e2e `revision-stamp.spec.ts` (place, edit, invalid date refused, next is D, after a reload).

## Dev Notes

- Defaults taken (D questions in the report):
  - the next revision follows the document's latest stamp (by creation time), across its pages;
  - date is the local date as text (YYYY-MM-DD), not a date picker;
  - the author is the signed-in user's display name, editable;
  - a stamp is a fixed 180 × 54 pt box at placement (resize afterwards); no key;
  - one rail button of its own (the rail scrolls when it is short).
- PDF export (Epic 11) will flatten it like the other markups.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.7], FR37, UX-DR27, UX F4 (as-built finish)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 207 files / 2068 tests pass; build ok; check:* pass; e2e revision-stamp, properties-panel, workspace-shell, markups-list, save-tool, text-tools pass.
- CI green on 7313b54 (unit, guards, Playwright e2e, gitleaks).

### File List

- src/core/schema/markup.ts; src/core/markup/revision.ts (new), revision.test.ts (new), properties.ts, geometry.ts
- src/features/editor/revision-tool.ts (new), revision-tool.test.ts (new), measure-tool.ts, properties.ts, properties-panel.tsx, handles.ts, markups-list-panel.tsx, undo-store.ts, index.ts
- src/features/viewer/viewer-store.ts; src/features/workspace/tool-rail.tsx, workspace-shell.tsx, workspace-shell.test.tsx
- e2e/revision-stamp.spec.ts (new)
