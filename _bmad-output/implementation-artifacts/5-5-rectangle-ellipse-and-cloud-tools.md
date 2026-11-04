# Story 5.5: Rectangle, ellipse and cloud tools

Status: in-progress

## Story

As a drafter,
I want box, ellipse and revision cloud markups,
so that I can highlight areas of change.

## Acceptance Criteria

1. **Tools and keys:** Rectangle (`R`), Ellipse (`E`) and Cloud (`C`) arm from the keyboard (canvas focused, never in a field) and from their own Tool rail buttons in the Markup group (D4); the HintBar says how each works; the cursor is a crosshair.
2. **Drawing:** Rectangle and Ellipse: press and drag from one corner to the opposite one, or click the two corners; the ellipse fills the box. Cloud: each click adds a corner; a double-click, `Enter` or a click on the first corner closes it (at least 3). Points snap to the drawing (`Alt`: off), `Shift` holds 45° steps from the first corner (a square / circle on the diagonal); `Backspace` and `Ctrl+Z` remove the last point; `Esc` cancels, `Esc` again returns to Select. A box with no width or height adds nothing. The tool stays armed (FR31, UX-DR35). A rubber band shows the shape; there is no live value.
3. **Markups:** Zod schemas `rectangle` and `ellipse` (4 points: the box's corners in order, so a rotated or skewed box stays exact) and `cloud` (3+ corners). The style gains optional `fill` (#rrggbb; absent: none) and `opacity` (0–1; absent: 1), the defaults red stroke, 1 pt, no fill, 100 % (D5). Renderers: the rectangle's outline; the ellipse inscribed in its box; the cloud's outline as outward arcs whose size is fixed in page units (D1: about 9 pt chords), recomputed at every zoom (FR31). A fill fills the closed shape under the stroke; the opacity applies to the whole markup. Adding one is one undo step ("Add rectangle", "Add ellipse", "Add cloud").
4. **Editing:** the new markups work with Select like the others (Stories 5.1–5.3): hit on the outline or inside (D2, as Polygon), marquee / lasso, move, nudge, delete, resize / rotate, copy / paste, group, order, align, lock; a cloud has vertex handles, a rectangle or ellipse only the box's (D3). Not measurements: no caption, not in the Measurements panel; layer 2 lists "Rectangle", "Ellipse", "Cloud".
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: `R` drags a rectangle over the drawn one (snapped corners), `E` an ellipse by two clicks, `C` a cloud closed on its first corner; each one undo step; a click inside selects the rectangle; Esc cancels, Esc again returns to Select.

## Tasks / Subtasks

- [ ] **Task 1: Core** — schemas (`rectangle`, `ellipse`, `cloud`; style `fill`, `opacity`); ellipse frame, bounds, outline and hits; cloud arcs; unit tests.
- [ ] **Task 2: Viewer** — tools `rectangle`, `ellipse`, `cloud` as draw tools; keys `R`, `E`, `C`; press-drag-release for the box tools.
- [ ] **Task 3: Editor and rail** — drawing, committing and painting (fill, opacity, cloud arcs, ellipse); no vertex handles on boxes; the Markup group's buttons live with their hints; unit tests.
- [ ] **Task 4: Tests** — `e2e/shape-tools.spec.ts` (AC 5).

## Dev Notes

- The box is stored as its four corners (not x/y/width/height): moves, resizes and rotations (Story 5.2's point transforms) keep it exact with no new transform code; an ellipse is the affine image of the unit circle in its box.
- The draw tools of Story 5.4 are reused (measure-tool.ts): Rectangle and Ellipse are fixed two-point tools whose markup expands the two corners; Cloud is closed like Polygon.
- Defaults chosen here, to confirm with the founder: cloud arc chord 9 pt page units, arcs bulge outward (D1); a shape is hit inside as well as on its outline (D2); a rectangle / ellipse has no vertex handles (D3: a corner drag would skew it); Rectangle, Ellipse and Cloud keep their own rail buttons in the Markup group (D4, they were already laid out there); red 1 pt, no fill, opacity 100 % until Properties changes them (D5); Shift on the diagonal gives a square / circle (D6, Shift's 45° steps; Revu's Shift is the same).
- Revu behaviour (official help: Rectangle, Ellipse, Cloud tools): the same keys, click-drag or click-click.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.5], FR31, UX-DR35
- [Source: _bmad-output/implementation-artifacts/5-4-line-arrow-polyline-and-polygon-tools.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

### File List
