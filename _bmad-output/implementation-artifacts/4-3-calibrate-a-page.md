# Story 4.3: Calibrate a page

Status: in-progress

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

- [ ] **Task 1: Core calibration** — `src/core/calibration/` model, Zod schema, conversions, unit/ft-in parsing and formatting, range parsing; unit tests.
- [ ] **Task 2: Undo stack** (if absent) — minimal command stack per AC 7; keyboard bindings with canvas/workspace focus rules from 3.x.
- [ ] **Task 3: CalibrateDialog + picking mode** — dialog, collapsed instruction bar, two-point picking with snap/overlay, distance entry, options, first-use tip helper.
- [ ] **Task 4: Wiring** — ScaleIndicator opens dialog; Document → Calibrate menu item; per-tab calibration state; status-bar success state; cursor real units; conflicting-scale warning (uses the fixed 4.2 detection data).
- [ ] **Task 5: Tests** — unit + `e2e/calibrate.spec.ts`; local L17/L21 check (calibrate L21 from detected 1:75 @ A1 and by two points on a known dimension, e.g. a "1905" dimension on L17 → cursor/readout consistent); screenshots `fixtures/private/traces/4-3-calibrate-dialog.png` and `4-3-calibrated.png` (never commit private files).

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
