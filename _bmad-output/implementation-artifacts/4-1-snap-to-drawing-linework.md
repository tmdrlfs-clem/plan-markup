# Story 4.1: Snap to drawing linework

Status: in-progress

## Story

As a drafter,
I want my clicks to snap to the lines of the drawing,
so that measurements and markups land exactly on geometry.

## Acceptance Criteria

1. **Given** an open vector page, **when** the page loads (and only for the active tab's current page, then neighbours lazily), **then** vector segments are extracted in PDF points and a `flatbush` 4.6.2 index is built off the main thread (AR14, AR15, A12): either in a new `engine.worker` (`snap.extract` / `snap.buildIndex` / `snap.query`) fed by the render worker's pdf.js operator list, or by extraction inside `render.worker` with the index in `engine.worker` — choose by measuring transfer cost on L17/L21, record the decision; data crosses workers as transferred `ArrayBuffer`s (Float32/Float64 arrays), never structured-cloned arrays. No main-thread task ≥ 50 ms; the canvas never waits behind extraction (lowest priority, cancellable on page/tab change like 3.4/3.6 work).
2. Segment extraction is refactored from the prototype `C:\bluebeam\tool\src\core\30-vectors.js` (`Tx`, `Ap`, `buildVecIndex`, `segNearest`, `segIntersect`, `vectorSnap`) into `src/core/snap/` — globals → modules, render pixels → PDF points, typed, framework-free (AR26); **refactor, do not copy**. Lines, polylines, rectangles and Béziers (flattened with a tolerance in pt) under the full CTM incl. form XObjects; clipped-out and white-filled-only geometry handling documented; text glyph outlines are NOT snap targets. Cache the index per sha256 + page (memory; IndexedDB optional — record).
3. **Snap resolution** (`src/core/snap/resolve.ts`, pure): given the cursor in page space, a tolerance in CSS px converted by the current zoom, and the enabled sources, return the best candidate with priority endpoint □ > intersection ✕ > midpoint △ > perpendicular ⊥ (when a "from" point is given) > on-line ○, ties by distance; intersections computed locally among segments near the cursor only (bounded work, operation cap for determinism, NFR6). Unit tests run the shipped functions on committed fixture segments (NFR45) incl. near-parallel lines, zero-length segments, huge coordinates, rotated pages.
4. **SnapGlyph** (UX-DR14): while a drawing or measuring tool is active, the cursor snaps and an info-blue glyph (token from 3.8 theme system, `--color-info`, never selection orange) shows the type; the first time each type appears in a session a small text label ("Endpoint", "Midpoint", "Intersection", "On line", "Perpendicular") shows next to it. Drawn on the active overlay canvas, crisp at every zoom/rotation, ≤ 1 frame latency, no React re-render per move. Since measure/markup tools arrive in 4.5+, expose `getSnappedPoint()` / a snap-preview mode used whenever an armed tool in the tool rail is a drawing/measuring tool (check `src/features/workspace/tool-rail.tsx` / `viewerStore.tool`); with Select/Pan/Zoom no snapping. The 3.7 cursor X/Y readout shows the snapped point when snapping.
5. **Toggles:** the 3.7 status-bar snap toggles (content / markup / grid) now drive it: content = drawing linework (this story); markup = markup geometry (no markups yet — wire the source interface, returns nothing); grid = off/unused until a grid exists (wire the interface). State remembered per user (already persisted by 3.7). Holding `Alt` while moving temporarily disables snapping (Revu-like) — or record a different choice if `Alt` conflicts.
6. **Shift constraint:** holding `Shift` with a "from" point constrains the direction to 0/45/90° (in page space after view rotation, i.e. visually horizontal stays horizontal), and snap candidates are projected onto the constraint line; pure function, unit-tested.
7. Performance: on L17/L21 index build time, segment count, memory and query time p95 (< 1 ms) are measured and recorded in the story; the synthetic A0 (`fixtures/private/pdf/synthetic-a0-50mb.pdf`) builds without freezing the UI (record time); pointer moves stay at 60 fps.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on a committed vector fixture with known geometry (generate e.g. `fixtures/pdf/snap.pdf`: a rectangle, two crossing lines, a circle/arc, rotated page) covers: glyph type at endpoint/midpoint/intersection/on-line, toggle off disables, Shift constraint, Alt override, no snapping with the Select tool.

## Tasks / Subtasks

- [ ] **Task 1: Core snap** — `src/core/snap/{extract,index,resolve,constrain}.ts` refactored from the prototype; unit tests on fixture segments.
- [ ] **Task 2: Worker(s)** — `engine.worker.ts` (new, per AR14 protocol: `{type:'snap.<verb>', reqId, payload}` → `result|progress|error`, Zod at boundary, `serializeWorkerError` + `code`) and/or operator-list extraction in `render.worker`; transfer buffers; priority/cancel; per-tab lifecycle (closed with the tab, 3.5).
- [ ] **Task 3: Snap controller + glyph** — main-thread controller (pointer → page space → query → glyph), SnapGlyph renderer on the active canvas, first-use labels, Alt override, Shift constraint, tool gating, status-bar cursor integration.
- [ ] **Task 4: Toggles wiring** — snap-settings store from 3.7 drives sources; markup/grid source interfaces.
- [ ] **Task 5: Fixtures, tests, measurement** — `fixtures/pdf/snap.pdf` generator script, unit + `e2e/viewer-snap.spec.ts`; local L17/L21/A0 measurements recorded; screenshot of a snap glyph on L17 to `fixtures/private/traces/4-1-snap.png` (never commit private files).

## Dev Notes

- This is the first Epic 4 story. Measuring/markup tools come in 4.5+; build snap as a reusable service those stories call. Do not build calibration (4.3) or measurement tools here.
- Builds on Epic 3: per-tab engines/workers (3.5), render worker queue/priority/cancel (3.4/3.6), view transforms `src/core/render/view.ts`, status bar items and snap-settings store (3.7), theme tokens (3.8). Read the 3.5–3.8 story files including review follow-ups first.
- Prototype source is reference only (clean-room rules apply to Bluebeam, not to the founder's own prototype); keep licences/attribution as in AR26.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; snap glyph = info blue; `src/core` framework-free; tests co-located; exact pins (`flatbush` 4.6.2 already chosen); one browser/server at a time; stop Supabase/Docker with their own commands; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1]; FR29, AR14, AR15, AR26, UX-DR14, NFR6, NFR45, A12
- [Source: _bmad-output/planning-artifacts/architecture.md] workers, spatial index, `src/core/snap`
- [Source: C:\bluebeam\tool\src\core\30-vectors.js] prototype vector snap
- [Source: _bmad-output/implementation-artifacts/3-7-status-bar-with-page-size-scale-snap-cursor-and-zoom.md], [3-8-appearance-themes.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
