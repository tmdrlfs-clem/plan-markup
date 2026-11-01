# Story 5.4: Line, arrow, polyline and polygon tools

Status: ready-for-dev

## Story

As a drafter,
I want straight-line markups,
so that I can draw pipework and outlines.

## Acceptance Criteria

1. **Tools and keys:** Line (`L`), Arrow (`A`), Polyline (`Shift+N`) and Polygon (`Shift+P`) arm from the keyboard (canvas focused, never in a field) and from one Tool rail slot with a menu (D4, like Measure); the HintBar says how each works; the cursor is a crosshair.
2. **Drawing:** Line and Arrow: two clicks add the markup. Polyline: each click adds a vertex, a double-click or `Enter` finishes (at least 2). Polygon: the same, at least 3, a click on the first vertex closes it. Points snap to the drawing (`Alt`: off), `Shift` constrains to 0° / 45° / 90° from the last point; `Backspace` and `Ctrl+Z` remove the last point; `Esc` cancels the drawing, `Esc` again returns to Select. The tool stays armed after each markup (FR31, UX-DR35). A rubber band follows the pointer; there is no live value (D6).
3. **Markups:** each type has a Zod schema (`line`, `arrow`: 2 points; `polyline`: 2+; `polygon`: 3+) and a renderer: a stroke in the markup's colour and width (page units); an arrow has a filled head at its end point sized from its width (D1); a polygon is closed, unfilled. Default style red, 1 pt (D5). Adding one is one undo step ("Add line", "Add arrow", "Add polyline", "Add polygon").
4. **Editing:** the new markups work with Select as the others do (Stories 5.1–5.3): hit on their stroke (a polygon also inside, D2), marquee / lasso, move, nudge, delete, resize / rotate / vertex handles (a line has no box handles), copy / paste, group, order, align, lock. A polygon may cross itself (D3). They are not measurements: no caption, not in the Measurements panel.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: `L` draws a line along the rectangle's bottom edge (snapped), `A` an arrow, `Shift+N` a 3-vertex polyline finished with Enter, `Shift+P` a polygon closed on its first vertex; each one undo; Backspace removes a point; Esc cancels then returns to Select; a click selects the line.

## Tasks / Subtasks

- [ ] **Task 1: Core** — schemas for `line`, `arrow`, `polyline`, `polygon`; hit tests (polygon inside); unit tests.
- [ ] **Task 2: Viewer** — the markup tools as draw tools (snapping, clicks, Enter / Backspace / double-click / Esc, crosshair); keys `L`, `A`, `Shift+N`, `Shift+P`.
- [ ] **Task 3: Editor and rail** — drawing, committing and painting the new types (the arrow head); the rail's line slot with its menu and hints; unit tests.
- [ ] **Task 4: Tests** — `e2e/line-tools.spec.ts` (AC 5).

## Dev Notes

- The measuring tools' drawing (measure-tool.ts: `Drawing`, place / finish / Backspace / Esc, snapping in the engine) is reused: the viewer's "draw tools" are the measuring tools plus these four. The Scale prompt stays with measuring tools only.
- `paintStatic` returns, besides captions, one label per shape ("Line", "Arrow", "Polyline", "Polygon") in drawing order, so `data-captions` keeps showing what is on the page (e2e, diagnostics).
- Defaults chosen here, to confirm with the founder: the arrow head is a filled triangle at the end point, its length 6× the line width (at least 6 pt), page units (D1); an unfilled polygon is hit inside as well as on its edges, like Area (D2); a polygon may cross itself (D3); Line, Arrow, Polyline and Polygon share one rail slot with a menu (D4); markups are red, 1 pt until Properties lets them change (D5); no live value while drawing (D6).
- Revu behaviour (official help: Line, Arrow, Polyline, Polygon tools): the same keys and clicks.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.4], FR31, UX-DR35
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Keyboard Shortcuts]
- [Source: _bmad-output/implementation-artifacts/5-3-group-align-reorder-and-lock.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

### File List
