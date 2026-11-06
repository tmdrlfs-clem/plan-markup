# Story 6.7: Markups List panel

Status: done

## Story

As a drafter,
I want all markups in a table,
so that I can review my work in one place.

## Acceptance Criteria

1. **Grid:** the Markups List (bottom panel, `Alt+L`) shows the active document's markups, page order then drawing order, with type icon, subject, page label, comments count, date, author, status, colour, layer and measurement value; only the rows in view are rendered, so thousands scroll smoothly (FR45, UX-DR28).
2. **Selection syncs:** a row click selects its markup on the canvas (Properties follows); Ctrl+click toggles, Shift+click selects a range; a row on another page shows that page first. The canvas selection marks its rows and scrolls the first into view.
3. **Zoom:** double-click or Enter zooms to the markup and selects it.
4. **Keyboard (UX-DR38):** arrows move the active cell (Up / Down select its row, Shift extends, Ctrl moves without selecting); Home / End the first / last cell; Ctrl+Home / Ctrl+End the first / last row; Page Up / Page Down; Space selects (Ctrl+Space toggles).
5. Empty states: no drawing, no markups.
6. `npm run typecheck`, `lint`, `test`, `build`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Rows** — `core/markup/markup-list.ts`: `markupListRows` (subject, page label, date, colour, layer name, value read as the caption with the page's calibration unit and precision), `pageIndexOf`, `visibleRange`.
- [x] **Task 2: Grid** — `features/editor/markups-list-panel.tsx`: `MarkupsListPanel` (role grid, aria-activedescendant, 28 px rows, sticky header, overscan 8), selection and reveal through the viewer commands.
- [x] **Task 3: Shell** — the bottom panel shows the list; author is the signed-in user's display name.
- [x] **Task 4: Tests** — unit (rows ×3, grid ×6), `e2e/markups-list.spec.ts`; workspace-shell tests use the new empty text.

## Dev Notes

- Comments and review status do not exist yet (comments and statuses come with later epics); both columns read "—" until then.
- Every markup in a set is the owner's until sharing exists, so the author is the signed-in user.
- Eraser strokes are not listed (they clean up the drawing; nothing to review).
- The canvas selects on one page (Story 5.1 D4), so a multi-selection keeps only the rows on the clicked row's page.
- Sort, filter and search are Story 6.8.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.7], FR45, UX-DR28, UX-DR38

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- CI green (7819445). Unit src/features + src/core pass (workspace-shell 41). e2e (dev): markups-list, workspace-shell, select-move-delete, measurements-panel, layers pass.

### File List

- src/core/markup/markup-list.ts (new), markup-list.test.ts (new)
- src/features/editor/markups-list-panel.tsx (new), markups-list-panel.test.tsx (new), index.ts
- src/features/workspace/workspace-shell.tsx, workspace-shell.test.tsx
- e2e/markups-list.spec.ts (new)
