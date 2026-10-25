# Story 4.4: Verify a calibration

Status: done

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

- [x] **Task 1: Core** — `measureLength` and `verifyCalibration` in `src/core/calibration/` (equality at the display precision via the formatter, percentage, signed difference); the pick reports its page-point deltas (`dxPt`, `dyPt`, UserUnit applied); unit tests (equal and separate X/Y factors, /Rotate pages, ft-in, rounding edge at half a precision step).
- [x] **Task 2: VerifyDialog + picking** — `src/features/calibration/verify-store.ts` and `verify-dialog.tsx` reusing 4.3's picking (token, instruction bar, page-follow, line clearing); result block with verdict; Keep / Recalibrate… / Pick again; unit tests.
- [x] **Task 3: Wiring** — "Verify…" in the Calibrate dialog when the page is calibrated; Document / Tools → Verify calibration… (disabled with the reason when not calibrated); Recalibrate prefills Calibrate (method, pick, distance, unit); only one of the two dialogs open at a time; tab switch closes it.
- [x] **Task 4: Tests** — `e2e/verify-calibration.spec.ts` (AC 7); local L17/L21 check (L17 at 1:75 verified on its "1905" dimension: Matches; L21 calibrated from its detected 1:75 @ A1 verified on a dimension it prints); screenshot `fixtures/private/traces/4-4-verify.png` (never commit private files).

### Review Follow-ups (AI)

Adversarial review 2026-10-25 (Claude Opus 5.5) of d4a82ba..497d161, including the shared two-point pick (`picking.ts`, now also used by Calibrate) and Story 1.7's `Select` `labelHidden`. Checked: the measured value against the calibration (`measureLength` along user space axes with separate X / Y factors, /Rotate pages, UserUnit through the pick's `dxPt` / `dyPt`); comparison at the shown precision for every unit and precision (steps, half-step rounding, signs, ft-in fractions); the pick tokens across Calibrate and Verify (reopen, other dialog, Esc, page / tab change, undo removing the calibration while picking); Recalibrate's prefill and its single undo step; Calibrate regressions from the refactor (`closeCalibrate` early return, `openCalibrate()` without arguments from menus and the status bar, R3 / R4 behaviour, line clearing); keyboard and Enter primaries; live regions; menus; the tests. Founder decisions 2026-10-25 (answered questions, not to be asked again): (1) "Matches" is exact equality at the shown precision, the percentage still shown; (2) the status-bar scale click keeps opening Calibrate (Verify… inside it); (3) when the result is off Recalibrate… is the primary (Enter), otherwise Keep.

- [x] **[Medium] V1: The reason a disabled "Verify calibration…" is disabled was never shown.** It was a `title` on a Radix menu item, but disabled items take no pointer events (`pointer-events-none`) and no focus, so neither a mouse nor a screen reader ever met it (AC 1). Fix: the item carries the reason in its text, "Verify calibration… (calibrate this page first)", until the page is calibrated.
- [x] **[Low] V2: The whole result block was a live region**, so every keystroke in Known distance re-announced Measured / Known / Difference. Fix: only the verdict is a polite live region (without a known distance it reads "Measured 7056 mm. Type the known distance to compare.").
- [x] **[Low] V3: A real difference could read as none.** "Off by +1 mm" with a difference under 0.005 % showed "(0.00 %)". Fix: `formatPercent` gives "+<0.01 %" / "-<0.01 %"; "0.00 %" only for exactly none.
- [x] **[Low] V4: Test gaps.** The shared pick had no tests of its own (tokens, abandon, a second answer, no drawing, the 10 px rule), and nothing verified a /Rotate 90 page with a separate vertical scale. Fix: `picking.test.ts`; a /Rotate verify case in `verify.test.ts`.

Not defects (checked): Calibrate after the refactor (R3 / R4 tests and `calibrate.spec.ts` pass; `closeCalibrate` on a closed dialog only skipped a redundant line clear, every opener clears it); `openCalibrate` passed a menu or click event before Task 3 (fixed there by taking no arguments); Recalibrate drops a separate vertical ratio (a two-point calibration sets X and Y alike, 4.3 decision 2); the known distance accepts any unit whatever the display unit; Verify closes when an undo removes the calibration while picking (the pick is abandoned); `labelHidden` keeps the accessible name (Select tests).

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Local: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 1619 unit tests in 141 files (Docker stopped); e2e on the production build (`E2E_PROD=1`, workers 1): 48 passed, 11 skipped (opt-in private checks), 1 failed once (`appearance-themes`, right after a cold Supabase start: the known flake) and passed on its own rerun; `verify-calibration.spec.ts` and `calibrate.spec.ts` passed.
- CI: run **40136163470** success (Tasks 1-4 and the record, afaa495).
- Supabase on its default local ports, Docker Desktop started with `docker desktop start`; both stopped afterwards with `npm run db:stop` and `docker desktop stop`.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-verify`; private, nothing committed):
  - **L17** calibrated by ratio 1:75, verified on its "1905" dimension (snapped endpoints (-169.01, 98.57) and (-97.01, 98.57)): measured **1905 mm**, known 1905 → "Matches the calibration at the shown precision (1 mm)".
  - **L21** calibrated from its detected "1:75 @ A1" (the dialog's conflict option), verified on its "1491" dimension (snapped endpoints (139.12, -94.88) and (195.46, -94.88)): measured **1491 mm**, known 1491 → Matches (difference 0 mm, -0.02 %). This confirms founder decision 3 of the 4.3 review: the set is 1:75 and the "1:200 @ A3" label is a drafting error.
  - Screenshot `fixtures/private/traces/4-4-verify.png` (L21, the Verify dialog with the result and the status bar at Scale 1:75). Reviewed; not committed.

### Completion Notes List

- **Task 1 (core)**: `src/core/calibration/calibration.ts` `measureLength(dx, dy, calibration)` (renamed from `realLengthMm`; the one function Verify and 4.5's Length use: separate X / Y factors along user space axes). `units.ts` `precisionStepMm` (1 mm, 0.01 m, 1/8" ...) and `roundToPrecision`. New `verify.ts`: `verifyCalibration(line, calibration, knownMm)` → measured (mm and as shown), known as shown, the signed difference **of the shown values** (whole precision steps), the percentage of the unrounded values, and `matches` (the shown values are equal); `formatSigned` ("+56 mm", "-0.05 m", `+0'-1/4"`), `formatPercent` ("+0.79 %"). `CalibrationPick` carries `dxPt` / `dyPt` (points, UserUnit applied).
- **Task 2 (dialog)**: `src/features/calibration/picking.ts`, the two-point pick shared by Calibrate and Verify (one pick at a time, tokens, `abandonPick`, the 10 px rule), which `calibrate-store.ts` now uses too. `calibration-fields.tsx`: `TextInput` and `PickBar` shared by both dialogs. `verify-store.ts` / `verify-dialog.tsx`: "Verify calibration" (description "Page 1 of 2 · Scale 1:100"), Known distance + unit (the display unit's family, parsed like 4.3), Pick two points (the instruction bar; Esc / Cancel brings the dialog back; too close refused), the result block (Measured / Known / Difference, polite live region, tabular figures) with the verdict "Matches the calibration at the shown precision (1 mm)" (success + icon) or "Off by -108 mm (-2.01 %): recalibrate if the known distance is right" (warning + icon). Footer: no pick → Cancel / **Pick two points**; matches or no known → Recalibrate… / **Keep**; off → Keep / **Recalibrate…**. Keep changes nothing. Recalibrate… opens Calibrate on "By two points" with the pick (its line stays drawn) and the known distance (`openCalibrateWith`). Verify follows the shown page; a page without a calibration (or an undo removing it) closes it; a tab switch closes it; the Calibrate dialog opening closes it and vice versa.
- **Task 3 (wiring)**: the Calibrate dialog of a calibrated page shows "This page: Scale 1:75" with **Verify…**; Document and Tools menus have **Verify calibration…** under Calibrate…, disabled (with the reason "Calibrate this page first" as its title) until the shown page is calibrated; `VerifyDialog` mounted in the workspace shell. `openCalibrate()` takes no arguments any more (menus and the status bar pass their events).
- **Task 4 (tests)**: unit tests for the core (`verify.test.ts`: match, signed differences, separate X / Y, a two-point calibration verified on its own points is exact for several lengths, half-step rounding, m / in / ft-in fractions), the dialog (`verify-dialog.test.tsx`: calibrated pages only, match + Enter = Keep, off + Recalibrate prefilled and applied, ft-in, unreadable input, too close, Esc, page follow, close on lost calibration, one dialog at a time, stale picks), Select `labelHidden`; `e2e/verify-calibration.spec.ts` (AC 7's list); `e2e/perf-verify.spec.ts` (local, private).
- **Fix to 4.3 found here**: the unit Select beside the distance field ("Distance unit" in Calibrate, "Known unit" in Verify) drew its label in a 96 px column inside a 96 px box, so the control was cut off. Story 1.7's `Select` gains `labelHidden` (the label stays for assistive technology), used by both.

**Decisions (for review):**

1. **Where Verify lives**: a "Verify…" button in the Calibrate dialog of a calibrated page, and Document / Tools > Verify calibration… (like Calibrate…, in both menus). The ScaleIndicator still opens Calibrate (one action per click).
2. **"Matches" means equal at the shown precision** (the calibration's unit and precision), and the difference shown is the difference of the shown values, so the numbers on screen always add up; the percentage is of the unrounded values, so a match can read "0 mm (-0.02 %)".
3. **Recalibrate… goes through Calibrate** (prefilled two-point, the user picks the pages and applies: one undo step); Verify never changes a calibration itself. When the result is off, Recalibrate… is the primary (Enter); otherwise Keep.
4. **No tolerance setting**: there is no "within 0.5 %" band; anything not equal at the shown precision is "Off by ...", in warning colour.
5. **Known distance unit** defaults to the calibration's display unit (m → m, ft-in → ft-in) and can be changed per check; it is not remembered.

**Questions for the founder (answered 2026-10-25, see the review section):** exact equality at the shown precision; the status bar keeps opening Calibrate; Recalibrate… is the primary when off.

**Original questions for the founder:**

- Should "Matches" allow a tolerance (for example within 0.5 % or one drafting unit) instead of exact equality at the shown precision? Recommended: keep exact equality at the shown precision (a scaled PDF should measure exactly), and show the percentage as now.
- Should the ScaleIndicator of a calibrated page offer Verify directly (a small menu: Calibrate… / Verify…) instead of opening Calibrate (which has a Verify… button)? Recommended: keep one click → Calibrate, with Verify… inside it.

### File List

- `src/core/calibration/verify.ts`, `verify.test.ts` (new); `calibration.ts`, `units.ts`, `calibration.test.ts` (modified)
- `src/features/calibration/picking.ts`, `calibration-fields.tsx`, `verify-store.ts`, `verify-dialog.tsx`, `verify-dialog.test.tsx` (new); `calibrate-store.ts`, `calibrate-dialog.tsx`, `calibrate-dialog.test.tsx`, `index.ts` (modified)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts` (modified)
- `src/features/workspace/workspace-menu-bar.tsx`, `workspace-shell.tsx` (modified)
- `src/components/ui/select.tsx`, `select.test.tsx` (modified)
- `e2e/verify-calibration.spec.ts`, `e2e/perf-verify.spec.ts` (new)
- `_bmad-output/implementation-artifacts/4-4-verify-a-calibration.md`, `sprint-status.yaml` (modified)
- Review: `src/features/workspace/workspace-menu-bar.tsx`, `src/features/calibration/verify-dialog.tsx`, `verify-dialog.test.tsx`, `src/core/calibration/verify.ts`, `verify.test.ts`, `e2e/verify-calibration.spec.ts` (modified); `src/features/calibration/picking.test.ts` (new)

### Change Log

- 2026-10-25: Story 4.4 created from the epics (Claude Opus 5.5). Status → ready-for-dev (d4a82ba).
- 2026-10-25: Story 4.4 implemented (Claude Opus 5.5): verify core, VerifyDialog with the shared pick, wiring, e2e and the L17/L21 check. Status → review. Commits 85046dc (Task 1), cba0ab8 (Task 2), efbbe03 (Task 3), 3d110e7 (Task 4) and this record.
- 2026-10-25: Adversarial review (Claude Opus 5.5): V1-V4 fixed with tests, founder decisions 1-3 recorded. Status → done. Commit 3f5bbbd, CI run **40178517803** success.
