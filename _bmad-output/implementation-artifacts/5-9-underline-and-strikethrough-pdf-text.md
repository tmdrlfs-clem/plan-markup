# Story 5.9: Underline and strikethrough PDF text

Status: review

## Story

As a drafter,
I want to underline or strike through text in the PDF,
so that I can mark text changes.

## Acceptance Criteria

1. **Tools:** Underline and Strikethrough share a rail slot (its menu lists both), after the Text slot; no keys (D4, none in the UX table). The canvas shows the text cursor; the HintBar says how they work.
2. **Selecting:** a press on a word (within 4 CSS px of text) and a drag select the words from it to the text nearest the pointer, whole words, in the page text's reading order, across lines; the selection shows in the selection colour while dragging (D1: the tools select text themselves, as Revu's do; a separate Select text tool, for copying text, comes later). The page's text is the one search reads (Story 3.6), asked for when the tool is armed; a drag in progress picks it up when it arrives.
3. **Markup:** the release adds the markup over the selected glyph boxes (one quad per text item, cut to the selected characters, FR32) with the selected text, as one undo step ("Add underline", "Add strikethrough"); the tool stays armed. A press away from text, or a drag that selects nothing, adds nothing; Esc while dragging cancels. An underline runs along each quad just below the baseline (12 % up its height), a strikethrough through the middle of the lower case letters (45 %); red, 1 pt (D3). Layer 2 lists "Underline: …" / "Strikethrough: …" with the text.
4. **Image-only pages:** the slot (its button and its menu) is disabled on an image-only page, its tooltip saying "This page is an image: it has no text to mark".
5. **Editing:** the markups work with Select (hit inside their glyph boxes), move, nudge, delete, copy / paste, group, order, lock; resize and rotate transform the boxes (they no longer follow the text then, D2); no vertex handles.
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/search.pdf`: Underline across "ROOM" to "101" marks "ROOM 101"; Strikethrough from the menu across "CH +2700"; each one undo step; on page 2 (image-only) the slot is disabled with its tooltip.

## Tasks / Subtasks

- [x] **Task 1: Core** — `underline` / `strikethrough` schemas (quads, text); core/markup/text-select.ts (nearest character, whole words, quads, the lines); hits; unit tests.
- [x] **Task 2: Viewer** — tools `underline`, `strikethrough` (markup tools, text cursor); the input's drag (as a stroke, no Shift); the engine reads the page's text in user space once a page and passes it to the painter's `textMark`.
- [x] **Task 3: Editor** — text-mark-tool.ts (the drag, the selection preview, committing, painting, labels); no vertex handles; rail slot disabled on image-only pages; hints; unit tests.
- [ ] **Task 4: Tests** — `e2e/text-markup.spec.ts` (AC 6), in CI.

## Dev Notes

- The worker's text items have quads in the viewer's page space; the engine converts them to user space with `pageToUser` and keeps them per page until the document changes.
- Characters within an item are taken as sharing its advance evenly (as search highlights do): proportional fonts give approximate cuts inside an item; whole words keep the error at the words' ends small.
- Defaults chosen here, to confirm with the founder: the tools select text themselves (D1); a resized or rotated text markup is transformed as a shape (D2); red 1 pt (D3); no keys, one shared slot (D4).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.9], FR32
- [Source: _bmad-output/implementation-artifacts/3-6-search-text.md] (page text)
- [Source: _bmad-output/implementation-artifacts/5-8-image-and-dimension-markups.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `underlineMarkupSchema` / `strikethroughMarkupSchema` (4n points, up to 10 000 quads; optional plain `text`), `TextMarkMarkup`, `isTextMarkMarkup`; `charNear`, `wordSelection` (whole words, not past a space it ends on), `selectionQuads` (search's `matchQuads`), `selectionText`, `decorationLines`, `quadsOf`; hit inside any quad. Unit tests.
- Task 2: `TextMarkTool` / `isTextMarkTool`; the `text` cursor; Underline / Strikethrough use the stroke's drag with Shift ignored; `ViewerEngine.inkTool` routes them to the painter's `textMark` with `userText(page)` (a `render.text` request, cached, cleared with the document; asked for when the tool is armed; a drag in progress is moved again when it arrives).
- Task 3: `textMarkDrag` (start on text or nothing; moves keep `Drawing.quads` / `selected`; end adds the markup), `paintTextMark`, `paintTextMarkActive`, `textMarkLabel`; measure-tool wires them into layers 2 and 3 and ignores clicks; rail slot "Text markup" (Underline, Strikethrough) with `unavailable` on image-only pages; hints.
- Unit tests: 1870 pass. Local e2e not run (Docker off); CI runs `e2e/text-markup.spec.ts`.

### File List

- src/core/schema/markup.ts, src/core/markup/text-select.ts (new), text-select.test.ts (new), geometry.ts
- src/features/viewer/viewer-store.ts, index.ts, viewer-input.ts, viewer-input.test.ts, viewer-engine.ts, markup-layer.ts
- src/features/editor/text-mark-tool.ts (new), text-mark-tool.test.ts (new), measure-tool.ts, editor-store.ts, undo-store.ts, handles.ts
- src/features/workspace/tool-rail.tsx, workspace-shell.test.tsx
- e2e/text-markup.spec.ts (new)
