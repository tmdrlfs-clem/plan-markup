# Story 9.7: Pattern, ceiling grid and preferences (Fable)

Status: done

## Story

As a sprinkler designer,
I want to choose staggered layouts, align to ceiling tiles and set preferred spacing,
so that layouts match how I would draw them.

## Acceptance Criteria

1. **Options:** given a zone's options, I can set:
   - the pattern (rectangular by default, or staggered);
   - a ceiling grid (tile size and origin; tile-centre stops; mode `preferred` by default, or `required`);
   - a preferred spacing and wall distance within the rule limits (FR74).
2. **Honoured within the hard constraints:** the placer honours these options without breaking a hard rule, and reports when a preference could not be met.
3. **Manual edits:** heads marked as manually edited are fixed inputs for the placer (used by re-run).

## Tasks / Subtasks

- [x] The option mechanics came over in the 9.5 port and are unchanged: staggered rows on the half-offset lattice (§3.10), tile stops as DP candidates with a cost (`preferred`) or as the only candidates (`required`, §3.7), preferences clamped into the cost terms, and locked heads.
- [x] `PlacementNotes.preferences` (`PreferenceReport`):
  - `spacing` / `wallDist`: `{ requested, used (clamped to Smin..Smax / Wmin+1..Wmax), achieved { min, max }, met }`. Spacing is measured as the along-row gaps between neighbouring heads of one row run. Wall distance is measured along the row, from each run's end heads to the wall. Runs are cut by walls and shafts only (bay seams and columns are not walls). Met within max(150 mm, 5 %).
  - `pattern: { requested, extraHeadsVsRectangular }`: a staggered zone also runs the rectangular solve, the way `required` tile mode already runs the unaligned one.
  - `unmet: string[]` has one plain sentence per preference not met. That covers a preference clamped to the rule limits, one not kept everywhere ("head count comes first"), the extra heads from staggering, the extra heads from `required` tile alignment, and heads off tile centres in `preferred` mode.
- [x] The ceiling-grid pitch must be ≥ 100 mm, enforced in the placer (`INVALID_ZONE`) and in the engine protocol (BAD_INPUT). A finer pitch floods the row DP with tile stops.
- [x] `engine/options.test.ts` (39 tests):
  - five options × six rotated seeded zones (one per shape), all oracle-clean: staggered, preferred grid, required grid, preferences, and preferences beyond the rule limits;
  - staggered variants of Z1–Z5 (design §3.10);
  - report contents: kept, clamped, not kept with no extra head, staggered +1 on STAG, required tile grid +0 in the tiled office, grid pitch rejected;
  - re-run with two user-moved heads locked: kept exactly, the rest re-placed, oracle-clean, deterministic;
  - a locked head that breaks a rule is kept, and the oracle flags it rather than moving it.

## Dev Notes

- **D1, report instead of new search.** The options were already part of the 9.5 port. 9.7 adds the "could not be met" reporting (AC 2) and the proof that every option stays oracle-clean across rotated irregular zones.
- **D2, met tolerance max(150 mm, 5 %).** This covers the 50 mm candidate step and rounding. Wall distance is measured along the row only: the perpendicular distance of the first and last rows depends on the bay shape, and the row-set variants already target it. Run ends at an open edge count as wall ends here, and that is reported as is.
- **D3, staggered +1 head is reported, not refused** (spike weak case 2; founder question 4 is still open). STAG (14 × 9 m OH2) costs 1 extra head, and Z1–Z5 cost 0. The comparison doubles the work for staggered zones only. The suggested stagger spacing fix ((n − 1.5) S ≥ L − 2 Wmax) waits for the founder's answer.
- **D4, tile-evenness skew left as is** (spike weak case 3). The DP cost already prefers the stop set with balanced end distances (TILE: 1.8 / 4.2 / 7.8 m). Weighting gap evenness above that is a taste call. A user who wants even gaps can set a preferred spacing (e.g. 3.6 m), and the report says whether it held.
- **D5, locked heads are not validated by the placer.** A user-locked head that breaks a rule (e.g. 20 mm from a wall) is kept where it is, and the oracle flags it in the zone report. The engine never moves a user's head (FR76).
- **D6, test time.** Required and staggered zones run two solves, so the options file takes about 35 s alone. Seeds are cut to one per shape.

## Dev Agent Record

### File List

- src/core/sprinkler/placer/place-zone.ts, index.ts (modified)
- src/core/sprinkler/engine/protocol.ts (modified: minimum tile pitch)
- src/core/sprinkler/engine/options.test.ts (new)
