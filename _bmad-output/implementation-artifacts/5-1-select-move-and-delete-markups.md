# Story 5.1: Select, move and delete markups

Status: ready-for-dev

## Story

As a drafter,
I want to select markups and move or delete them,
so that I can fix mistakes quickly.

## Acceptance Criteria

1. **Click (Select, `V`):** a click on a markup (its line within 5 CSS px, an area's inside, a count's marker, or its caption) selects it, the topmost first; a click on empty page space clears the selection; `Shift` + click adds a markup to the selection or takes it out (also on its caption). Hit-testing uses an `rbush` index per page (AR15). Selected markups show the accent outline with a white halo (UX-DR13; resize and rotate handles come with 5.2). Over a markup the cursor is `move`.
2. **Marquee:** a drag that starts on empty space draws a rectangle and selects the markups wholly inside it (`Shift`: adds them); **lasso**: `Alt` + drag draws a freeform loop and selects the markups wholly inside it (D1).
3. **Move:** dragging a markup moves it, or the whole selection when it is selected (a markup not selected is selected first); the markups follow the pointer (NFR3) and the drop is **one undo step** ("Move markup" / "Move markups"). A press that moves less than 3 CSS px is a click. `Esc` while dragging puts them back.
4. **Nudge:** arrow keys move the selection by 1 CSS px at the current zoom, `Shift` by 10 (UX-DR36); a held arrow key is **one undo step** for the whole hold (committed on release) (D2).
5. **Delete:** `Delete` / `Backspace` deletes the selection as one undo step ("Delete markup(s)") with a toast "Deleted n markup(s)" and an **Undo** action instead of a confirmation (UX-DR32); undo puts them back in their drawing order.
6. **Select all:** `Ctrl+A` with the canvas focused selects every markup on the shown page (D3).
7. **Scope:** keys act only with the Select tool and the canvas's keys (canvas focused, or the pointer over it with nothing else focused); fields, menus and dialogs keep theirs. The selection is cleared by Esc, another tool, page (D4), tab or document; the Measurements panel shows it.
8. **Undo:** every move and delete is one undo step, and undo / redo covers every markup command; the history survives a reload until the tab closes (Story 4.5's session, FR35, UX-DR36).
9. **Core:** hit-testing, bounds, containment (rectangle, lasso) and translation in `src/core/markup` (framework-free), unit-tested.
10. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` at 1:100: two lengths; click selects one; drag moves it (caption unchanged, one undo step, undo puts it back); Shift+click adds the other; arrow nudge moves both; Delete removes both with the toast; Undo in the toast restores them; marquee selects both; Ctrl+A selects all.

## Tasks / Subtasks

- [ ] **Task 1: Core** — `src/core/markup/geometry.ts` (bounds, hit test, inside rectangle / polygon, translate) and `index.ts` (`MarkupIndex` over `rbush`); unit tests.
- [ ] **Task 2: Viewer** — Select tool gestures (press / move / release / cancel, Shift, Alt) forwarded to the painter in user space with the hit tolerance; selection keys (Delete, Backspace, arrows press / release, Ctrl+A); the `move` cursor over a markup; the marquee and lasso painted on layer 3.
- [ ] **Task 3: Editor** — `select-tool.ts`: selection gestures, move preview (`tools.moveDrag`), nudge, delete with toast + Undo, select all; the painter delegates; Shift+click on a caption toggles; page change clears; unit tests.
- [ ] **Task 4: Tests** — `e2e/select-move-delete.spec.ts` (AC 10).

## Dev Notes

- Selection already exists (`editorStore.selection`, Story 4.11): the panel, Esc, another tool / tab clear it; the outline is painted by the measure painter.
- Moves use `markups.update` (before / after), deletes `markups.remove` with positions (undo restores the order).
- **Deferred:** locked markups' lock cursor and tooltip move to Story 5.3, which adds locking (no markup can be locked before it). Markups List sync waits for the Markups List.
- Shift + drag on a caption still moves the caption only (4.6); Shift + click on it (no movement) toggles the selection.
- Defaults chosen here, to confirm with the founder: lasso is `Alt` + drag in Select (D1); a held arrow is one undo step (D2); `Ctrl+A` selects the shown page only (D3); changing page clears the selection (D4); marquee selects markups wholly inside, in either drag direction (D5); nudge 1 / 10 screen px (D6).
- Revu behaviour (official help: Selecting markups): click, Shift+click, marquee, Ctrl+A, arrow nudge, Delete.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1], FR33, FR35, AR15, UX-DR13, UX-DR32, UX-DR36, NFR3
- [Source: _bmad-output/implementation-artifacts/4-11-measurements-panel.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

### File List
