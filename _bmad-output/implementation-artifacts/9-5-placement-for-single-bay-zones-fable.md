# Story 9.5: Placement for single-bay zones (Fable)

Status: done

## Story

As a sprinkler designer,
I want heads placed automatically in simple rooms,
so that a rectangular or convex room is done in one click.

## Acceptance Criteria

1. **Search and rows:** given a rectangular or convex zone with a hazard class, `src/core/sprinkler/placer` runs in `engine.worker`. It searches grid frames (≤3 angles, each also turned 90°) and places rows with the exact 1-D optimisation per row. All rules are hard constraints, with no repair pass (design §3, FR73).
2. **Objective:** head count first, then deviation from the preferred spacing and wall distance, then alignment (A8).
3. **Proof:** the oracle reports zero errors on every feasible fixture, and the output is identical across runs.
4. **Errors:** an infeasible zone returns a typed error with a location and a reason (e.g. `NO_ADMISSIBLE_REGION`).

## Tasks / Subtasks

- [x] `placer/geometry.ts`: the placer's own kernel. It is a typed port of the spike `geometry.js`: rings, point-in-region, segment blocking, rotation, clean/simplify, intervals, and a `SegIndex` for sight and clearance queries.
- [x] `placer/place-zone.ts` `placeZone(input, figures, {idPrefix?})`, a typed port of the spike placer:
  - **Input:** `PlaceInput = { zoneId, barriers: PlacerBarrier[] (wall | column | shaft), openEdges?, keepOuts?, pattern?, prefs?, grid?, locked?, neighbourHeads?, frameDeg? }`. It is the same `Barrier[]` shape the oracle takes (§9.5 hook).
  - **Preparation (§3.6):** zone-local mm, clean, orient, validate.
  - **Search:** an admissible probe; frames (§3.2) from the edge-angle histogram, top 2 peaks plus 0°, each also turned 90°; decompositions none / cutH / cutV (§3.3); row-set variants, bands and demands (§3.4); the exact stabbing DP per row; bounded, labelled gap-fill.
  - **Score:** `(unresolved + H4, heads, gapFill, cost, frame, decomposition)`, compared lexicographically.
  - **New:** keep-out avoidance. Candidate and gap-fill positions inside a keep-out or its clearance (+0.5 mm) are not admissible.
  - **Output:** deterministic head ids `${prefix}${zoneId}:${bay}:${row}:${k}`, kinds row / gapFill / locked, and notes (frame, decomposition, bays, rows, variants tried, tile alignment).
  - **Typed errors:** `INVALID_ZONE` (located at the crossing or at the bad ring), `NO_ADMISSIBLE_REGION` (at the zone centroid, plus the outline), and `UNCOVERABLE_PIECE` (the unreached sample points).
- [x] `engine/site.ts`: the composition layer, the only module that sees both the placer and the oracle.
  - `placeInSequence`: earlier zones' heads are neighbours.
  - `checkPlacement`: the oracle on the original zone, with the other zones as neighbours.
  - `placeSite`.
- [x] `engine/protocol.ts`: Zod-validated requests `place` / `check` / `cancel` and the replies `progress` / `zoneResult` / `checkResult` / `done` / `error` (BAD_INPUT | INTERNAL, no stacks), per design §7.
- [x] `src/workers/engine.worker.ts`: `EngineHost`. Placement and checks run off the main thread. It yields between zones, so a cancel stops a running request at the next zone boundary (`done { cancelled: true }`).
- [x] Independence (AR24):
  - a new ESLint block lets placer sources import only `./` siblings and refuses the oracle;
  - `placer-independence.test.ts` checks both directions;
  - `tools/lint/boundaries.test.ts` has two new probes.
- [x] Tests:
  - `placer/place-zone.test.ts` (47):
    - all 29 spike reference layouts reproduced head for head (ids, positions within 0.06 mm);
    - determinism; translation, rotation (23°) and vertex-order invariance;
    - the textbook 10 × 6 m OH1 grid; corridor; preferences without extra heads; Wmin and Smin; keep-outs (circle and ring); locked heads; preferred tile grid;
    - Z10 `NO_ADMISSIBLE_REGION` located; INVALID_ZONE cases; NFR6 200 m² < 1 s.
  - `engine/site.test.ts` (47):
    - zero oracle errors and full coverage on every feasible fixture × hazard, keep-outs included (R1, R2);
    - multi-zone determinism; Z10 has no report;
    - 16 seeded convex zones, each one bay with zero oracle errors.
  - `workers/engine.worker.test.ts` (6): stream order, a typed error in a zone result, check, cancel, bad input, a stray cancel.

## Dev Notes

- **D1, full faithful port:** the spike placer is one intertwined algorithm (decomposition, columns, stagger and tile grid share the row sweep), so it was ported whole rather than cut down to single-bay. 9.5 proves the single-bay path (rectangle, corridor, convex, rotated). The irregular, hole and pattern code paths are already exercised by the fixture-equality and oracle tests. 9.6 and 9.7 add their own targeted tests and fix the known weak cases (R1 multi-column at about 4 s and 29 vs LB 19; tile-stop gap skew).
- **D2, keep-outs:** the spike ignored keep-outs. The placer now refuses positions inside a keep-out or its clearance (oracle limit + 0.5 mm margin). R1 and R2 change from the spike output there, and they pass the oracle with zero errors.
- **D3, cancel granularity:** cancel is honoured between zones. One zone is not interrupted, and R1 takes about 4 s alone. The op-count budget with a best-so-far answer (design §3.8) comes with the R1 speed work in 9.6.
- **D4, not wired to the UI yet:** the worker is built and tested through `EngineHost`. The panel button and `new Worker(...)` come in 9.8 (Place heads from the panel).
- **D5, reduced wall distance:** the production rule set has no `WmaxReduced` figure (the spike had one), so `reducedWallDist` is not in the input. It comes back as a verified named table when the founder confirms the figure.
- **D6, objective detail kept from the spike:** with no preferred spacing, the gap cost is `g²` (compact rows). A preferred wall distance on its own is therefore weak against it. Setting both preferences gives the exact preferred layout (tested: 1.0 m wall distance, 4.0 m spacing, same head count).
- **Timing (Node, vitest):** 200 m² OH1 rectangle about 40 ms; Z2 L-shape about 140 ms; R1 (385 m², columns) about 4 s, the same as the spike.
- **A16 gate:** still open. The engine has run on synthetic fixtures only. The founder's B1–B3 baseline times must be recorded in `docs/spikes/m2-baseline.md` before it runs on those drawings.

## Dev Agent Record

### File List

- src/core/sprinkler/placer/geometry.ts, place-zone.ts, index.ts, place-zone.test.ts, placer-independence.test.ts (new)
- src/core/sprinkler/engine/site.ts, protocol.ts, site.test.ts (new)
- src/core/sprinkler/testing/zone-fixtures.ts (new, test helper)
- src/workers/engine.worker.ts, engine.worker.test.ts (new)
- eslint.config.mjs; tools/lint/boundaries.test.ts
