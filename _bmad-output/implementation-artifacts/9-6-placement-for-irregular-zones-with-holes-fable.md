# Story 9.6: Placement for irregular zones with holes (Fable)

Status: review

## Story

As a sprinkler designer,
I want L, U, T, splayed and column-filled rooms handled,
so that real floor plans work, not just rectangles.

## Acceptance Criteria

1. **Shapes:** given a non-convex zone, a zone with columns or shafts, or zones that share an open edge, the placer:
   - decomposes bays at reflex corners;
   - treats columns per the founder rule (spray shadow + Wmin, no Wmax) and shafts as walls;
   - keeps spacing across bay seams and shared zone edges;
   - adds gap-fill heads only where needed (design §3).
2. **Proof:** the oracle reports zero errors on all feasible fixtures, including the founder's L17/L21-derived zones and 54+ seeded random/rotated zones.
3. **Speed (NFR6):** on reference hardware, a single zone ≤ 200 m² places in ≤ 1 s and a 600 m² floor of ≤ 15 zones in ≤ 5 s, with no main-thread task > 50 ms.
4. **R1:** the large multi-column floor case (spike R1) is improved over the spike result, or documented as a known limitation.

## Tasks / Subtasks

- [x] Placer speed-ups. All of them are exact: the 29 spike reference layouts are still reproduced head for head.
  - `rowShadows`: the shadows a sample casts on a row line, memoised per (sample, row) within a frame. R1 made 1.73 M queries for 0.32 M distinct pairs. The query box spans the sample's whole reach, so the memo is valid for every demand window.
  - `visibleRun`: binary searches over the merged shadow intervals instead of a scan per candidate. It keeps the old index-contiguous semantics: a shadow with no candidate inside it does not break the run (checked call by call against the old code on every fixture).
  - Cross-decomposition cap: once a layout resolves everything with n heads, later decompositions prune their sweeps at n. A decomposition stops at its first bay that leaves samples unresolved or goes over the cap. Gap-fill is skipped where no head fits under the cap.
  - Gap-fill scoring: a direct single-head test instead of a throwaway head grid, plus an exact skip when the in-reach count cannot beat the best so far.
  - Lattice bucketing: the band row bounds are hoisted out of the per-sample loop.
- [x] Frames (D2): 0° is tried only when the two edge-angle peaks carry < 90 % of the outline length.
- [x] Op budget (design §6):
  - `PlaceOptions.opBudget`, default `DEFAULT_OP_BUDGET` = 50 M. It counts DP transitions, sight-line queries and their edge tests.
  - The first (frame, decomposition) always completes. After that, the remaining variants and row sets are skipped once the budget is spent.
  - Notes: `searchTruncated` and `ops`. Deterministic, never wall-clock.
- [x] `testing/zone-generators.ts` (test helper):
  - `irregularZone(seed, shape?)`: seeded L / U / T / splayed / column grid / shaft (+ column) zones, rotated and moved, ELH / OH1 / OH2;
  - `officeFloor()`: 15 zones, 600 m², with a corridor split by a shared open edge.
- [x] `engine/irregular.test.ts` (74 tests):
  - 60 seeded zones (each shape ≥ 10 times): ok, zero oracle errors, coverage 1, not truncated;
  - Smin across bay seams (≥ 10 cut zones);
  - op ceiling 15 M per zone ≤ 200 m², and the heaviest zone timed alone (best of 2) < 2 s (2× headroom);
  - Z2 / U / T / Z5L / Z7 cut and oracle-clean; column with no Wmax; shaft as a wall;
  - the 600 m² floor: 15 zones in < 5 s, zero errors, Smin across the open corridor seam;
  - the op budget: truncated after one variant, deterministic, oracle-clean.

## Dev Notes

- **D1, exact speed-ups.** No change to any 9.5 layout. Local times (Node, single process):

  | Case | 9.5 | 9.6 |
  |---|---|---|
  | R1 (387 m², 6 columns) | 4.2 s | ≈ 2.2 s |
  | COLS | 0.98 s | ≈ 0.5 s |
  | Z8 | 0.77 s | ≈ 0.33 s |

  - Every seeded zone ≤ 200 m²: ≤ 0.6 s, and ≤ 11 M ops for the heaviest.
  - 600 m² 15-zone floor: 0.26 s including the oracle.
  - Placement runs in `engine.worker`, so there is no main-thread task (AC 3).
- **D2, 0° frame gated.** Design §3.2 says "top two peaks plus 0°". On a rotated rectilinear zone, rows on 0° cross every wall: they never won, and they cost about 70 % of the time (G13: 1.0 s of 1.4 s). 0° is now added only when the peaks explain < 90 % of the edge length (curved or many-angled outlines). No fixture changed.
- **D3, budget semantics.**
  - The budget never stops the first complete variant, so a truncated answer is always a full layout (checked: R1 at 1 M ops gives 30 heads with zero oracle errors).
  - Default 50 M: no fixture or seeded zone is truncated (R1 uses 30 M).
  - Cancel stays at zone boundaries (9.5 D3). The worker solve is synchronous, so a cancel between variants would need the solver to yield. Not needed at these times.
- **D4, R1 count is a known limitation: 29 heads, LB 19, unchanged.**
  - Cause (spike weak case 1): the six columns stand 1.2 m off the perimeter walls. The strip behind each one can only be seen from a head on the wall side, so the row model spends an extra row or turned rows.
  - The same zone without its columns takes 20 heads.
  - The fix depends on founder question 3 (spike report): is a column that close to a wall a pier, or a pocket to cover? Column-pocket candidates are deferred until that answer.
  - Speed improved 4.2 → 2.2 s. R1 is a single 387 m² zone, outside the ≤ 200 m² per-zone target.
- **D5, L17/L21-derived zones not added.** Two reasons:
  - A16 gate: the engine must not run on the founder's drawings until the B1–B3 manual times are in `docs/spikes/m2-baseline.md`.
  - NFR26: client drawing content stays out of the repo.
  
  The 60 seeded zones and the synthetic office floor stand in for them. Derived zones get added after the A16 baseline is recorded.
- **D6, perf checks in CI.** Wall-clock asserts failed under the 16-worker parallel suite (one zone took 2.2 s under load). The suite therefore asserts:
  - the deterministic op ceiling;
  - the heaviest zone timed alone;
  - the floor wall-clock against its 5 s budget (0.26 s locally).
- Local full-suite runs time out a few unrelated UI tests while Docker is running (known, PM 17). They pass in isolation.

## Dev Agent Record

### File List

- src/core/sprinkler/placer/place-zone.ts, index.ts (modified)
- src/core/sprinkler/testing/zone-generators.ts (new, test helper)
- src/core/sprinkler/engine/irregular.test.ts (new)
