# Story 9.14: Head placement that looks like a person did it

Status: review

## Story

As a sprinkler designer,
I want the engine to place heads where I would have put them, and to show set-out distances,
so that a layout needs little moving before it is issued and can be used on site.

Source: founder feedback during the sample comparison session (2026-11-12). Time does not matter. What counts is that head positions match a person's. Samples and algorithm need not be perfect: one drawing cannot carry every fact, so unclear cases may be a little wrong.

## Acceptance Criteria

1. **Head lines.** The 4541 panel has "Add head line". A line drawn with it is stored as a guide, not a markup to export.
   - The placer puts a row of heads on each line along the rows.
   - Lines across the rows become preferred columns.
   - The longest line sets the row direction.
   - Lines too short or at an odd angle are ignored and counted in the notes.
2. **Aligned rows by default.** A layout whose heads sit on clearly fewer row and column lines replaces the fewest-heads layout. It may use at most max(1, 10 %) extra heads and must save 2 lines per extra head.
   - It is not taken when rows would end up too far apart.
   - The panel says how many extra heads it cost.
3. **Dimensions toggle.** "Dimensions" in the coverage controls shows head-to-head, head-to-wall and head-to-column distances.
   - Repeated rows are dimensioned once.
   - The dimensions are exported and printed while the toggle is on.
   - They are never stored or listed.
4. **Report label.** The spacing row in the zone report reads "Nearest head" (M2 review F1, option 3).
5. **Sample comparison harness.** `tools/sample-compare` runs the engine on cases taken from designers' drawings and writes the differences. It is skipped unless `SAMPLES_DIR` is set.

## Tasks / Subtasks

- [x] F1 report label (`core/sprinkler/report.ts`).
- [x] Sample comparison harness (`tools/sample-compare/sample-compare.test.ts`, af51128).
- [x] Head lines (guides):
  - `PlaceInput.guides`; frame from the longest line; row variants on lines; cross lines as preferred columns (0c7cb5c);
  - `guide` flag on the markup schema; `guidesOfZone`; "Add head line" in the panel (0a5f42a).
- [x] Dimensions toggle (`core/sprinkler/dimensions.ts`, `features/editor/head-dimensions.ts`, panel, canvas, export) (31d661a).
- [x] Aligned rows:
  - zone level and inside a bay (8c29422, 98e0958);
  - `rowsTooFarApart` fallback;
  - `notes.aligned.extraHeads` in the panel (5cd9435).
- [x] CI: Chromium install no longer hangs when the Ubuntu archives are unreachable (fdc15d7).
- [x] Tests: `guides.test.ts`, `dimensions.test.ts`, `guide-draw.test.ts`, panel and place-run tests. The spike reference test runs with `alignRows: false`.
- [ ] Founder checks Add head line, Dimensions and aligned rows in the app.

## Dev Notes

- **Results against samples** (`plan-markup-samples/_work/compare-*.html`). Engine heads were matched to the designer's heads; the median distance between matched pairs:

  | Sample | Without head lines | With head lines |
  |---|---|---|
  | Meeting rooms A/B, 6 heads each | 0.8 m | 0.61 m with row lines; ≈0 with row and cross lines (one head 0.71 m off at the coverage limit) |
  | Corridor C, 4 heads | – | 0 |
  | Long office E, 14 heads | – | engine now 12, in straight columns at 1790/5369 mm (designer 1781/5366) |
  | U-shaped room F, 5 heads | 0.53 m | – |

  - Shop D gives 12 vs the designer's 9. It is an alteration job, treated as an exception.
  - The Bayleys sheet was compared by eye only: its pitch is in the same range as the ceiling grid mode (3.6 × 4.2 m).
- **D1, head lines over automatic light reading.** The founder chose to draw head lines (option 2) rather than have the engine read light fittings.
- **D2, aligned rows default on.** The default is on. `PlaceOptions.alignRows: false` gives the fewest-heads layout.
- **D3, dimensions are derived.** Dimensions are computed from zones and heads each paint (cached per zone). Nothing is saved, so they never go stale.
- **Open:** a local full vitest run can time out under load (convert.test, irregular.test). Both pass alone and in CI.
