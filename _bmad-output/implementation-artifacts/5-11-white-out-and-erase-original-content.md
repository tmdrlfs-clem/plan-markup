# Story 5.11: White-out and erase original content

Status: review

## Story

As a drafter,
I want to cover original drawing content,
so that as-built changes replace what was drawn without destroying the original.

## Acceptance Criteria

1. **Tools:** White-out (`Shift+W`), White-out polygon and Eraser share the rail's White-out slot (its menu lists all three; the others have no key, D4). The HintBar says how each works and that the PDF is not changed until flatten or export.
2. **White-out:** a drag from one corner to the opposite one, or two clicks, adds a `whiteout` markup over the box's four corners (as Rectangle, snapped, Shift a square); White-out polygon adds one over the corners clicked, closed on the first corner, a double-click or Enter (as Polygon; Backspace removes the last corner). Each is one undo step ("Add white-out"); the tool stays armed; Esc cancels, Esc again returns to Select.
3. **Eraser:** a drag paints a white brush stroke (10 pt, D2) over the drawing, added on release as an `eraser` markup, one undo step ("Add eraser stroke"); Esc while dragging drops it; Shift holds it straight (as Pen).
4. **Covering:** a cover is painted the sheet's white, filled, with no outline, in the drawing order (it hides the drawing and the markups under it, D1); the tiles (the PDF) are not changed (FR36, AR25). Layer 2 lists "White-out" / "Eraser".
5. **Editing:** covers work with Select (a white-out hit inside it, an eraser stroke within its width), move, resize, rotate, nudge, delete, copy / paste, group, order, lock; a white-out has vertex handles, an eraser stroke none. Properties: a white-out has only its subject; an eraser stroke its subject and width (D3: a cover stays opaque white).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: Shift+W over the drawn rectangle's left side makes the markups canvas opaque white there while the tiles still have the line; one undo step; Select, Delete, Ctrl+Z; the Eraser from the menu brushes the top side white (one undo step).

## Tasks / Subtasks

- [x] **Task 1: Core** — `whiteout` (3+ points) and `eraser` (a stroke) schemas, `COVER_COLOR`, `DEFAULT_COVER_STYLE`; hits, index padding, no handles for strokes; properties' fields and subjects; unit tests.
- [x] **Task 2: Viewer** — tools `whiteout` (a box tool), `whiteoutpolygon`, `eraser` (an ink tool), `CoverTool` / `isCoverTool`; Shift+W; snapping for the white-out tools.
- [x] **Task 3: Editor** — measure-tool: labels, points, closing, the markups made, painting the covers (static and while drawing), the eraser's style; undo labels; rail slot and hints; unit tests.
- [x] **Task 4: Tests** — `e2e/whiteout.spec.ts` (AC 6), in CI.

## Dev Notes

- A cover is a markup like the others: flatten / export (later) draws it onto the page; until then the PDF is untouched (architecture: white-out = visual cover, true content removal deferred).
- Highlights are painted on their own multiplied canvas under the markups, so a cover also hides a highlight under it.
- The sheet is painted white in every theme, so a white cover matches it.
- Defaults chosen here, to confirm with the founder: D1 covers draw in the drawing order (a later cover hides earlier markups too, as a white rectangle in Revu does); D2 the eraser brush is 10 pt; D3 covers are always opaque white (no colour or opacity in Properties); D4 only White-out has a key (Shift+W).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.11], FR36, AR25
- [Source: _bmad-output/planning-artifacts/architecture.md] (white-out = visual cover)
- [Source: _bmad-output/implementation-artifacts/5-7-pen-and-highlight.md] (strokes)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `whiteoutMarkupSchema`, `eraserMarkupSchema` (an `InkMarkup`), `WhiteoutMarkup`, `COVER_COLOR`, `DEFAULT_COVER_STYLE`; a white-out is hit as a filled polygon, an eraser stroke as a pen's; `fieldsOf` for covers; subjects "White-out", "Eraser".
- Task 2: `whiteout` joins `BoxTool`, `eraser` joins `InkTool`, `whiteoutpolygon` draws as Polygon does (`CLOSED`); `CoverTool` / `isCoverTool`; Shift+W; snapping.
- Task 3: `ADD_WHITEOUT`, `ADD_ERASER`; `paintCover` (white, filled, no stroke); the preview outlines the cover so far; rail slot "White-out" (`COVER_TOOLS`, "More white-out tools"), hints.
- Unit tests: 1888 pass. Local e2e not run (Docker off); CI runs `e2e/whiteout.spec.ts`.

### File List

- src/core/schema/markup.ts, src/core/markup/geometry.ts, markup-index.ts, properties.ts
- src/features/viewer/viewer-store.ts, index.ts, viewer-input.ts, viewer-input.test.ts, snap-controller.ts
- src/features/editor/measure-tool.ts, undo-store.ts, handles.ts, cover-tool.test.ts (new)
- src/features/workspace/tool-rail.tsx, workspace-shell.test.tsx
- e2e/whiteout.spec.ts (new)
