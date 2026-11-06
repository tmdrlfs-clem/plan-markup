# Story 6.8: Sort, filter and search the Markups List

Status: review

## Story

As a drafter,
I want to sort, filter and search markups,
so that I can find the ones I need.

## Acceptance Criteria

1. **Sort:** a header click sorts by that column (ascending, descending, then list order), stable; `aria-sort` on the header. Sortable: type, subject, page, date, colour, layer, measurement (by value; rows without one last). Comments, author and status do not sort (no data yet).
2. **Column filters:** Filter → Type / Page / Colour / Layer lists the column's values as checkboxes; a column keeps rows with any checked value, columns combine with AND.
3. **Quick filter:** every typed word must appear in the row's subject, type, page, layer, value or colour (any case); Escape clears it.
4. **Chips and count:** active filters show as removable chips; the count reads "Showing 24 of 312" while filtered, else "312 markups"; no match offers "Clear filters" (FR46, UX-DR28).
5. **Jump:** selecting a row (filtered or sorted) shows the markup's page and selects it (Story 6.7).
6. `npm run typecheck`, `lint`, `test`, `build`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Core** — `core/markup/markup-list.ts`: `measure` per row; `applyListView`, `filterOptions`, `filterValue`, `nextSort`, `countText`, `isFiltered`, `EMPTY_VIEW`, `NO_LAYER`.
- [x] **Task 2: UI** — `markups-list-panel.tsx`: `markupListView` store, toolbar (quick filter, Filter menu with submenus, chips, count), sortable headers, no-match state.
- [x] **Task 3: Tests** — unit (core ×4, panel ×5); `e2e/markups-list.spec.ts` extended.

## Dev Notes

- The view (sort, filters, quick filter) is one per session for every document, not saved (D1).
- Range selection (Shift) follows the shown order.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.8], FR46, UX-DR28

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Unit editor/workspace/core markup 305 pass; e2e markups-list pass (dev).

### File List

- src/core/markup/markup-list.ts, markup-list.test.ts
- src/features/editor/markups-list-panel.tsx, markups-list-panel.test.tsx
- e2e/markups-list.spec.ts
