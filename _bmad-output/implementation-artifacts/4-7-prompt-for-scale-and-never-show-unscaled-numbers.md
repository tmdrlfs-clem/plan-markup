# Story 4.7: Prompt for scale and never show unscaled numbers

Status: ready-for-dev

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

- [ ] **Task 1: Prompt state** — `src/features/calibration/scale-prompt-store.ts`: the session's dismissed pages, `scalePromptFor(...)` (pure: shown or not and its contents from the viewer state, the dialogs' state and the dismissals), `useDetectedScale()` and `dismissScalePrompt()`; unit tests.
- [ ] **Task 2: ScalePrompt** — `scale-prompt.tsx` (warning bar like the PickBar: ⚠, text, Use it, Calibrate…, ×), mounted by the workspace shell; component tests.
- [ ] **Task 3: Tests** — `e2e/scale-prompt.spec.ts` (AC 7); update specs that arm Length on an uncalibrated page if the prompt gets in their way.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-31: Story 4.7 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
