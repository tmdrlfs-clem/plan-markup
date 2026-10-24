# Story 4.2: Detect printed scales

Status: done

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

- [x] **Task 1: Core** — `src/core/scale/{detect,sheet,ratio}.ts` (pure): tokenizer over positioned text runs (joins runs on the same baseline), pattern set, qualifier parsing, sheet conversion, plausibility filter, negative-context filter; unit tests.
- [x] **Task 2: Worker** — `scale.detect { page }` in `engine.worker` (AR14 protocol, Zod, `serializeWorkerError` + `code`), text source per AC 1, cache, priority/cancel, per-tab lifecycle.
- [x] **Task 3: Store + ScaleIndicator wiring** — per-page detected scales in the viewer/document state (keyed by stable page id where available — AR8 prep for 4.3), ScaleIndicator states "detected — Verify" and "N scales on page" with tooltip list.
- [x] **Task 4: Fixtures + tests** — fixture generator script, unit + `e2e/viewer-scale-detect.spec.ts`; local L17/L21 result recorded; screenshot `fixtures/private/traces/4-2-scale.png`.

### Review Follow-ups (AI)

Adversarial review 2026-10-24 (Claude Opus 5.5) of 912eb42..0bb8447 (plus the 4.2 story text that went in with b2a4136). Checked: the metric and imperial patterns against punctuation, spacing, split / interleaved / rotated runs and title-block spellings (probed with `findRatios` on the strings quoted below); the sheet maths (ISO √2 steps, cross-series long edges, UserUnit: `PageInfo` sizes include it, so the maths is right on UserUnit pages); the plausibility filter; counting / dedup; the two-sheet interpretation; the worker job (Zod payload, priority slot shared with `render.text`, `missed` wait while pdf.js parses, cancel, out-of-range); the text cache reuse (memory, then IndexedDB; nothing extracted a third time); per-tab state (engine field + store snapshot, reset on a new document); the ScaleIndicator states and its focusable tooltip; AC coverage of the tests. Founder decisions 2026-10-24 applied: (1) disagreeing sheet statements are flagged, (2) a detected scale is never applied without Calibrate (4.3), (3)-(4) the 4.1 Length snap preview / Alt and the segment cap are accepted.

- [x] **[High] D1: Disagreeing sheet statements are hidden (founder decision 1).** L21's "1 : 75 @ A1 1 : 200 @ A3" keeps only the A1 statement on an A1 page, though 1:75 @ A1 is 1:150 @ A3, not 1:200; on a page of neither sheet (A2) the two disagreeing readings become "2 scales on page". Fix: one line stating a view for several sheets is one scale; when the readings convert to different ratios on this page it carries `conflict: true` and every reading (`readings`: printed ratio, sheet, ratio on this page), the page's own sheet first; the ScaleIndicator shows "Scales disagree — Verify" (warning) with both readings in the tooltip. Bare repeats of one reading fold into it. Agreeing statements stay one plain scale.
- [x] **[High] D2: Punctuation after a ratio drops it.** The lookahead `(?![\d.,:/])` rejects "PLAN 1:50, SECTION 1:100" (1:50 lost) and "SCALE 1:100." (nothing); the lookbehind also rejects "SCALE:1:100" (no space). Fix: only a digit, a colon / slash, or a decimal (".5", ",5") after the number rules it out; a colon before the "1" rules it out only after a digit (a time).
- [x] **[High] D3: `1-1/2" = 1'-0"` reads as 1:24** (the hyphenated mixed number, the usual US spelling, is matched from "1/2"); a wrong scale is worse than none. Fix: whole and fraction joined by a space or a hyphen; a hyphen before the match is excluded like a word character.
- [x] **[Medium] D4: The negative context is two words wide.** Any of slope / ramp / grade / pitch / batter / mix / ratio up to two words before a ratio drops it: "RAMP PLAN 1:50", "GRADE BEAM DETAIL 1:20", "SCALE RATIO 1:100" give nothing. Fix: the word must stand right before the ratio, with only "min" / "max" / "of" / "at" / "approx" / punctuation between ("FALLS 1:40", "min. gradient 1:100", "FALL AT 1:60" still rejected); "SCALE" directly before a ratio overrides.
- [x] **[Medium] D5: A bare sheet-like code after a ratio is taken as a qualifier.** "SECTION 1:50 B2" (a grid or detail reference) converts to 1:59.45 on A1. Fix: without "@" / "AT" / "ON" / "FOR" / brackets only "A0"-"A4" count as a sheet (title blocks print "1:100 A1"); B, ANSI and ARCH sheets need the connector.
- [x] **[Medium] D6: Ratios inside notes produce a scale** (AC 5): "REFER TO 1:50 DETAILS FOR ALL FLASHINGS AND THE LIKE" gives 1:50. Fix: on a line with more than eight other words and no "SCALE" before it, a ratio is part of a note and ignored (view titles and title blocks are short: L21's view title has three).
- [x] **[Medium] D7: The e2e "Scale not set" check on page 4 cannot fail.** It waits 1.5 s and reads the default text, which is also the text while detection is pending or after it failed. Fix: the ScaleIndicator carries `data-detection="pending|done"` (the page's detection answered); the e2e waits for "done" on every page.
- [x] **[Low] D8: A page whose detection fails is asked again on every settle** (each pan or zoom re-queues a text read that fails the same way). Fix: a failed page is remembered for the document (not cached across documents) and shows "Scale not set"; cancellations are not failures.
- [x] **[Low] D9: The ratio sign "∶" (U+2236, which NFKC keeps) is not a colon to the pattern.** Fix: accepted as the colon.

Not defects (checked): sheet maths on UserUnit / rotated pages (page sizes and text quads are both in /Rotate + UserUnit page space); the 50 km plausibility bound with the candidate set (converted ratios stay true values, e.g. 1:141.4 on A2, which is right); the bare-ratio adoption of a printed sheet ("1:100" beside "1:100 @ A1" on A3 is 1:200, same view); the shared priority slot with `render.text` (FIFO among text jobs, after tiles and before thumbnails, as AC 1 asks).

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Local: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 1515 unit tests in 133 files; e2e on the production build (`E2E_PROD=1`, workers 1): 45 passed, 9 skipped (opt-in private checks). One full run had `workspace-shell` "sign out from the File menu" fail once (the known auth flake after a long Supabase session); it passed alone and in the next full run.
- Supabase on locally remapped ports 583xx (Windows reservation), restored afterwards, never committed.
- CI run 40057029559 (2a81f4b) **failed**: late specs could not sign in (stayed on /sign-in). Cause: the sign-in rate limiter (30 per address and 10 per account per 15 min) — every spec signs in from the same address, and this story's and 3.8 / 4.1's new specs pushed a full run past it (also the local "sign out from the File menu" flake). Fix: the e2e `signIn` helper clears the address counter and that account's counter first; `auth.spec.ts`'s limiter test keeps its counters (`keepRateLimits`). Local full e2e: 46 passed, 9 skipped. CI after the fix (the e2e helper commit): run **40057642334** success.
- Review fixes: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 1538 unit tests in 133 files; e2e on the production build (`E2E_PROD=1`, workers 1): 45 passed, 9 skipped, 1 failed once (`appearance-themes`, right after a cold Supabase start: the known flake) and passed on its own rerun; `PERF_L17=1` L17/L21 check passed. CI run (review fixes): see below.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-scale`, and node on the same core over pdf.js text; private, nothing committed):
  - **L17**: title block "A1 SCALE As indicated"; the only other ratio-like text is the plot stamp "16/08/2026 1:17:46 pm" → **nothing detected, "Scale not set"** (no false scale).
  - **L21**: title block "As indicated" (nothing), plus a view title under the plan "A2102 1 : 75 @ A1 1 : 200 @ A3 PLAN VIEW" (Revit draws its runs out of order: "1 : 75", "1 : 200", "@ A1", "@ A3 PLAN VIEW"). Detected: **"Scale 1:75 @ A1 detected — Verify"** (the A1 statement for this A1 page; the A3 statement on the same line is the same view for another sheet). Before that rule it read "2 scales on page" (1:75 and 1:200 @ A3 → 1:100 on A1). Note for the founder below: the two statements disagree (1:75 @ A1 would be 1:150 @ A3).
  - Detection takes 5-10 ms per page in the worker (602 / 539 text items).
  - Screenshot `fixtures/private/traces/4-2-scale.png` (L21 with the ScaleIndicator tooltip). Reviewed; not committed.

### Completion Notes List

- **Task 1 (core, `src/core/scale/`)**, refactored from the prototype (`SCALE_CANDIDATES` → `METRIC_RATIOS`; `SHEET_MM` / `sheetLongEdge` / `sheetName` → `src/core/pdf/page-size.ts`'s table via `canonicalSheet` / `sheetLongEdgeMm` / `pageSheet`; `ratioForThisSheet` → `ratioOnPage`; `niceRatio` kept; `resolvedScales` → the grouping in `detectScales`):
  - `ratio.ts`: "1:100 @ A1", "SCALE 1:50", "1 : 200 at A3", "1:100@A1", "SCALE: 1/100", "1:1250 (A1)", "1:500 FOR ANSI D"; imperial `1/8" = 1'-0"` (1:96), `1/4"=1'` (1:48), `3/16″ = 1′-0″`, `1 1/2" = 1'-0"`, `1" = 20'` (1:240), with typographic inch / foot marks. Rejected: "As indicated", "NTS", "NOT TO SCALE", "AS SHOWN", times ("1:30 PM", "11:30", "1:17:46 pm"), dates ("12/10/2026", "1/10/26"), slopes / falls / gradients ("slope 1:40", "FALLS 1:40"), return periods ("1:100 year flood", "1:100 AEP"), mixes ("1:3"), fractions ("1/2 HR"), grid references, dimensions; ratios outside the usual set.
  - `sheet.ts`: a ratio stated for another sheet is converted (within one ISO series exactly √2 per step: 1:100 @ A1 on A3 is 1:200, 1:20 is 1:40 not 1:40.05; across series by the long edges; on a non-standard page by its own size), then rounded to the usual ratio within 2 %.
  - `detect.ts`: lines are built by geometry (same direction, baselines within half a font size, ordered along the line, split at gaps over three font sizes), not by drawing order, so split runs ("1", ":", "100"), interleaved runs (L21) and rotated text work; each line is normalised like search text (NFKC). A bare "1:100" next to "1:100 @ A1" is the same statement; one line giving the scale for two sheets keeps the page's sheet; scales are grouped by effective ratio, counted, with their page-space quads kept for 4.3; a scale whose sheet would be over 50 km in reality is dropped.
- **Task 2 (worker).** `scale.detect { page }` handled by the **render worker** (no `engine.worker` exists, Story 4.1's topology decision): it reads the page text the worker already extracts and caches for search and sheet labels (memory, then IndexedDB, `render.text`'s items), so text is never extracted a third time; same priority as `render.text` (after tiles), waits off the queue's head while pdf.js parses, cancellable.
- **Task 3 (state, ScaleIndicator).** The engine asks for the shown page at settle; results are cached per sha256 + page in memory (shared by tabs) and published as `pageScales` (by 0-based page index: stable page ids come with saved documents; Story 4.3 re-keys). `scaleStateOf(pageScales)`: none → "Scale not set"; one → "Scale 1:100 @ A1 detected — Verify", or for another sheet "Scale 1:200 (1:100 @ A1) detected — Verify" with "1:100 @ A1 → 1:200 on this A3 page" in the tooltip; several → "2 scales on page" with the list. Warning colour and icon; tooltips point to "Calibrate (coming next)". A detected scale is a tab stop (its tooltip carries information), "Scale not set" stays a plain item.
- **Task 4.** `fixtures/pdf/scales.pdf` + `scripts/fixtures/make-scales-fixture.mjs` (deterministic), `e2e/viewer-scale-detect.spec.ts` (the four texts, the conversion tooltip, the list), `e2e/perf-scale.spec.ts` (local).

**Decisions and deviations (for review):**

1. **Render worker, not `engine.worker`** (AC 1 names it): the text lives there (Story 4.1's topology decision; no engine worker yet).
2. **Status-bar label for a converted scale** is "Scale 1:200 (1:100 @ A1) detected — Verify" (the page's ratio first, short enough for the bar at 1280 px); the full "1:100 @ A1 → 1:200 on this A3 page" (AC 2's wording) is in the tooltip.
3. **Imperial scales are in scope** (converted to ratios); they are never sheet-converted (no sheet qualifier in those spellings).
4. **One view, two sheets**: a line stating the scale for two sheet sizes counts once, for the page's sheet (L21).
5. **The candidate set** adds 1:75, 1:150, 1:1500 and 1:10000 to the prototype's; 1:1 is not a scale; the "1/x" spelling needs x ≥ 10 (fractions).
6. **Keyed by page index** for now (AR8 page ids arrive with saved documents).

**Review fixes (2026-10-24, D1-D9 above):**

- `src/core/scale/ratio.ts`: lookahead / lookbehind (D2), the ratio sign (D9), the hyphenated imperial mixed number (D3), the slope-word rule only right before the ratio with a "SCALE" override (D4), bare sheet codes only ISO A0-A4 (D5), the note rule (D6, `NOTE_WORDS` = 8).
- `src/core/scale/detect.ts`: `DetectedScale` carries `conflict` and `readings` (`ScaleReading`: printed ratio, sheet, ratio on this page); a line naming several sheets is one view; agreeing statements are one plain scale, disagreeing ones a conflict (the page's own sheet first); a plain scale equal to one of a conflict's readings folds into it. `readingLabel`, `conflictReadings` for the UI and Story 4.3.
- `scale-state.ts`: new state `conflict` ("Scales disagree — Verify", warning, tab stop, both readings in the tooltip); in a list "1:75 @ A1 / 1:200 @ A3 (disagree)"; `not-set` carries `pending` until the page's detection answered, shown as `data-detection="pending|done"` (D7).
- `viewer-engine.ts`: a failed detection is published as none for that document (D8).
- `fixtures/pdf/scales.pdf` page 5 (A1): "PLAN VIEW 1 : 75 @ A1 1 : 200 @ A3"; the e2e waits for `data-detection="done"` on each page and checks the conflict text and its tooltip by keyboard.
- Founder drawings after the fixes: **L17** "Scale not set" (no false scale); **L21** "Scales disagree — Verify", tooltip "Printed scales disagree: 1:75 @ A1 = 1:75 on this A1 page; 1:200 @ A3 = 1:100 on this A1 page".

**Questions for the founder (answered 2026-10-24):** the L21 conflict is flagged (decision 1); a detected scale always goes through Calibrate (decision 2).

**Original questions for the founder:**

- L21's view title says "1 : 75 @ A1" and "1 : 200 @ A3"; 1:75 on A1 is 1:150 on A3. The app takes the A1 statement on this A1 sheet. Is 1:75 right for L21, and should the app warn when two sheet statements disagree?
- Should the ScaleIndicator offer to apply a detected scale directly (one click), or always go through Calibrate (4.3)?

### File List

- `src/core/scale/ratio.ts`, `sheet.ts`, `detect.ts`, `detect.test.ts` (new)
- `src/workers/render-protocol.ts`, `render.worker.ts`, `render.worker.test.ts` (modified)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts`, `status/scale-state.ts`, `status/status-items.tsx`, `status/status-items.test.tsx` (modified); `status/scale-state.test.ts` (new)
- `src/features/workspace/workspace-shell.tsx` (modified)
- `fixtures/pdf/scales.pdf`, `scripts/fixtures/make-scales-fixture.mjs` (new); `fixtures/README.md` (modified)
- `e2e/viewer-scale-detect.spec.ts`, `e2e/perf-scale.spec.ts` (new)
- `_bmad-output/implementation-artifacts/4-2-detect-printed-scales.md`, `sprint-status.yaml` (modified)
- Review: `src/core/scale/ratio.ts`, `detect.ts`, `detect.test.ts`, `src/features/viewer/status/scale-state.ts`, `scale-state.test.ts`, `status-items.tsx`, `status-items.test.tsx`, `cursor-store.test.ts`, `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `scripts/fixtures/make-scales-fixture.mjs`, `fixtures/pdf/scales.pdf`, `fixtures/README.md`, `e2e/viewer-scale-detect.spec.ts`, `e2e/perf-scale.spec.ts` (modified); `docs/decisions/0006-snap-and-scale-in-render-worker.md` (new), `_bmad-output/planning-artifacts/architecture.md` (AR14 note)

### Change Log

- 2026-10-24: Story 4.2 implemented (Claude Opus 5.5): scale detection core, worker job, ScaleIndicator states, fixture, e2e and the L17/L21 check. Status → review. Commits 912eb42 (ready for dev), 65078a3 (in progress), e68ebf1, 057eb33, bf16c97 and the Task 4 commit.
- 2026-10-24: e2e sign-in helper clears the rate-limit counters (CI run 40057029559 had throttled the last specs); CI run 40057642334 success.
- 2026-10-24: Adversarial review (Claude Opus 5.5): follow-ups D1-D9 and ADR 0006 (dffbef6); all fixed with tests, founder decisions 1-4 applied. Status → done.
