# Story 9.9: Coverage overlay

Status: done

## Story

As a sprinkler designer,
I want to see the coverage around each head,
so that any gap is obvious.

## Acceptance Criteria

1. Given placed heads, when placement finishes or I toggle the overlay:
   - each head shows a translucent coverage polygon (a circle by default, a square on toggle);
   - areas no head covers are hatched;
   - a toggle takes ≤ 100 ms (FR75, NFR7, UX-DR25).
2. Coverage polygons are clipped by spray shadows from columns and barriers. They are drawn from polygons, so post-MVP obstructions can be added without changing the overlay.
3. The staged fade-in is instant under `prefers-reduced-motion`.

## Tasks / Subtasks

- [x] `core/sprinkler/coverage.ts` (framework-free, mm):
  - `coverageRadiusMm`: Rc = ½·√(Smax² + (Amax/Smax)²), the same radius the oracle uses.
  - `coverageOf(barriers, heads, R, shape, turn)`: each head's polygon is its shape clipped by what it can see.
    - Rays are cast at a 3.75° step (so arcs are drawn within 0.06 % of Rc), at every barrier corner within reach (just either side of it, so shadow edges are exact), and where an edge crosses the circle.
    - Walls, columns and shafts all block spray.
    - A head outside its zone, or inside a hole, has no polygon.
  - Square: the square inscribed in the coverage circle (side Rc·√2, so its area is about Amax). It is turned to the zone's longest outline edge (`squareAngleOf`).
- [x] `features/editor/coverage-overlay.ts`:
  - `coverageStore` holds `on` (default on), `shape` and `fade`.
  - `zoneCoverage` caches each zone's rings in page points. A zone is recomputed only when its outline, its heads, its hazard, the shape or the scale changes, so a toggle is just a repaint.
  - `paintCoverage` paints in layer 2, under the markups:
    - the coverage is one translucent info-blue fill (nonzero union, so overlaps are not darker) with a thin outline;
    - gaps are hatched in canvas red: on an offscreen canvas, the hatch is clipped to the zone, the coverage union is cut out with destination-out, and the result is drawn onto the page.
  - Fade-in:
    - a run sets `holdCoverage()` when it starts and `revealCoverage()` when it ends;
    - the fade takes 400 ms over animation frames, and is instant under reduced motion.
- [x] The 4541 panel shows a Coverage toggle plus Circle / Square buttons once the page's zones have heads.
- [x] Tests:
  - `coverage.test.ts` (6): Rc, full circle and square, wall clipping against the exact circle-segment area, column shadow, square turn, heads outside the zone or in a hole, office floor timing.
  - `coverage-overlay.test.ts` (4): alpha states, fade over frames and under reduced motion, the cache, painting.
  - Panel test and place-run test: the coverage assertions.

## Dev Notes

- **D1, square = the inscribed square of the coverage circle**, turned to the zone's longest edge.
  - Its side is Rc·√2, so its area is 2·Rc². That is ≈ Amax when the spacing is near square (OH1: 12.5 m² against 12 m²).
  - A head's real rectangle (S × L within its row) is not drawn, because the overlay is per head and not per row.
- **D2, gaps are hatched only in zones that have heads.** A zone with no heads yet is not hatched, so the page is not covered in red before placement.
- **D3, coverage from heads in a neighbouring zone does not count across a zone edge.** Open edges between zones are still not modelled (see 9.8 D6), so each zone shows its own heads' coverage only.
- **D4, colours:**
  - coverage is info blue `#2563c9` at an 18 % fill with a 55 % outline;
  - gaps are hatched in canvas danger red `#c8243a`;
  - these are fixed for the white sheet, in every theme.
- **D5, performance.** The office floor (15 zones, 54 heads) takes about 16 ms for both shapes, against a toggle budget of 100 ms. A toggle reads from the cache.
- **D6, the overlay is a view state for the session.** It is not saved per drawing, and it starts on.

## Dev Agent Record

### File List

- src/core/sprinkler/coverage.ts, coverage.test.ts (new)
- src/features/editor/coverage-overlay.ts, coverage-overlay.test.ts (new); measure-tool.ts, index.ts (modified)
- src/features/sprinkler/place-run.ts, sprinkler-panel.tsx, place-run.test.ts, sprinkler-panel.test.tsx (modified)
