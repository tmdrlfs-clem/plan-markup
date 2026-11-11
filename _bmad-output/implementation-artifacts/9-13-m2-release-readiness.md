# Story 9.13: M2 release readiness

Status: done

The in-repo part is done. AC 3 was waived by the founder on 2026-11-12: manual placement is clearly slower, so the timed comparison on three drawings will not be done. No manual times, engine times or rule disagreements were recorded.

## Story

As the founder,
I want the 4541 engine verified end to end,
so that pilots can use it on real projects.

## Acceptance Criteria

1. Given Epic 9 is complete, when the M2 checks run, a keyboard-only Playwright test completes zone → use → Place heads → read report (UX-DR39).
2. NFR6 timings are measured on reference hardware and recorded.
3. The founder compares engine results with the A16 manual baseline on the 3 drawings and records time saved and any rule disagreements.
4. A security review pass is completed with no open High findings (NFR36).

## Tasks / Subtasks

- [x] AC 1: `e2e/keyboard-4541.spec.ts`, no mouse event:
  - Ctrl+O, Alt+4, the panel's Calibrate button, 1:100 typed and applied;
  - Polygon zone from the panel, four corners with the keyboard pointer, Enter adds the zone;
  - the use chosen in the zone's list by type-ahead;
  - Place heads; the zone's row opened and its report read (hazard, ruleset, heads, max spacing, no rule breaks);
  - axe-core: no serious or critical violation.
- [x] AC 2: `e2e/perf-4541.spec.ts` (local, `PERF_M2=1`, production build) and `docs/spikes/m2-timings.md`:
  - one 196 m² zone: 223–324 ms (limit 1 s);
  - a 600 m² floor of 15 zones: 413–492 ms (limit 5 s);
  - no main-thread task over 50 ms, up to a second after the run.
- [ ] AC 3 (waived by the founder, 2026-11-12; not done): the founder fills in `docs/spikes/m2-baseline.md` (manual times first, then the engine runs, time saved and rule disagreements).
- [x] AC 4: `docs/security-review-m2.md`: no High; two Low notes (L4, L5).
- [x] Engine review, `docs/spikes/m2-engine-review.md`:
  - F2 fixed: the oracle's head index missed a head up to 1 mm past the coverage radius, depending on where the room sat on the page;
  - F3 fixed: the zone report takes focus, so it scrolls with the keyboard;
  - F1 open (founder decision): the oracle does not see rows that are too far apart; placer layouts keep the rule (104 measured), hand-edited heads are not held to it;
  - `oracle/audit.test.ts` (31 tests) and `engine/m2-review.test.ts` (93 tests), with the test-only helpers `testing/row-audit.ts` and `testing/neighbour-gaps.ts`.
- [x] Zone list rows are memoised (45 zones: 1.7 s → 0.7 s to the status line); the page matrix is built once per paint.

## Dev Notes

- **D1, F1 is left open.** A check that needs no rows gives false alarms on 36 of 105 placer layouts, so the fix needs the rows of the last run. Options are in the review; the founder chooses.
- **D2, the timing test is not in CI.** It runs on the reference laptop against the production build. The keyboard test is in CI and asserts no timing.
- **D3, two performance changes were taken out again** (a repaint per frame for arriving reports, a time budget for the coverage overlay): no measurable difference on the production build.
- **D4, long tasks in development mode** (50–150 ms) come from React's development build. NFR6 is judged on the production build.
- **D5, the baseline note.** The engine was demonstrated locally on 2026-11-10 before the manual times were recorded; `m2-baseline.md` says what to do if a baseline drawing was used.

## Dev Agent Record

### File List

- e2e/keyboard-4541.spec.ts, e2e/perf-4541.spec.ts (new)
- src/core/sprinkler/oracle/check.ts (modified); audit.test.ts (new)
- src/core/sprinkler/engine/m2-review.test.ts (new)
- src/core/sprinkler/testing/row-audit.ts, neighbour-gaps.ts (new)
- src/features/sprinkler/sprinkler-panel.tsx, src/features/viewer/viewer-engine.ts (modified)
- docs/spikes/m2-engine-review.md, docs/spikes/m2-timings.md, docs/security-review-m2.md (new); docs/spikes/m2-baseline.md (modified)
