# Story 4.8: Area and count measurements

Status: ready-for-dev

## Story

As a drafter,
I want to measure areas and count items,
so that I can quantify rooms and devices.

## Acceptance Criteria

1. **Area** (ToolRail, or `Shift+Alt+A`): each click adds a vertex with the 4.1 snapping and the 4.3 R1 rules (glyph, `Shift` 0/45/90° from the last vertex, `Alt` off); while drawing, the polygon so far, the rubber band to the tool point and the closing edge back to the first vertex are drawn, with the **live area** beside the pointer (FR26).
2. **Finishing an area:** a double-click, `Enter`, or a click on the first vertex closes it when it has at least three vertices; it is one undo step ("Add area"); the tool stays armed. `Backspace` / `Ctrl+Z` remove the last vertex ("Undo Area point"), `Esc` cancels (Esc again: Select), another tool, page or tab cancels (as 4.6). A polygon that **crosses itself** is not added: the live value turns to "Crosses itself" in the warning colour and finishing says so in the HintBar.
3. **Area values** come from `src/core/measure/area.ts`: the area of the outer ring less its holes, with the page calibration's separate X / Y factors and UserUnit, in m² (metric display units) or ft² (imperial), two decimals; the perimeter of the outer ring in the calibration's unit and precision (the same text a polylength around it would show). Unit-tested: rectangles, holes, X ≠ Y factors, UserUnit, self-intersection rejection (crossing, touching, collinear overlap, fewer than three distinct points, zero area).
4. **Area caption:** two lines at the polygon's centroid, horizontal on screen: the area, then "P " and the perimeter ("Scale not set" in the warning colour without a calibration). It moves with Shift + drag like the 4.6 captions. The outline is drawn in the measure style (no fill). `holes` exist in the schema and the core (Story 4.10 and Epic 5 add the cutout tools); the painter draws them.
5. **Count** (ToolRail, or `Shift+Alt+C`): each click places a marker (no snapping: a count marks where it is clicked); all markers of one count are **one markup** with the count as its value; the running count shows beside the pointer. `Enter`, a double-click, `Esc`, another tool, page or tab **finish** the count (it keeps its markers: nothing clicked is lost) as one undo step ("Add count"); `Backspace` / `Ctrl+Z` remove the last marker ("Undo Count point"). Count needs no scale: it never shows the 4.7 prompt; its caption (the total) sits beside the first marker and moves with Shift + drag.
6. Area prompts for a scale like Length (4.7 `needsScale`); Count does not.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` covers: Area from `Shift+Alt+A` and the ToolRail around the rectangle (200 × 150 pt at 1:100 → 37.34 m², P 24694 mm), the live area, finishing by Enter, by a double-click and by clicking the first vertex, a crossing polygon refused, undo / redo; Count from `Shift+Alt+C` with 4 clicks → "4", Esc keeping it, Backspace, undo; no scale prompt with Count on an uncalibrated page.

## Tasks / Subtasks

- [ ] **Task 1: Core** — `src/core/measure/area.ts` (area with holes, perimeter, centroid, self-intersection, `formatArea`, captions), `area` and `count` in the markup schema; unit tests.
- [ ] **Task 2: Area tool** — viewer tool `area` (snapping, crosshair), painter: outline, live polygon, caption at the centroid (two lines, hit box), first-vertex close, crossing refusal with the HintBar; `Shift+Alt+A`, ToolRail Area live and hint; unit tests.
- [ ] **Task 3: Count tool** — viewer tool `count` (no snapping), markers, running count, finish-not-cancel rules, caption; `Shift+Alt+C`, ToolRail Count live and hint; `needsScale` excludes Count; unit tests.
- [ ] **Task 4: Tests** — `e2e/measure-area-count.spec.ts` (AC 7); local L17 check (an area on a known room reads its printed size if one is marked; otherwise a rectangle of two printed dimensions).

## Dev Notes

- Reuse the 4.5 / 4.6 editor foundation: `measure-tool.ts` (one painter for every measuring tool), `executeOp`, `registerDrawingUndo`, caption drag (`captionOffset`), the viewer's `MarkupPainter` (`place`, `finish`, `removeLastPoint`, `escape`).
- Defaults chosen here, to confirm with the founder: area in m² / ft² with two decimals (D1); a click on the first vertex closes an area (D2); crossing polygons refused (D3); a count is finished, not cancelled, by Esc and by leaving the tool (D4); the count's caption beside its first marker (D5); areas without fill (D6); cutout tools later (D7); Count markers do not snap (D8).
- Revu behaviour (official help: Area measurement, Count measurement): click vertices, double-click or Enter closes an area; Count places a symbol per click, all one count measurement.
- Clean-room: behaviour from official Revu help and user observation only.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.8], FR26
- [Source: _bmad-output/implementation-artifacts/4-6-polylength-and-measurement-captions.md], [4-7-prompt-for-scale-and-never-show-unscaled-numbers.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-11-01: Story 4.8 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
