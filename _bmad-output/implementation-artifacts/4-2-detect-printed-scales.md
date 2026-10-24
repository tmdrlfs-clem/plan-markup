# Story 4.2: Detect printed scales

Status: in-progress

## Story

As a drafter,
I want the app to find the scale printed on the drawing,
so that I only need to confirm it.

## Acceptance Criteria

1. **Given** an opened page with text, **when** scale detection runs off the main thread (in `engine.worker` from Story 4.1, fed by the page text already extracted for 3.3 sheet labels / 3.6 search — do not extract text a third time; choose where the text comes from and record it), **then** ratios like "1:100 @ A1", "SCALE 1:50", "1 : 200 at A3", "1:100@A1", "SCALE: 1/100" and "1:1250 (A1)" are found, including sheet-size qualifiers (FR23). Detection runs lazily for the active page (then others on demand), is cached per sha256 + page, cancellable, and lower priority than tiles.
2. **Sheet qualifier maths** (refactored from the prototype `C:\bluebeam\tool\src\core\20-scale.js` — `SCALE_CANDIDATES`, `SHEET_MM`, `ratioForThisSheet`, `niceRatio`, `sheetName` — into framework-free `src/core/scale/`; refactor, do not copy, and reuse `src/core/pdf/page-size.ts` from 3.7 instead of a second sheet table): a ratio stated for a different sheet than the actual page size is converted ("1:100 @ A1" printed on an A3-sized PDF page → effective 1:200), and the UI shows both ("1:100 @ A1 → 1:200 on this A3 page"). Ratios not in a sensible candidate set, or implausible for the page, are dropped. Imperial forms (`1/8" = 1'-0"`, `1" = 20'`) are recognised and converted to an equivalent ratio — or explicitly out of scope with a recorded decision.
3. The status bar ScaleIndicator (3.7, already supports the state) shows `Scale 1:100 @ A1 detected — Verify` in the warning colour with icon (UX-DR9); clicking still does nothing until 4.3 (tooltip explains "Confirm in Calibrate (coming next)") — or opens the CalibrateDialog if 4.3 exists. Uncalibrated pages with no detection keep `⚠ Scale not set`.
4. Pages with several different viewport scales show "2 scales on page" (count of distinct effective ratios), with the list in the tooltip; the same scale repeated (title block + viewport label) counts once. Positions of each detected scale text are kept (page space quads) for 4.3/viewport calibration later.
5. **No false scales:** "As indicated", "NTS", "Not to scale", "AS SHOWN", dimension strings, dates ("1:30 PM", "12/10/2026"), times, revision tables, grid references and ratios inside notes (e.g. "slope 1:40", "fall 1:60", "1:100 year flood") do not produce a detection; title-block "SCALE" labels next to "As indicated" produce none. The founder's L17/L21 (title block "As indicated" per the brief) must give no false scale — record what is detected on each, check locally, never commit private files.
6. Unit tests cover detection on fixture text runs (synthetic runs incl. split runs "1 : 100" across items, rotated text, all positive/negative cases above), sheet conversion maths, and the multi-scale count; the worker handler is tested with stubbed text.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on a committed fixture (generate `fixtures/pdf/scales.pdf`: page 1 "SCALE 1:100 @ A1" on an A1 page, page 2 the same text on an A3 page, page 3 two viewport scales 1:50 and 1:100, page 4 "As indicated" + "slope 1:40") covers the four status-bar texts.

## Tasks / Subtasks

- [ ] **Task 1: Core** — `src/core/scale/{detect,sheet,ratio}.ts` (pure): tokenizer over positioned text runs (joins runs on the same baseline), pattern set, qualifier parsing, sheet conversion, plausibility filter, negative-context filter; unit tests.
- [ ] **Task 2: Worker** — `scale.detect { page }` in `engine.worker` (AR14 protocol, Zod, `serializeWorkerError` + `code`), text source per AC 1, cache, priority/cancel, per-tab lifecycle.
- [ ] **Task 3: Store + ScaleIndicator wiring** — per-page detected scales in the viewer/document state (keyed by stable page id where available — AR8 prep for 4.3), ScaleIndicator states "detected — Verify" and "N scales on page" with tooltip list.
- [ ] **Task 4: Fixtures + tests** — fixture generator script, unit + `e2e/viewer-scale-detect.spec.ts`; local L17/L21 result recorded; screenshot `fixtures/private/traces/4-2-scale.png`.

## Dev Notes

- Builds on 3.3 (sheet labels / text), 3.6 (page text extraction and cache), 3.7 (ScaleIndicator states, page-size core), 4.1 (`engine.worker`, snap). Read those story files including review follow-ups first.
- Do not implement calibration (4.3) or the FR82 prompt (4.7); only detection and display.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; warning = yellow + icon; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; stop Supabase/Docker with their own commands; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.2]; FR23, UX-DR9, AR14, AR26
- [Source: C:\bluebeam\tool\src\core\20-scale.js] prototype scale detection
- [Source: _bmad-output/implementation-artifacts/3-7-status-bar-with-page-size-scale-snap-cursor-and-zoom.md], [4-1-snap-to-drawing-linework.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
