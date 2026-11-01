# Story 5.1: Select, move and delete markups

Status: done

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

- [x] **Task 1: Core** — `src/core/markup/geometry.ts` (bounds, hit test, inside rectangle / polygon, translate) and `index.ts` (`MarkupIndex` over `rbush`); unit tests.
- [x] **Task 2: Viewer** — Select tool gestures (press / move / release / cancel, Shift, Alt) forwarded to the painter in user space with the hit tolerance; selection keys (Delete, Backspace, arrows press / release, Ctrl+A); the `move` cursor over a markup; the marquee and lasso painted on layer 3.
- [x] **Task 3: Editor** — `select-tool.ts`: selection gestures, move preview (`tools.moveDrag`), nudge, delete with toast + Undo, select all; the painter delegates; Shift+click on a caption toggles; page change clears; unit tests.
- [x] **Task 4: Tests** — `e2e/select-move-delete.spec.ts` (AC 10).

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

- `core/markup`: `geometry.ts` (bounds — a circle's whole circle —, stroke hit within a tolerance, an area's inside less its holes, a count's markers, a radius's / diameter's circle and line, wholly-inside tests for a rectangle and a lasso loop, translation with holes) and `markup-index.ts` (`MarkupIndex` over `rbush`: topmost hit, markups in a rectangle / loop in drawing order). `@types/rbush` 4.0.0 added (dev). The Measurements panel's `markupBounds` now comes from here.
- Viewer: a `select` drag kind with Select (after Shift + caption drag, 4.6), `selectGesture` / `selectHover` / `selectionKey` on the engine (user space, tolerance 5 CSS px, nudges converted from screen px so they follow the view rotation), the `move` cursor over a markup, Esc cancels a Select drag, selection keys only with Select and the canvas's keys (Ctrl+A only with the canvas focused), a nudge hold committed on key release or when focus leaves the canvas, Alt kept from the browser with Select (the lasso).
- Editor: `select-tool.ts` (gestures, `tools.moveDrag` preview painted by the measure painter, nudge, delete with an Undo toast, select all, marquee / lasso on layer 3 as a dashed accent line over a white halo); Shift + click on a caption (a caption drag that did not move) toggles its markup; another page clears the selection (the Measurements panel reveals first, then selects).
- Lock cursor / tooltip deferred to 5.3 (no markup can be locked before it); Markups List sync waits for the Markups List.
- Local: e2e on snap.pdf at 1:100 (screenshot fixtures/private/traces/5-1-selection.png, not committed). Unit 155 files / 1760 tests; related e2e 19 passed.

### Review (self, adversarial)

- R1 (fixed): the delete toast's Undo undid whatever was last (another edit after the delete); it now undoes the delete only while it is still the tab's last step, and otherwise puts back the markups still missing as a new step ("Restore markups").
- R2 (fixed): Alt with Select (the lasso) was not kept from the browser.
- Checked, no change: a press off the page still starts a marquee (screenToUser works off the page); a nudge during a drag is refused; Delete during a nudge commits the nudge first; a selected markup removed by undo leaves the selection (4.11); the R-tree is rebuilt only when the document's markups change.

### File List

- src/core/markup/geometry.ts, markup-index.ts, geometry.test.ts (new)
- src/features/editor/select-tool.ts, select-tool.test.ts (new)
- src/features/editor/editor-store.ts, measure-tool.ts, measurements-panel.tsx, index.ts
- src/core/measure/totals.ts
- src/features/viewer/viewer-engine.ts, viewer-input.ts, viewer-input.test.ts, markup-layer.ts, index.ts
- package.json, package-lock.json (@types/rbush)
- e2e/select-move-delete.spec.ts (new)
