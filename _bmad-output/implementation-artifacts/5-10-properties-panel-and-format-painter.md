# Story 5.10: Properties panel and format painter

Status: review

## Story

As a drafter,
I want to edit markup properties and copy formatting,
so that markups match company standards.

## Acceptance Criteria

1. **Panel:** `Alt+P` (or the left rail) opens Properties: with nothing selected it says "Nothing selected"; with a selection it shows a dense form (label left, field right, UX-DR22) headed by the markup's subject (or "n markups") and the Copy format button.
2. **Fields:** Subject (a markup's own, else its type's name; D4), Colour (palette of nine and a custom picker, D1), Fill with None (closed shapes and text boxes), Line width (pt), Opacity (%), Font size (text) / Caption size (measurements, dimensions) / Text size (both) in pt, and Text (one text markup). An image has only Subject and Opacity; a typewriter has no Line width. Numeric fields are NumberFields with units.
3. **Multi-selection:** only the fields every selected markup has are shown (Text only for one); a value they do not share is blank (Subject "Mixed"); a change sets it on all of them.
4. **Applying:** a change applies at once (Enter or leaving a text or number field; a swatch click; the custom picker when it closes) as one undo step named for the field ("Change colour", "Change line width", "Change fill", "Change opacity", "Change text size", "Change subject", "Edit text"); locked markups keep their properties (the panel says so; a locked-only selection gets the locked note).
5. **Format painter:** Copy format (one markup or one group selected) takes its style (colour, width, fill, opacity, text size; not its subject or text, D2); the panel says "Click a markup to apply the format. Esc cancels."; a click with Select on a markup applies the style to it (and its group, not locked ones) as one undo step ("Apply format") and puts the painter away (D3: one use, as Revu's single click); Esc, a click on empty space, the button again, another tool or document put it away unused.
6. **Layer:** the layer field comes with layers (Story 5.12, D5).
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: Alt+P on a selected rectangle, Line width 6 and Colour Blue turn its stroke blue, each one undo step; Copy format then a click inside a second rectangle turns it blue ("Apply format", one step).

## Tasks / Subtasks

- [x] **Task 1: Core** — optional `subject` on every markup (200 characters); core/markup/properties.ts (each type's fields, shared fields and values, the size label, applying a change, the format); unit tests.
- [x] **Task 2: Editor** — properties.ts (`changeProperties` one undo step, locked kept; the format painter store, `copyFormat`, `dropFormat`, `paintFormat` from Select's press; Esc and tool / document changes put it away); unit tests.
- [x] **Task 3: Panel** — properties-panel.tsx in the left panel's Properties slot; component tests.
- [x] **Task 4: Tests** — `e2e/properties-panel.spec.ts` (AC 7), in CI.

## Dev Notes

- Fill applies to polygon, rectangle, ellipse, cloud and the frames of text box, callout and Cloud+ (they are painted with the shape stroke); an area stays unfilled (Story 4.8 D6).
- Opacity 100 % and fill None remove the fields, so a markup returns to the stored form it had.
- Defaults chosen here, to confirm with the founder: D1 a palette of nine (red, orange, yellow, green, cyan, blue, magenta, black, white) plus a custom picker; D2 the format is the style only; D3 the painter applies once (no sticky mode yet); D4 the subject defaults to the type's name and is not shown on the canvas yet; D5 the layer field waits for Story 5.12.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.10], FR34, UX-DR22
- [Source: _bmad-output/implementation-artifacts/5-3-group-align-order-and-lock.md] (locked markups)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `subject` (optional, `MAX_SUBJECT_LENGTH` 200); `fieldsOf`, `sharedFields`, `sharedValue`, `sizeLabel`, `subjectOf`, `withChange` (same object when nothing changes), `formatOf`, `withFormat`. Unit tests.
- Task 2: `changeProperties`, `selectedMarkups`, `formatPainter`, `copyFormat`, `dropFormat`, `paintFormat` (called by `selectGesture` on a press); the measure painter's Esc puts the painter away before clearing the selection. Unit tests.
- Task 3: `PropertiesPanel` (ColorSwatchGroup, NumberField, text fields committed on Enter / blur, Esc reverts); the custom colour commits on the native change event so a picker drag is one step.
- Unit tests: 1884 pass. Local e2e not run (Docker off); CI runs `e2e/properties-panel.spec.ts`.

### File List

- src/core/schema/markup.ts, src/core/markup/properties.ts (new), properties.test.ts (new)
- src/features/editor/properties.ts (new), properties.test.ts (new), properties-panel.tsx (new), properties-panel.test.tsx (new), select-tool.ts, measure-tool.ts, index.ts
- src/features/workspace/workspace-shell.tsx
- e2e/properties-panel.spec.ts (new)
