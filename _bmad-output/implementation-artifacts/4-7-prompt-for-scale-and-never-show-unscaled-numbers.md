# Story 4.7: Prompt for scale and never show unscaled numbers

Status: done

## Story

As a drafter,
I want the app to stop me measuring on an unknown scale,
so that I never copy a wrong number.

## Acceptance Criteria

1. **Given** an uncalibrated page, **when** I arm a measuring tool (Length, Polylength; Area, Count and the 4541 zone tools join with their stories) by any route (ToolRail, Revu shortcut, menu), **then** a scale prompt appears over the document area (FR82, UX J2 step 1), without taking the keyboard focus from the canvas.
2. **Prompt contents** follow the page's scale state (UX-DR9, `scaleStateOf`):
   - one detected scale: "Detected 1:100 @ A1" (with the converted ratio when the sheet differs, as the ScaleIndicator words it) — **Use it** / **Calibrate…**;
   - nothing detected, several scales on the page, or printed scales that disagree: only **Calibrate…**, with a line saying why ("No scale found on this page", "2 scales on page", "Printed scales disagree");
   - detection still running: "Reading the drawing's scale…" with **Calibrate…**; the prompt updates when detection finishes.
   Every state says that measurements show "Scale not set" until the page has a scale.
3. **Use it** calibrates the shown page with the detected scale exactly as the Calibrate dialog's detected-scale button does (one undo step "Calibrate page N", the user's unit and precision); captions on the page update at once. **Calibrate…** opens the Calibrate dialog for the page; the prompt is hidden while the dialog (or its two-point pick) or Verify is open, and comes back if the page is still uncalibrated afterwards.
4. **Dismiss** (×, "Measure without scale") hides the prompt for that page for the rest of the session (other pages still prompt); measurements on it show "Scale not set" in the warning colour instead of any number (FR27, UX-DR15; Stories 4.5 / 4.6 behaviour, unchanged).
5. The prompt goes away when the page gets a scale by any route, when the tool is no longer a measuring tool, or when another page / tab without a scale is shown (it re-evaluates for that page). A calibrated page never prompts.
6. Accessible: the prompt is a non-modal labelled region whose text is announced politely; its buttons are reachable with Tab; nothing in it is coloured without a text equivalent (UX-DR11 warning colour with the ⚠ icon).
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/scales.pdf` covers: page 1 detected → Use it (status "Scale 1:100 @ A1", a length reads a number), page 4 nothing detected → only Calibrate…, which opens the dialog, page 5 disagree → only Calibrate…, Dismiss on a page then a length there reads "Scale not set" and the prompt stays away on that page, and undo of "Use it".

## Tasks / Subtasks

- [x] **Task 1: Prompt state** — `src/features/calibration/scale-prompt-store.ts`: the session's dismissed pages, `scalePromptFor(...)` (pure: shown or not and its contents from the viewer state, the dialogs' state and the dismissals), `applyDetectedScale()` and `dismissScalePrompt()`; unit tests.
- [x] **Task 2: ScalePrompt** — `scale-prompt.tsx` (warning bar like the PickBar: ⚠, text, Use it, Calibrate…, ×), mounted by the workspace shell; component tests.
- [x] **Task 3: Tests** — `e2e/scale-prompt.spec.ts` (AC 7); update specs that arm Length on an uncalibrated page if the prompt gets in their way.

### Review Follow-ups (2026-11-01)

- [x] R1: a Calibrate dialog opened from the prompt and closed by a tab switch dismissed the other document's page: a dialog closed on another document dismisses nothing.
- [x] R2: the prompt was fixed at the viewport top and covered the HintBar (the tool's instructions): it now sits in the document area under the tabs.
- Decision 2b implemented (`calibrateFromPrompt`); unit 147 files / 1681 tests; local e2e 15 passed.

## Dev Notes

- The prompt does not block the canvas: a drafter may keep measuring (captions read "Scale not set", 4.5). It only offers the way out.
- Founder decision 2026-10-24 (4.3): the ScaleIndicator never applies a detected scale, it opens Calibrate. FR82's "Use it" is an explicit confirmation of the stated scale, so it applies directly (to be confirmed with the founder).
- Reuse: `scaleStateOf` (viewer status), `applyCalibration` and the dialog's detected-scale input (`{ kind: "detected", ratio: s.sheet ? s.ratio : s.effective, sheet: s.sheet }`), `calibrationPrefs` for unit / precision, `openCalibrate`.
- Zone tools (Epic 7/8) will use the same prompt through one predicate (`needsScale(tool)`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.7], FR27, FR82, UX-DR9, UX-DR15
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] J2 step 1, "Scale trust"
- [Source: _bmad-output/implementation-artifacts/4-3-calibrate-a-page.md] detected-scale apply

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- `scalePromptFor` is pure (viewer state, dialogs open, dismissals) so the component and the tests share it; `needsScale(tool)` is the one predicate Area, Count and the zone tools will join.
- "Use it" goes through `applyCalibration` with the dialog's detected-scale input and the user's unit and precision: one "Calibrate page N" undo step; undoing it brings the prompt back (the tool is still armed).
- The prompt sits where the calibration PickBar does (fixed, top centre) and is a labelled region with a polite status line; it never takes the focus (the e2e checks the canvas keeps it).
- Existing measuring specs (measure-length, measure-polylength, viewer-snap, workspace-shell, calibrate, verify-calibration) pass unchanged with the prompt shown: it does not cover their clicks.
- Local: `E2E_PROD=1 npx playwright test scale-prompt` passes; unit 147 files / 1679 tests.
- Founder decisions 2026-11-01: (1a) "Use it" applies directly; (2b) Calibrate… opened from the prompt and closed with the page still without a scale counts as a dismissal for that page.

### File List

- src/features/calibration/scale-prompt-store.ts, scale-prompt.tsx, scale-prompt.test.tsx, index.ts
- src/features/workspace/workspace-shell.tsx
- e2e/scale-prompt.spec.ts

### Change Log

- 2026-10-31: Story 4.7 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
- 2026-10-31: Tasks 1-3 done; Status → review (Claude Opus 5.5).
- 2026-11-01: Founder decisions 1a / 2b, review R1-R2 fixed; Status → done (Claude Opus 5.5).
