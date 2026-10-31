# Story 4.9: Angle, radius and diameter measurements

Status: in-progress

## Story

As a drafter,
I want angle, radius and diameter tools,
so that I can measure splays and round elements.

## Acceptance Criteria

1. **Angle** (ToolRail): three clicks, the start of the first leg, the vertex, the end of the second leg (Revu's order), with the 4.1 snapping and the 4.3 R1 rules (Shift 0/45/90° from the last point, Alt off); the third click adds it as one undo step ("Add angle"). While drawing, the legs so far and the rubber band are drawn with the **live angle** beside the pointer. The value is the angle between the legs, 0°–180°, in degrees with one decimal ("90.0°") (FR26).
2. **Radius** and **Diameter** (ToolRail): three clicks on the circle (any three points of a drawn circle or arc; the snapping's on-line / endpoint points find them); the third click adds it ("Add radius", "Add diameter"). With two points placed, the circle through them and the tool point is drawn live with its value. Three points in a line make no circle: the live value says "Points in a line" in the warning colour and the third click there adds nothing (the HintBar keeps the tool's instructions).
3. **Same rules as Length** (4.5 / 4.6): the tool stays armed; `Backspace` / `Ctrl+Z` remove the last point ("Undo Angle point" / "Radius point" / "Diameter point"), `Esc` cancels (Esc again: Select), another tool, page or tab cancels; captions move with Shift + drag; session restore and undo work as for the other measurements.
4. **Values** come from `src/core/measure/angle.ts` and `src/core/measure/circle.ts` (framework-free, unit-tested):
   - the angle is measured in real space: each leg is scaled by the page calibration's X / Y factors first (with equal factors, or no calibration, it is the angle on paper); UserUnit does not change an angle;
   - the circle is the circumcircle of the three points in user space; the radius is the real length from its centre to the first point (`measureLength`, X / Y factors, UserUnit), the diameter twice that; shown in the calibration's unit and precision as "R 4410 mm" and "Ø 8819 mm"; "Scale not set" in the warning colour without a calibration.
   - Unit tests: right, acute, obtuse, straight and zero angles, X ≠ Y factors; circle through three points, collinear and repeated points refused, UserUnit, X ≠ Y factors.
5. **Drawing:** an angle is its two legs with a small arc at the vertex; its caption sits inside the angle along the bisector, horizontal. A radius is the circle and a line from the centre to the first point, the caption along that line; a diameter is the circle and the line through the centre from the first point to the opposite side, the caption along it. No fill.
6. **Scale:** Radius and Diameter prompt for a scale like Length (4.7 `needsScale`); Angle does not (it needs none).
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` (the rectangle (100, 100)-(300, 250)) covers: Angle at a corner of the rectangle = "90.0°" on the uncalibrated page with no scale prompt; at 1:100, Radius through three corners = "R 4410 mm" and Diameter = "Ø 8819 mm" (the circle's diameter is the rectangle's diagonal, 250 pt); three points in a line refused; Backspace, Esc, undo / redo.

## Tasks / Subtasks

- [x] **Task 1: Core** — `angle.ts` (angle between legs under X / Y factors, `formatAngle`, bisector), `circle.ts` (circumcircle, collinear check, radius / diameter in mm, captions); `angle`, `radius`, `diameter` markups (exactly three points, `captionOffset`) in the schema; unit tests.
- [x] **Task 2: Tools** — viewer tools `angle`, `radius`, `diameter` (snapping, crosshair); the measure painter draws them (legs + arc, circle + radius / diameter line, captions and hit boxes, live values, "Points in a line" refusal); commit on the third click; undo labels; `needsScale` excludes Angle; ToolRail entries live with hints; unit tests.
- [ ] **Task 3: Tests** — `e2e/measure-angle-circle.spec.ts` (AC 7).

## Dev Notes

- Reuse `measure-tool.ts` (one painter for every measuring tool), `executeOp`, `registerDrawingUndo`, caption drag, the viewer's `MarkupPainter`. Length commits on its second click; these three on their third (a `MAX_POINTS` per tool, next to `MIN_POINTS`).
- The snapping has no circle-centre snap (types: endpoint, intersection, midpoint, perpendicular, on-line), so a circle is found by three points on it, not by its centre.
- With X ≠ Y factors a circle on paper is an ellipse in reality: the radius is taken to the first point (the one the drafter chose first); this is noted, not solved (separate X / Y scales are rare on plans).
- Defaults chosen here, to confirm with the founder: angles in degrees with one decimal, 0°–180° (D1); radius / diameter by three points on the circle (D2); captions "R …" / "Ø …" (D3); Angle needs no scale (D4); no keyboard shortcuts (the UX shortcut table lists none for these; Revu's are not confirmed) (D5); the angle's caption inside the angle at the vertex (D6).
- Revu behaviour (official help: Angle, Radius, Diameter measurements): angle by three points with the vertex in the middle; the values show in the Measurements panel (4.11).
- Clean-room: behaviour from official Revu help and user observation only.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.9], FR26
- [Source: _bmad-output/implementation-artifacts/4-8-area-and-count-measurements.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-11-01: Story 4.9 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
