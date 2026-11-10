# M2 timings: Place heads (NFR6)

Date: 2026-11-10 · Story 9.13

NFR6: the 4541 engine places heads for a single zone ≤ 200 m² in ≤ 1 s and for a 600 m² floor of ≤ 15 zones in ≤ 5 s, without freezing the UI (no main-thread task over 50 ms).

**Result: met, with a wide margin.**

## Reference hardware

- Laptop: Intel Core i5-1145G7 (11th gen, 4 cores, 2.6 GHz), 16 GB RAM, Windows 11.
- Chromium (Playwright), viewport 1600 × 900, production build (`npm run build`, `E2E_PROD=1`).
- Docker Desktop with the local Supabase stack was running at the same time.

## In the app (click to done)

Measured in the page, from the click on **Place heads** to the status line saying the run is done. That includes the worker round trip, the head markups written and the panel painted. Long tasks are counted from the click until one second after the run, so the coverage overlay fading in and the re-check of each zone are included.

| Case | Zones | Area | Heads | Time (range over 4–7 runs) | NFR6 limit | Main-thread tasks over 50 ms |
|---|---|---|---|---|---|---|
| One zone, 14 × 14 m, ELH | 1 | 196 m² | 16 | 223–324 ms | 1,000 ms | none |
| Floor, 5 × 3 rooms of 5.8 × 6.9 m, ELH | 15 | 600 m² | 60 | 413–492 ms | 5,000 ms | none |
| Beyond NFR6: 9 × 5 rooms of 3.2 × 4.1 m | 45 | 595 m² | 45 | 656–797 ms | not set | none |

How to repeat: `npm run build`, then `E2E_PROD=1 PERF_M2=1 npx playwright test perf-4541` (`PERF_M2_BIG=1` adds the 45-zone case). The test is skipped in CI: timings on a shared runner say nothing.

## Engine alone (Node, no browser)

Placer and oracle together (`placeSite`), median of 5 runs.

| Case | Time | Heads | Oracle errors |
|---|---|---|---|
| One zone, 14 × 14 m, ELH | 106 ms | 16 | 0 |
| One zone, 14 × 14 m, OH1 | 86 ms | 18 | 0 |
| Office floor fixture, 15 zones, 600 m² | 220 ms | 54 | 0 |

The unit tests also hold every seeded irregular zone ≤ 200 m² under a fixed operation ceiling, so a slow zone fails CI without depending on the runner's speed.

## What was changed while measuring

- **The zone list no longer re-renders every row on every update.** During a run the panel's state changes with each zone placed and each report. Every row, with its use list, rendered again each time, so the work grew with the square of the zone count. Rows are now memoised.
  - 15 zones: no change (429–488 ms before, 413–492 ms after).
  - 45 zones: 1,623–1,713 ms before, 656–797 ms after.
- **The page matrix is built once per paint**, not once per point converted.
- Two other changes were tried and taken out again because they made no measurable difference: one repaint per frame for arriving reports, and a time budget for computing the coverage overlay.

## A note on development mode

In development mode (`npm run dev`) the same runs show main-thread tasks of 50–150 ms. They come from React's development build and are not present in the production build. NFR6 is judged on the production build.
