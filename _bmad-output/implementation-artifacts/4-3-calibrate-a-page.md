# Story 4.3: Calibrate a page

Status: done

## Story

As a drafter,
I want to calibrate by ratio or by two known points,
so that every measurement is in real units.

## Acceptance Criteria

1. **Given** the CalibrateDialog (opened from the ScaleIndicator in the status bar or Document → Calibrate…), **when** I choose one of: **Use detected** ("Use detected 1:75 @ A1" — one button per distinct detected scale from 4.2, showing the effective ratio for this sheet), **By ratio** (e.g. 1:100, with an optional "@ sheet" qualifier converted like 4.2), or **By two points**, **then** the calibration applies (FR24, UX-DR18). Founder decision (2026-10-24): a detected scale is never applied without this dialog — the status bar only opens it.
2. **Two points:** the dialog collapses to a floating instruction bar ("Click the first point · Esc to cancel", then "Click the second point · Esc to cancel"); clicks use the 4.1 snap service (glyph shown, `Shift` constrains to 0/45/90°, `Alt` disables snap); a temporary dimension line is drawn on the active overlay; after the second click the dialog returns asking the real distance and unit (mm, m, in, ft, ft-in input like `12'-6"`); zero-length or < 10 CSS px picks are rejected with an inline message.
3. **Options:** apply to current page / page range (e.g. "1-3, 5") / all pages; optional separate Y scale (collapsed "Different vertical scale" section); display units (mm, m, in, ft-in) and precision (0, 0.0, 0.00, 1/8", 1/16") — unit/precision defaults remembered per user. Page-size mismatches across a range are handled: a ratio applies per page as a ratio; a two-point calibration applies the same pt→real factor (state this in the dialog when the range has different sheet sizes).
4. **Model:** calibration is held per stable page id in the document state (AR8; use the existing stable page id if one exists, otherwise introduce `pageId = sha256 + page index` with a TODO linking A2 page edits) as a pure value `{ xFactor, yFactor, unit, precision, source: 'detected'|'ratio'|'points', ratio?, sheet? }` in `src/core/calibration/` (framework-free, Zod schema shared with later persistence; unit-tested conversions pt ↔ real for every unit, ft-in parsing/formatting, rounding). Persistence with the markup set comes in Epic 6 — keep it in memory per tab now (session survives tab switches, not reloads; record it).
5. **Status bar:** after calibration the ScaleIndicator shows `✓ Scale 1:100` in the success colour with icon (or `✓ Calibrated` + factor tooltip for a two-point calibration that is not a round ratio; separate X/Y shows both); cursor X/Y (3.7) switches to real units with the chosen precision. Uncalibrated pages keep their 4.2 state.
6. **Conflicting printed scales** (founder decision 2026-10-24, 4.2 review item): when a page states the same view at two sheet sizes that disagree (L21: "1 : 75 @ A1 1 : 200 @ A3" — 1:75 on A1 is 1:150 on A3), the dialog's Use-detected section shows a warning ("Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed") with both options; the detection itself is fixed in the 4.2 review.
7. **Undo:** applying a calibration is one undo step (`Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`). If no undo stack exists yet, introduce the minimal command-object undo stack per architecture (zustand vanilla store, per document/tab, `{ do, undo, label }`) in a way Story 4.5 (editor foundation) extends rather than replaces; record the design.
8. **First use tip** (UX-DR16): the first time a user opens Calibrate, one dismissible inline tip shows inside the dialog (no tour), via a reusable first-use tip helper (per user, persisted like other per-user prefs) that Tool Chest and 4541 will reuse.
9. Accessibility: dialog is Story 1.7 `Dialog` with labelled fields, Enter applies, Esc cancels (and Esc in the collapsed picking bar cancels picking and restores the dialog); the instruction bar is announced politely; all numbers use tabular figures.
10. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on committed fixtures (`fixtures/pdf/scales.pdf` from 4.2, `fixtures/pdf/snap.pdf` from 4.1) covers: open from status bar, use detected, by ratio with sheet qualifier, two-point with snap and typed distance in m and ft-in, page range, success state text, cursor in real units, undo/redo, conflicting-scale warning, first-use tip shown once.

## Tasks / Subtasks

- [x] **Task 1: Core calibration** — `src/core/calibration/` model, Zod schema, conversions, unit/ft-in parsing and formatting, range parsing; unit tests.
- [x] **Task 2: Undo stack** (if absent) — minimal command stack per AC 7; keyboard bindings with canvas/workspace focus rules from 3.x.
- [x] **Task 3: CalibrateDialog + picking mode** — dialog, collapsed instruction bar, two-point picking with snap/overlay, distance entry, options, first-use tip helper.
- [x] **Task 4: Wiring** — ScaleIndicator opens dialog; Document → Calibrate menu item; per-tab calibration state; status-bar success state; cursor real units; conflicting-scale warning (uses the fixed 4.2 detection data).
- [x] **Task 5: Tests** — unit + `e2e/calibrate.spec.ts`; local L17/L21 check (calibrate L21 from detected 1:75 @ A1 and by two points on a known dimension, e.g. a "1905" dimension on L17 → cursor/readout consistent); screenshots `fixtures/private/traces/4-3-calibrate-dialog.png` and `4-3-calibrated.png` (never commit private files).

### Review Follow-ups (AI)

Adversarial review 2026-10-25 (Claude Opus 5.5) of db23977..cbd0f04. Checked: coordinate spaces of the pick and the readout (user space points, MediaBox / CropBox origin through `fromPageCorner`, UserUnit on the pick distance and on the ratio factor, /Rotate, view rotation); unit conversion and parsing (mm, m, in, ft, ft-in, fractions, rounding of the shown lengths); the ratio and range parsers; `calibrationsFor` on mixed sizes; the undo stack and its per-tab store (tab switch, close, retry); the dialog's state across sessions, picks, page and tab changes; the first-use tip; keyboard (Enter, Esc, undo keys in fields and dialogs); AC coverage of the tests. Founder decisions 2026-10-25 applied: (1) a separate vertical scale stays tied to the page's axes when the view is rotated (current behaviour; see R2 for the page's own /Rotate); (2) Calibrate… stays in both the Document and Tools menus; (3) the L17 / L21 set is 1:75 — the "1:200 @ A3" label is a drafting error and the mismatch warning is right.

- [x] **[High] R1: A Shift-held point is placed at the raw pointer.** With Shift and no snap hit (or Alt + Shift) the cursor and the status bar show the point held to the 0 / 45 / 90° direction, but `snapClick` (and the rubber band, and 4.5's `getSnappedPoint`) used the raw `cursorPoint()`: the second calibration point was off the constrained line, so the picked distance was wrong (AC 2). Fix: the engine keeps the point the tools place (`toolPoint`: snapped, else Shift-held, else raw), set with the status bar's point; the click, the rubber band and `getSnappedPoint` use it.
- [x] **[Medium] R2: A separate vertical scale lands on the drawing's horizontal on a /Rotate 90 / 270 page.** X / Y were PDF user space axes, which on a page turned by its own /Rotate are the other way round from the page as it reads (at view rotation 0). Fix: `calibrationsFor` puts the vertical ratio on the page's vertical as it reads (/Rotate applied, view rotation not: founder decision 1), and `calibrationLabel` / `scaleStateOf` name the factors "horizontal" / "vertical" as the page reads. Stored factors stay along user space x / y (the cursor readout's axes, 3.7).
- [x] **[Medium] R3: Opening Calibrate while picking leaves the engine picking.** The ScaleIndicator and the menus stay reachable while the dialog is collapsed; opening the dialog again reset its state but the engine kept the `calibrate` tool and its pick, and the old pick's late `done(null)` collapsed the next pick's bar. Fix: each pick has a token; opening, closing, cancelling or starting another pick abandons the one in progress (the engine cancels it, its callbacks are ignored).
- [x] **[Medium] R4: Paging while picking calibrates a page that is not shown.** PageDown or a thumbnail during the pick cancels it and brings the dialog back for the page it was opened on, while another page is shown: "This page (1)" then applied to the hidden page and a new pick measured the shown page for the other. Fix: while the dialog is open it follows the shown page; a pick from the previous page is dropped.
- [x] **[Low] R5: Try again keeps the tab's undo history.** Re-opening the tab's file starts without calibrations but Edit still offered "Undo Calibrate page 1". Fix: a new open in the same tab (`openSeq`) drops its history.
- [x] **[Low] R6: The first-use tip vanished after the first pick.** The dialog remounts after the collapse and the tip, already marked seen, did not show again within the same first session. Fix: `useFirstUseTip(id, session)` keeps a tip for the whole session it first showed in (until dismissed); without a session it behaves as before.
- [x] **[Low] R7: With metres as the display unit the distance unit defaulted to mm.** Fix: the distance is typed in the display unit (m → m).
- [x] **[Low] R8: Inches typed without the mark (`6 1/2`, `3/4`) were refused** with the distance unit "in". Fix: a bare mixed number or fraction in inches gets its inch mark.
- [x] **[Low] R9: A vertical ratio silently takes the ratio's sheet.** With "1:100 @ A1" and a vertical "1:50" the vertical is converted for A1 too (on A3 it is 1:100). Kept (one view is stated for one sheet) and now said under the field: "Stated for A1 like the ratio: 1:100 on this page".

Not defects (checked): pick distance and ratio factors on UserUnit pages (both in points with UserUnit applied, like the readout); the cursor readout on boxes not at the origin (L17, `fromPageCorner`); a zero-length pick (refused by the 10 px rule before `factorFromPoints`); undo keys in text fields and dialogs (inactive); the history of a closed tab (dropped); `parseRatioInput` connector words ("on A1", "at A3", "for ANSI D"); the Select listbox above dialogs (1.7 fix).

## Dev Notes

- Builds on 3.7 (ScaleIndicator, cursor readout, units formatter, page-size core), 4.1 (snap service, Length tool preview, Alt/Shift), 4.2 (detected scales per page). Read those story files including review follow-ups first.
- Viewport-level calibration (UX: "per viewport") is NOT in this story unless trivial — record as follow-up. The FR82 prompt is Story 4.7.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; success = green + icon, warning = yellow + icon; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; stop Supabase/Docker with their own commands; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3]; FR24, AR8, UX-DR16, UX-DR18
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] CalibrateDialog, first-run flow
- [Source: _bmad-output/implementation-artifacts/4-1-snap-to-drawing-linework.md], [4-2-detect-printed-scales.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Local: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 1595 unit tests in 139 files; e2e on the production build (`E2E_PROD=1`, workers 1): 48 passed, 10 skipped (opt-in private checks), `calibrate.spec.ts` 2 passed.
- First e2e run found a Story 1.7 defect: a `Select`'s listbox opened inside a `Dialog` sat under the dialog's overlay (`z-popover` 40 < `z-dialog` 50) and could not be clicked. Fixed with a `--z-dialog-popover` layer (55) for the listbox.
- Supabase on its default local ports (no Windows reservation this time); Docker Desktop started with `docker desktop start`.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-calibrate`; private, nothing committed):
  - **L21**: the ScaleIndicator reads "Scales disagree — Verify"; the dialog shows "Printed scales disagree: 1:75 @ A1 = 1:150 @ A3, but 1:200 @ A3 is printed" with "Use 1:75 @ A1 (1:75 on this page)" and "Use 1:200 @ A3 (1:100 on this page)"; the first gives "Scale 1:75". Screenshot `fixtures/private/traces/4-3-calibrate-dialog.png`.
  - **L17** (title block "As indicated", no printed scale): the "1905" dimension (text at user (-141.4, 100.7)) has its dimension line from (-169.01, 98.57) to (-97.01, 98.57): 72.0 pt = 25.4 mm of paper, so 1905 mm is 1:75. Two points snapped to its ends ("Picked: 25.4 mm on paper (72.0 pt)"), distance 1905 mm → "Scale 1:75"; the cursor readout at the two ends: X 27063 and X 28968 mm, **difference 1905 mm** (consistent). Screenshot `fixtures/private/traces/4-3-calibrated.png` (status bar: ✓ Scale 1:75, X 28968 Y 24881 mm).
- CI: run **40082428504** success (Tasks 1-5, 80b9ad1).

### Completion Notes List

- **Task 1 (core, `src/core/calibration/`)**: `calibration.ts`: the model `{ xFactor, yFactor, unit, precision, source, ratio?, sheet?, yRatio? }` (xFactor / yFactor = real millimetres per page point, UserUnit applied) and its Zod schema `calibrationSchema` (for Epic 6 persistence); `pageIdOf(sha256, index)` with the A2 / Epic 12 TODO; `factorForRatio`, `ratioForPage` (4.2's sheet conversion), `factorFromPoints`, `roundRatioOf` (usual metric and imperial ratios within 0.5 %), `realLengthMm`, `calibrationLabel` (Scale 1:100 / Calibrated / Scale 1:100 / 1:50 / Calibrated (X ≠ Y), with the factor in the tooltip), `calibrationsFor` (a range: a ratio per page as a ratio, a sheet-stated one converted per page; two points: the same factor), `mixedSizes`. `units.ts`: `parseDistance` (mm, m, in, ft, ft-in on top of `core/geometry/length.ts`; zero and negatives refused), `formatReal` / `formatRealValue` (decimals or 1/8" / 1/16"; `12'-6 1/2"`), `formatCursorReal`, `precisionsFor`. `range.ts`: `parsePageRange` ("1-3, 5", "4-", "-2"; out of range is an error), `parseRatioInput` ("100", "1:100", "1/100", "1:100 @ A1", "1:50 at a3", "1/200 ANSI D"). `src/core/scale/sheet.ts` gains `ratioOnSheet`, `detect.ts` `conflictWarning`.
- **Task 2 (undo)**: `src/core/undo/stack.ts`: immutable history of command objects `{ label, do, undo }` (execute / undo / redo, limit 200, labels). `src/features/editor/undo-store.ts`: one history per document tab in a zustand vanilla store (keyed by tab id; a closed tab's history is dropped); `executeCommand`, `undoActive`, `redoActive`. Keys: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z (Cmd on macOS) through the workspace shortcuts, only with a drawing open, never in a text field (the browser's text undo) or inside a dialog. Edit > Undo / Redo name the step ("Undo Calibrate page 1").
- **Task 3 (dialog, picking)**: `src/features/calibration/`: `CalibrateDialog` (Story 1.7 Dialog, Tabs, Select, Collapsible, Button, FieldShell): detected scales as "Use detected …" buttons (the ratio on this page first: "Use detected 1:200 (1:100 @ A1)"), the conflict warning with one button per reading (AC 6); "By ratio" (optional "@ sheet", the conversion shown under the field); "By two points": the dialog collapses to the instruction bar ("Click the first point · Esc to cancel", then the second; `role=status`, polite), picks use the snapping tool rules (glyph, Shift 45°, Alt off) through a new `calibrate` viewer tool and draw a dimension line with end ticks on the active overlay; back in the dialog the picked paper distance, the real distance and its unit (mm, m, in, ft, ft-in); picks under 10 CSS px are refused inline. Options: apply to this page / pages (range) / all pages, the mixed-sizes note, display units and precision (remembered per user, `calibration-prefs.ts`), "Different vertical scale" (a vertical ratio). Enter applies, Esc cancels; numbers use tabular figures. `src/features/tips/`: the reusable first-use tip (`FirstUseTip`, `useFirstUseTip`, per user in localStorage, `pm.tips.v1.<user>`): shown the first time the dialog opens, then never again; Dismiss hides it.
- **Task 4 (wiring)**: calibrations live in the viewer state by stable page id (`calibrations`, per tab through the tab snapshot: kept across tab switches, not reloads; Epic 6 persists them). The ScaleIndicator is a button opening the dialog in every state; calibrated it shows "Scale 1:100" in the success colour with its icon; `scaleStateOf(scales, calibration)` puts a calibration first. Document > Calibrate… and Tools > Calibrate…. The cursor readout switches to the page's unit and precision. Another tab shown closes the dialog.
- **Task 5 (tests)**: unit tests for the core, the undo stack and store, the shortcuts, the engine pick (snapped points, page and screen distances, rubber band, restore, cancel on Esc / tool / tab), the dialog (detected, conflict, ratio on a mixed range by Enter, errors, two-point flow with Esc / too close / ft-in, vertical scale, prefs), the tips, the status items; `e2e/calibrate.spec.ts` (two tests, AC 10's list); `e2e/perf-calibrate.spec.ts` (local, private).

**Decisions and deviations (for review):**

1. **X and Y are the PDF user space axes** of the page (the axes of the status bar's X/Y readout, unrotated by /Rotate or the view rotation), so a separate vertical scale stays with the drawing whatever the view rotation.
2. **The separate vertical scale is a ratio** (in both modes). A two-point pick sets X and Y alike (a diagonal pick cannot tell them apart); with a vertical ratio, Y follows the ratio.
3. **Calibrate… is in Document and in Tools** (AC names Document; the menu already listed it under Tools, as Revu does).
4. **Undo history in memory per tab**, not serialised to sessionStorage (UX-DR36 is Story 4.5's editor foundation: command objects with closures are not serialisable as they are). Undo keys are inactive in text fields and dialogs.
5. **A new viewer tool `calibrate`** (a snapping tool, never on the ToolRail) carries the pick; the previous tool comes back afterwards. Another tool, page or tab cancels the pick (the dialog comes back, or closes with the tab).
6. **First-use tip is marked seen when first shown** (not only on Dismiss), so it shows exactly once.
7. **Story 1.7 fix**: a Select's listbox now stacks above dialogs (`--z-dialog-popover`).
8. **Two-point labels** use a usual-ratio set (1:1 … 1:10000, metric and imperial) within 0.5 %; a typed ratio is shown as typed (1:33.3).
9. **Viewport-level calibration** is not done (follow-up for a later story: the 4.2 quads per detected scale are kept for it).
10. **Default display unit**: mm, precision 0 (until the user picks others).

**Questions for the founder (answered 2026-10-25):** (1) the vertical scale stays with the page's axes when the view is rotated; (2) Calibrate… stays in both menus; (3) the set is 1:75, the "1:200 @ A3" label is a drafting error.

**Original questions for the founder:**

- X/Y follow the PDF page axes (decision 1). Should a separate vertical scale instead follow the view as shown when the view is rotated?
- Keep Calibrate… in both Document and Tools menus, or only one?
- L17 measures 1:75 (its 1905 dimension is 25.4 mm of paper), like L21's A1 statement: is 1:75 the scale the founder expects for this set?

### File List

- `src/core/calibration/calibration.ts`, `units.ts`, `range.ts`, `calibration.test.ts` (new)
- `src/core/scale/sheet.ts`, `detect.ts`, `detect.test.ts` (modified)
- `src/core/undo/stack.ts`, `stack.test.ts` (new)
- `src/features/editor/undo-store.ts`, `undo-store.test.ts`, `index.ts` (new)
- `src/features/calibration/calibrate-dialog.tsx`, `calibrate-dialog.test.tsx`, `calibrate-store.ts`, `calibration-prefs.ts`, `calibration-prefs.test.ts`, `index.ts` (new)
- `src/features/tips/first-use-tips.tsx`, `first-use-tips.test.tsx`, `index.ts` (new)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts`, `viewer-input.ts`, `viewer-commands.ts`, `snap-controller.ts`, `index.ts`, `status/scale-state.ts`, `status/scale-state.test.ts`, `status/status-items.tsx`, `status/status-items.test.tsx` (modified)
- `src/features/workspace/workspace-shell.tsx`, `workspace-status-bar.tsx`, `workspace-menu-bar.tsx`, `use-workspace-shortcuts.ts`, `use-workspace-shortcuts.test.ts` (modified)
- `src/components/ui/select.tsx`, `src/app/globals.css` (modified)
- `e2e/calibrate.spec.ts`, `e2e/perf-calibrate.spec.ts` (new)
- `_bmad-output/implementation-artifacts/4-3-calibrate-a-page.md`, `sprint-status.yaml` (modified)
- Review: `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `src/core/calibration/calibration.ts`, `units.ts`, `calibration.test.ts`, `src/features/viewer/status/scale-state.ts`, `src/features/workspace/workspace-shell.tsx`, `src/features/calibration/calibrate-store.ts`, `calibrate-dialog.tsx`, `calibrate-dialog.test.tsx`, `src/features/editor/undo-store.ts`, `undo-store.test.ts`, `src/features/tips/first-use-tips.tsx` (modified)

### Change Log

- 2026-10-24: Story 4.3 implemented (Claude Opus 5.5): calibration core, undo stack, CalibrateDialog with two-point picking, wiring, e2e and the L17/L21 check. Status → review. Commits 932ea97 (in progress), db23977 (Task 1), 3444d3d (Task 2), 37fe1c1 (Task 3), 0ec223d (Task 4), 80b9ad1 (Task 5) and this record.
- 2026-10-25: Adversarial review (Claude Opus 5.5): R1-R9 fixed with tests (`npm test` 1604 unit tests in 139 files; calibrate / scale / snap e2e on the production build passed), founder decisions 1-3 recorded. Status → done.
