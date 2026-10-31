# Story 4.11: Measurements panel

Status: done

## Story

As a drafter,
I want totals of my measurements in one place,
so that I can read quantities without adding them up.

## Acceptance Criteria

1. **Panel:** Measurements (left rail, `Alt+U`, View/Window menus: already registered) lists the active document's measurements on every page, **grouped by type** in the measure menu's order (Length, Polylength, Area, Count, Angle, Radius, Diameter; a Dynamic fill is an Area). Each group header shows its name, its number of measurements and its **total** (FR30, UX-DR20):
   - Length, Polylength: the sum of lengths; Radius, Diameter: no total (a sum of radii means nothing), the header shows the number only (D2);
   - Area: the sum of areas (holes subtracted) in m² or ft²; Count: the sum of markers; Angle: no total (D2).
2. **Rows:** one per measurement in page order then drawing order: the page (sheet label when known, else "Page n") and its value as its caption shows it in the chosen units (Area: area only, the perimeter in the row's tooltip). Values update live as measurements are added, undone, redone or the page is calibrated.
3. **Units:** a units select in the panel header (mm, m, in, ft-in) converts every row and total; it starts at the active page's calibration unit (else the first calibrated page's, else m) (D4). Precision follows the active page's calibration when it is in the chosen unit, else a default per unit (mm 0, m 0.00, in 0.0, ft-in 1/8). Areas: m² for metric units, ft² for imperial (4.8 D1).
4. **Scale not set:** a measurement on a page without a calibration shows "Scale not set" and is left out of its group's total; the header then says "n not scaled" (D3). Counts and angles need no scale.
5. **Click a row:** shows its page, zooms so the measurement fits in view with a margin (never zooming in past 400 %, never zooming out of a view that already shows it in full) and **selects** it: the row is marked selected and the markup gets the selection outline (accent outline with a white halo, UX-DR13; handles come with 5.1). `Esc` on the canvas with Select, arming another tool, switching tabs or the measurement going away clears the selection (D5). Rows are keyboard reachable (Tab; `Enter` / `Space` activate; `↑` / `↓` move between rows).
6. **Empty states:** no drawing open → "No drawing open"; a drawing without measurements → "No measurements yet" with a hint naming the measure tools ("Measure with Length, Polylength, Area, Count, Angle, Radius, Diameter or Dynamic fill from the tool rail.").
7. **Core:** the values and totals are computed in `src/core/measure/totals.ts` (framework-free), unit-tested: per-type values, totals, unscaled exclusion, unit conversion, user units, holes, bounds of each markup type.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` at 1:100: two lengths and an area → `Alt+U` shows Length (2) with their sum and Area (1) 37.34 m²; switching to m converts; clicking a row selects it (aria-selected); undo removes a row; a document without measurements shows the empty state.

## Tasks / Subtasks

- [x] **Task 1: Core** — `src/core/measure/totals.ts`: `measurementValue`, `measurementGroups`, `formatGroupTotal`/row text, `markupBounds`; unit tests.
- [x] **Task 2: Viewer** — `revealUserRect(page, rect)` on the engine (user space → page space, fit with margin, the zoom rules of AC 5) through `viewerCommands.revealMarkup`; the markup layer paints a selection outline for the editor's selected ids (the painter's job: `paintStatic`).
- [x] **Task 3: Panel** — `src/features/editor/measurements-panel.tsx` mounted by `LeftPanelBody`; units select (session store); selection in the editor store's `selection` slice; clearing rules (AC 5); unit tests (React Testing Library).
- [x] **Task 4: Tests** — `e2e/measurements-panel.spec.ts` (AC 8).

## Dev Notes

- The editor store already has the `selection` slice (`{ ids }`, Epic 5): this story is its first writer. Selection editing (move, delete, handles, marquee) stays in 5.1.
- Calibrations are by stable page id in `viewerStore.calibrations`; page sizes (and `userUnit`) in `viewerStore.pages`; sheet labels in `sheetLabels` / `pageLabels` (the Thumbnails panel's label rules: reuse its helper).
- Captions and the panel must agree (NFR8): rows use the same rounding (`formatMeasured`, `formatArea`) as the captions; totals sum the unrounded values, then round once.
- Defaults chosen here, to confirm with the founder: the panel lists every page of the active document (D1); Angle, Radius and Diameter groups show a number, not a total (D2); unscaled measurements stay listed but out of totals (D3); the units select starts at the active page's calibration unit, kept for the session (D4); a row click selects and fits it, Esc / another tool / tab clears (D5); the selection outline is 5.1's look ahead of its handles (D6).
- Revu behaviour (official help: Measurements panel): measurements listed with totals per type; selecting a row selects the markup on the page.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.11], FR30, UX-DR20, UX-DR13
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] MeasurementsPanel
- [Source: _bmad-output/implementation-artifacts/4-8-area-and-count-measurements.md], 4-9, 4-10

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- `core/measure/totals.ts`: per-type values (the captions' functions underneath, NFR8), groups in the measure menu's order, totals summed unrounded and rounded once, unscaled rows counted and left out, radius / diameter / angle groups without a total (D2), bounds per type (a circle's whole circle).
- Precision: the active page's when its calibration is in the chosen unit; otherwise mm 0, m 0.00, in 0.0, ft-in 1/8 (a 0 mm precision would show 3 m for 2.54 m).
- The viewer: `revealUserRect` (user → page space, at least 72 pt a side, HIT_MARGIN, zoom up to the fit but not past 400 %, never down while already in view) via `viewerCommands.revealMarkup`; `LayerView.colors.selection` (the accent token).
- The editor: `setSelection`, the first writer of the `selection` slice; the measure painter strokes the selection outline (white halo, accent) 4 CSS px around the markup; Esc with Select on the canvas, arming another tool, another tab / document, or the measurement going away (undo) clears it.
- Panel: `MeasurementsPanel` (listbox of groups; one tab stop, ↑ / ↓ / Home / End, Enter / Space), units select kept for the session (D4), "Page n" or the sheet label, the area's perimeter in the row tooltip.
- Local: e2e on snap.pdf at 1:100 — Length (2) 12347 mm, Area (1) 37.34 m², m → 12.35 m, row click fits the rectangle at 240 % and selects it (screenshot fixtures/private/traces/4-11-panel.png, not committed). Unit 153 files / 1745 tests; related e2e 15 passed.

### Review (self, adversarial)

- R1 (fixed): a row clicked while a measuring tool was armed selected a markup under a live tool; the row click now switches to Select first.
- R2 (fixed): three points in a line (no circle) were counted as "not scaled"; only rows without a scale are.
- Checked, no change: a page id of another document or out of range is left out; a reveal on a page that cannot be shown does nothing; Esc in a field, menu or dialog does not clear the selection; the fill session never lists (it is not a markup until Enter).

### File List

- src/core/measure/totals.ts, totals.test.ts (new)
- src/features/editor/measurements-panel.tsx, measurements-panel.test.tsx (new)
- src/features/editor/editor-store.ts, measure-tool.ts, measure-tool.test.ts, index.ts, fill-tool.test.ts
- src/features/viewer/viewer-engine.ts, viewer-commands.ts, viewer-input.ts, viewer-input.test.ts, markup-layer.ts
- src/components/ui/tokens.ts, viewer-palette.test.ts
- src/features/workspace/workspace-shell.tsx
- e2e/measurements-panel.spec.ts (new)
