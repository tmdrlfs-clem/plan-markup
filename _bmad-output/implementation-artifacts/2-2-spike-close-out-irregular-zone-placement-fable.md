# Story 2.2: Spike close-out — irregular-zone placement (Fable)

Status: in-progress

## Story

As the founder,
I want the placement spike results confirmed and its decisions recorded,
so that Epic 9 starts from a proven algorithm and agreed rules.

## Acceptance Criteria

1. **Given** the prototype in `spikes/4541-placement/` (placer, independent oracle, 25 samples, demo), **when** the column rule of 2026-10-17 is checked (columns block spray and need `Wmin`; `Wmax` does not apply to column faces) and the suite reruns, **then** `node test/run.mjs` exits 0 with zero oracle errors on all feasible samples and located errors on infeasible ones.
2. `docs/spikes/2-2-placement-report.md` records: head counts vs hand counts and area lower bounds per sample; timing for the 200 m² zones (≤ 1 s, NFR6) and for R1; known weak cases (large multi-column floors such as R1, staggered +1 head, tile-alignment spacing skew, keep-outs not implemented) each with cause and a proposed fix for Epic 9; deviations from `docs/4541-placement-design.md`; and a go / change decision.
3. The geometry kernel for Epic 9 is chosen and pinned: either a Clipper2 JS/WASM binding (exact package + version, licence, bundle size, worker compatibility) or the spike's own kernel (with the reasons and what it lacks). Recorded as an ADR `docs/decisions/0004-geometry-kernel.md`.
4. All sample zones are exported as JSON to `fixtures/zones/*.json` (one file per zone, real mm, outer ring + holes tagged `column` / `shaft`, hazard class, pattern, grid/keep-outs where present, expected result: hand count, LB, or expected error code) by a script, plus a schema note in `fixtures/README.md`. The suite reads the samples from these files (single source of truth) and still passes.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` still pass (the spike is plain JS outside `src/`; do not wire it into the app).

## Tasks / Subtasks

- [x] **Task 1: Confirm the column rule** (AC 1): read `oracle.js` / `placer.js` column handling (already implemented with a ≤ 1 m extent heuristic) against design doc decision 4; replace the heuristic with explicit hole tags (`kind: "column" | "shaft"`) in the zone data, keeping the heuristic only as a fallback for untagged holes. Add/keep tests: Z6 (3 columns) = 15 heads; Z7 (4 m shaft) keeps `Wmax` on shaft faces; a column-face `Wmax` mutation is **not** flagged; a head within `Wmin` of a column **is** flagged.
- [ ] **Task 2: Rerun and measure** (AC 1, 2): run the suite twice (determinism), capture the table, random-zone stats, mutations and timings.
- [ ] **Task 3: Weak cases** (AC 2): investigate R1 (387 m², 34 heads vs LB 19, ~2.5 s) enough to name the cause and a concrete Epic 9 fix (e.g. bay decomposition around columns, frame search budget); same for staggered +1 and tile-alignment skew. Improve the prototype only if a fix is small and safe; otherwise document.
- [ ] **Task 4: Kernel decision** (AC 3): evaluate Clipper2 bindings available on npm (e.g. `clipper2-js`, `clipper2-wasm`, `clipper-lib` for Clipper1) — maintenance, licence, size, offset/boolean/point-in-polygon coverage, runs in a Web Worker, deterministic integer coordinates — vs the spike kernel. Write ADR 0004 with the pin.
- [ ] **Task 5: Fixtures** (AC 4): `spikes/4541-placement/export-zones.mjs` writes `fixtures/zones/<slug>.json`; switch `zones.js` / `test/run.mjs` to load them; document the format.
- [ ] **Task 6: Report + README** (AC 2): write the report, update the spike README results, rebuild `dist/demo.html`.

## Dev Notes

- Founder decisions: column rule option a (2026-10-17); holes are explicitly tagged column vs shaft/void in the product; keep-outs (downlights) are not in the spike; obstruction library is post-MVP (design doc §9).
- Rule figures in `src/rules.js` are DRAFT v1 (Smin 1.8 m, Wmin 50 mm) — do not change figures; the founder confirms them against NZS 4541 separately.
- The oracle must stay independent: it imports nothing from the placer or its kernel (same rule as the ESLint `PLACER_BAN` in the app).
- Last measured (2026-10-22): suite exit 0, 54 random zones 0 failing (max 1003 ms), 200 m² cases 42 / 265 / 74 ms, R1 34 heads in 2525 ms, all 5 mutations caught.
- Node warns `MODULE_TYPELESS_PACKAGE_JSON` for the spike's ES modules; add a `spikes/4541-placement/package.json` with `"type": "module"` (do not change the root package.json).
- Code, comments, docs and commits in English. Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2]
- [Source: docs/4541-placement-design.md] decisions block, §3 algorithm, §4 oracle, §5 test plan (Z6, R1), §9 post-MVP
- [Source: _bmad-output/planning-artifacts/architecture.md] Clipper2 choice deferred to this spike (line ~523)
- [Source: spikes/4541-placement/README.md] previous results

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
