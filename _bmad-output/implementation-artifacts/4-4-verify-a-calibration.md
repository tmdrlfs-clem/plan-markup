# Story 4.4: Verify a calibration

Status: ready-for-dev

## Story

As a drafter,
I want to check the scale against a dimension I know,
so that I trust the numbers before I rely on them.

## Acceptance Criteria

1. **Given** a calibrated page (Story 4.3), **when** I choose **Verify** — from the Calibrate dialog of a calibrated page ("Verify…" next to the page's current calibration), or **Document → Verify calibration…** / **Tools → Verify calibration…** — **then** the VerifyDialog opens for the shown page (FR25). On an uncalibrated page the menu items are disabled with the reason ("Calibrate this page first"); a page calibrated in another tab or document never counts.
2. **Pick:** "Pick two points" collapses the dialog to the same floating instruction bar as Calibrate ("Click the first point · Esc to cancel", then the second; announced politely); the picks use the 4.1 snap service (glyph, `Shift` 0/45/90°, `Alt` no snap) and draw the temporary dimension line; `Esc` or Cancel brings the dialog back; picks under 10 CSS px are refused inline; another page shown while the dialog is open moves it to that page and drops the pick (as 4.3 review R4).
3. **Result:** the dialog shows the **measured** length of the picked line under the page's calibration (separate X/Y factors applied along the line), in the calibration's display unit and precision. With a **known** distance typed (mm, m, in, ft, ft-in like `12'-6"`, parsed like 4.3), it shows the **difference** (measured − known, signed, same unit and precision) and the percentage, and a verdict: **"Matches"** (success colour + icon) when measured and known are equal at the calibration's precision, otherwise **"Off by …"** (warning colour + icon). The known distance can be typed before or after picking; the result updates as it is typed.
4. **Keep or recalibrate:** **Keep** (the primary when the result matches) closes the dialog and changes nothing (no undo step). **Recalibrate…** (enabled with a pick and a known distance) opens the Calibrate dialog in "By two points" with this pick and the known distance prefilled, so the user can choose the pages and apply (one undo step, as 4.3). **Pick again** repeats the pick.
5. **Exactness (NFR8):** the measured value comes from one framework-free function in `src/core/calibration/` (`measureLength(dxPt, dyPt, calibration)` → mm, and `verifyCalibration(...)` → `{ measuredMm, knownMm, differenceMm, percent, matches }`), unit-tested; the shown text uses the same formatter as the cursor readout (4.3 `formatReal`), so the value equals what the calibration gives exactly (a page calibrated from two points verified on the same two points shows the typed distance exactly). Story 4.5's Length tool reuses this function.
6. **Accessibility:** Story 1.7 `Dialog` with labelled fields; Enter does the primary action (Pick two points / Keep), Esc cancels (in the picking bar: cancels picking and restores the dialog); the result block is a polite live region; numbers use tabular figures; the verdict never relies on colour alone (icon + text).
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on the committed fixtures covers: the menu item disabled before calibration, Verify from the menu and from the Calibrate dialog, a match on known corners, a mismatch with its signed difference and percentage, ft-in known value, Esc while picking, Recalibrate prefilling Calibrate and applying as one undo step.

## Tasks / Subtasks

- [ ] **Task 1: Core** — `measureLength` and `verifyCalibration` in `src/core/calibration/` (equality at the display precision via the formatter, percentage, signed difference); the pick reports its page-point deltas (`dxPt`, `dyPt`, UserUnit applied); unit tests (equal and separate X/Y factors, /Rotate pages, ft-in, rounding edge at half a precision step).
- [ ] **Task 2: VerifyDialog + picking** — `src/features/calibration/verify-store.ts` and `verify-dialog.tsx` reusing 4.3's picking (token, instruction bar, page-follow, line clearing); result block with verdict; Keep / Recalibrate… / Pick again; unit tests.
- [ ] **Task 3: Wiring** — "Verify…" in the Calibrate dialog when the page is calibrated; Document / Tools → Verify calibration… (disabled with the reason when not calibrated); Recalibrate prefills Calibrate (method, pick, distance, unit); only one of the two dialogs open at a time; tab switch closes it.
- [ ] **Task 4: Tests** — `e2e/verify-calibration.spec.ts` (AC 7); local L17/L21 check (L17 at 1:75 verified on its "1905" dimension: Matches; L21 calibrated from its detected 1:75 @ A1 verified on a dimension it prints); screenshot `fixtures/private/traces/4-4-verify.png` (never commit private files).

## Dev Notes

- Builds on 4.3 (CalibrateDialog, picking via `viewerCalibration`, `CalibrationPick`, the calibration model and formatters, the undo store), 4.1 (snap, Shift / Alt), 3.7 (status bar). Read 4.3 including its review (R1: the pick uses the Shift-held point; R2: X/Y factors along user space axes, the vertical as the page reads; R3: pick tokens; R4: the dialog follows the shown page).
- A verify never changes the calibration by itself; only Recalibrate → Calibrate → Apply does (founder decision 2026-10-24: scale changes go through Calibrate).
- Revu reference (help docs only, clean-room): a calibration is checked by measuring a known dimension after calibrating; Revu users recalibrate when it is off. The Verify dialog is our own compact version of that check.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; success = green + icon, warning = yellow + icon; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; stop Supabase/Docker with their own commands; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per task with the repo's author; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4]; FR25, NFR8
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] F1 first-run flow, ScaleIndicator, CalibrateDialog, MeasureReadout
- [Source: _bmad-output/implementation-artifacts/4-3-calibrate-a-page.md] including Review Follow-ups R1-R9

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-25: Story 4.4 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
