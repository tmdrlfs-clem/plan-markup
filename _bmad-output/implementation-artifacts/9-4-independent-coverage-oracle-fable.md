# Story 9.4: Independent coverage oracle (Fable)

Status: done

## Story

As a sprinkler designer,
I want every layout checked by an independent checker,
so that I can trust the report even if the placer has a bug.

## Acceptance Criteria

1. **Checks:** given a zone, its barriers and a set of heads, `src/core/sprinkler/oracle` samples its own grid (100 mm or finer, with boundary points). It checks:
   - coverage;
   - wall distance: Wmax applies on walls and zone edges, not on column faces;
   - Wmin clearance on walls and columns;
   - spray shadow behind columns and barriers;
   - minimum and maximum spacing;
   - zones that touch without a wall, across the shared edge.

   Area per head over Amax is a warning (design §4, founder decisions).
2. **Independence:** the oracle imports nothing from the placer. Lint and a CI test enforce this (AR24).
3. **One input:** walls, holes and future obstructions all arrive as one `Barrier[]` input (§9.5 hook).
4. **Fixtures:** the NFR9 named zones (rectangle, L-shape, triangle, diagonal wall, corridor) and the spike fixtures are in `fixtures/zones/` with tests. Mutation tests (missing head, moved head, duplicate, head near a wall, too few heads) must all be caught.

## Tasks / Subtasks

- [x] `oracle/kernel.ts`: the oracle's own geometry (signed area, winding point-in-ring, point–segment distance, proper crossing, an edge grid with sight queries). Deliberately duplicated.
- [x] `oracle/check.ts` `checkZone(zone, heads, figures, {neighbours?, ruleSet?})`:
  - `OracleZone = { barriers: Barrier[] (wall | column | shaft), openEdges?, keepOuts? }`;
  - checks C1–C7 from the spike oracle (Story 2.2), ported to typed TS;
  - new: `IN_KEEPOUT` (ring or circle, with clearance);
  - flags carry the code, severity, heads, location, value and limit.
- [x] Independence:
  - a new ESLint block for oracle sources refuses `@/*`, `../*` and `node:*`, on top of the placer ban;
  - `oracle-independence.test.ts` scans the imports;
  - `tools/lint/boundaries.test.ts` was updated: the old "clean" case imported `@/core/geometry/units`, which is now refused.
- [x] Reference layouts: `scripts/fixtures/make-zone-layouts.mjs` (`--check`) writes `fixtures/zones/layouts/*.json` (29 sample × hazard files) from the spike placer as test data. The format is in `fixtures/README.md`.
- [x] Tests `oracle/check.test.ts` (40):
  - every layout has zero errors, keep-outs included; the area agrees with the fixture lower bound; determinism;
  - goldens: the textbook Z1 OH1 grid (figures, Rc 2.5 m), and a removed corner head whose gap is within 5 % of a 20 mm integration;
  - mutations on Z1–Z5 × ELH/OH1: every single missing head, a moved head, a duplicate at 1.5 m, a head 30 mm from a wall, too few heads (AREA_ZONE warning), a head outside;
  - the column / shaft rule (Z6, Z7), spray shadow, open edge across zones, keep-outs.

## Dev Notes

- **D1, port, not rewrite:** the oracle is the Story 2.2 spike oracle in TS. It was written to design §4 from the spec, separately from the spike placer, and with its own kernel, and the spike suite exercised it. Production placement (9.5+) is new code, so independence holds at the code level, and the lint rule and test enforce it.
- **D2, reference layouts are data:** they come from the spike placer, so the oracle tests do not wait for 9.5. Once the production placer exists, its own outputs are checked by this oracle in its tests.
- **D3, moved-head mutation:** 0.6 m for OH, 1.2 m for ELH. The reference Z1 layout has 6 heads, more than ELH needs (LB 3), so its reach absorbs 0.6 m.
- **D4, deferred:** the exact Voronoi-vertex cross-check (§4.3, P9) and the property tests (P1–P8) come with the placer (9.5/9.6), where random zones get layouts to check.
- **Timing:** R1 (385 m², 29 heads) checks in about 150 ms in Node. Z1 takes about 10 ms.
- **Not run on B1–B3:** the oracle ran on synthetic fixtures only, so the A16 baseline gate (founder times before the engine) still holds for 9.5+.

## Dev Agent Record

### File List

- src/core/sprinkler/oracle/kernel.ts, check.ts, index.ts, check.test.ts, oracle-independence.test.ts (new)
- scripts/fixtures/make-zone-layouts.mjs (new); fixtures/zones/layouts/*.json (new, 29); fixtures/README.md
- eslint.config.mjs; tools/lint/boundaries.test.ts
