# Story 4.1: Snap to drawing linework

Status: review

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

- [x] **Task 1: Core snap** — `src/core/snap/{extract,index,resolve,constrain}.ts` refactored from the prototype; unit tests on fixture segments.
- [x] **Task 2: Worker(s)** — `engine.worker.ts` (new, per AR14 protocol: `{type:'snap.<verb>', reqId, payload}` → `result|progress|error`, Zod at boundary, `serializeWorkerError` + `code`) and/or operator-list extraction in `render.worker`; transfer buffers; priority/cancel; per-tab lifecycle (closed with the tab, 3.5).
- [x] **Task 3: Snap controller + glyph** — main-thread controller (pointer → page space → query → glyph), SnapGlyph renderer on the active canvas, first-use labels, Alt override, Shift constraint, tool gating, status-bar cursor integration.
- [x] **Task 4: Toggles wiring** — snap-settings store from 3.7 drives sources; markup/grid source interfaces.
- [x] **Task 5: Fixtures, tests, measurement** — `fixtures/pdf/snap.pdf` generator script, unit + `e2e/viewer-snap.spec.ts`; local L17/L21/A0 measurements recorded; screenshot of a snap glyph on L17 to `fixtures/private/traces/4-1-snap.png` (never commit private files).

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Local: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 1459 unit tests in 131 files; e2e on the production build (`E2E_PROD=1`, workers 1): 45 passed, 8 skipped (opt-in private checks). `viewer-snap` failed once in the full run: the HintBar that arming Length shows moved the canvas after the test had read its position; the spec now waits for a stable canvas (3 × 2 consecutive green runs since).
- Supabase on locally remapped ports 583xx (Windows reservation), restored afterwards, never committed.
- **Measurements** (A10 machine; `e2e/perf-snap.spec.ts`, production build, Chromium, 1920 × 1080, DPR 1; and `node` on the same core functions):

| Drawing | Operators | Segments | Operator list (pdf.js parser) | Extraction | Index build | Index memory | Ready → index | Query p50 / p95 (node, 5000 queries) | Longest main-thread task while building / sweeping | Sweep fps p50 / p5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L17 | 175 979 | 210 621 | 804 ms | 43 ms | 41 ms | 15.0 MB | 0.8-1.3 s | 0.037 / 0.081 ms | 0 / 0 ms | 60 / 60 |
| L21 | 185 676 | 225 386 | 1 076 ms | 26 ms | 51 ms | 16.1 MB | 1.3 s | 0.041 / 0.083 ms | 0 / 0 ms | 60 / 60 |
| Synthetic A0 | 159 002 (9.66 M path segments) | 1 000 000 (cap, truncated) | 4 071 ms | 150 ms | 166 ms | 71.4 MB | 7.3 s | 0.055 / 0.101 ms | 0 / 0 ms | 60 / 60 |

  The UI never froze: every build ran in the worker; the main thread only wraps the transferred buffers (`Flatbush.from`, 1.5 ms on L17, 8.7 ms on A0). Screenshot of an endpoint glyph on L17 at 200 %: `fixtures/private/traces/4-1-snap.png` (reviewed; not committed).

### Completion Notes List

- **Task 1 (core, `src/core/snap/`)**, refactored from the prototype (`Tx`/`Ap` → `concat` and inline transforms; `extractVectors` → `extractSegments`; `buildVecIndex` → `buildSnapIndex` over flatbush instead of a hashed grid; `segNearest`/`segIntersect` → `nearestOnSegment`/`intersect`/`perpendicularFoot`; `vectorSnap`'s score → strict priority), not copied: PDF user space points instead of render pixels, typed, no globals.
  - `extract.ts`: replays the pdf.js 6.4 operator list (`constructPath` with its `[paintOp, [DrawOPS data], minMax]` form) under the full CTM (save/restore, `cm`, form XObject matrices). Béziers (and quadratics) are flattened by Wang's formula to 0.1 pt. Every segment carries flags: a curve's inner joints are neither endpoints nor midpoints. **Not targets:** clip-only / unpainted paths (`endPath`), paths only filled in white (wipeouts), text (glyphs never appear as paths; image masks are skipped). **Clipped-out geometry stays a target** (clipping segments would need polygon clipping per path; drawings rarely clip their linework); segments wholly outside the page box are dropped. A segment cap (1 M, ~71 MB) bounds memory; `truncated` is reported.
  - `index.ts`: flatbush 4.6.2 over the segment boxes; one ArrayBuffer, so it is transferred, and `SnapIndex.near` returns the nearest boxes first, at most `limit`.
  - `resolve.ts`: endpoint > intersection > midpoint > perpendicular (with a "from" point) > on line, ties by distance; at most 96 segments read and intersections among the 32 nearest only (NFR6); computed relative to the cursor (huge coordinates keep precision); near-parallel lines, zero-length / non-finite segments and segments that only meet end to end produce no intersection.
  - `constrain.ts`: the 45° steps are chosen on screen (after /Rotate, UserUnit and the view rotation) and carried back to user space; candidates are projected onto the line.
  - Unit tests run the shipped functions on the committed `fixtures/pdf/snap.pdf` (rectangle, crossing lines, circle, white fill, clip, text, form XObject; a /Rotate 90 page with an off-origin MediaBox) and on synthetic lists (nested transforms, zero length, huge coordinates, caps, unknown opcodes, near-parallel lines).
- **Task 2 (worker).** `snap.buildIndex { page }` in the protocol, handled by the render worker (see the topology decision). It reads the page's own operator list (a separate pdf.js intent with annotations off: the render's list cannot be read, rendering turns each path into a Path2D), extracts, builds and transfers the coordinates, flags and index buffers. Lowest priority (after tiles, text and thumbnails); while pdf.js reads the list it waits off the queue's head, so tiles never wait behind it (test); cancellable like any job; pdf.js's copy of the list is dropped afterwards.
- **Task 3 (controller, glyph).** `SnapController` (one per engine, so per tab): builds the current page's index at settle, then the neighbours one at a time; cancelled on page change, background tab and close; indices cached per sha256 + page in memory, shared by tabs, 160 MB budget (IndexedDB caching not done: the build is ~1 s on L17, mostly pdf.js). The engine snaps in the pointer's animation frame only with a drawing/measuring tool; the glyph (□ ✕ △ ⊥ ○) is drawn on the overlay canvas at whole device px in the theme's `--canvas-snap` blue over a white halo, the name ("Endpoint", …) the first time each type appears in the session. The status bar shows the snapped point (the cursor store holds it). `getSnappedPoint()` and `snapFromPoint` for the tools of 4.5+. `data-snap`, `data-snap-index`, `data-snap-build` on the canvas for e2e and diagnostics.
- **Task 4 (toggles).** The status-bar toggles choose the sources: content = the linework; `extraSnapSources.markup` / `.grid` are the slots for Epic 5's markups and a grid (empty now, test with a stub source). Alt held suspends snapping; Shift with a "from" point holds 45° steps.
- **Task 5.** `fixtures/pdf/snap.pdf` + `scripts/fixtures/make-snap-fixture.mjs` (deterministic), `e2e/viewer-snap.spec.ts` (CI: endpoint, intersection, midpoint, on line, the status bar readout, Alt, Shift, toggle off, Select never snaps), `e2e/perf-snap.spec.ts` (local), measurements above.

**Decisions and deviations (for review):**

1. **Worker topology: extraction and index build in `render.worker`, queries on the main thread; no `engine.worker` yet** (AR14 names one). Measured: the operator list is the cost (0.8-1.1 s on L17/L21, 4 s on A0) and only the render worker holds the parsed document; a separate engine worker would need a second pdf.js parse of the whole file (~1.2-4.5 s and the file's memory again) or a structured clone of the operator list. Extraction + build are 70-100 ms on L17/L21 (300 ms on A0), well below a tile's old cost, and run as the last job. The index arrives as three transferred buffers (zero copy; `Flatbush.from` 1.5 ms on the main thread), and a query is 0.04-0.1 ms p95, so querying in the pointer frame needs no worker round trip (which would add a frame of latency, AC 4). `engine.worker` comes when fill / 4541 need it.
2. **Length is armed for its snapping preview** (no drawing/measuring tool exists before 4.5): it is enabled in the tool rail with a HintBar note; a click only sets the "from" point. No keyboard shortcut for it yet (Shift+Alt+L needs Alt, which the viewer's key handling leaves alone).
3. **Alt** is kept as the override (Revu-like); over the canvas with Length, its keydown is `preventDefault`ed so the browser's menu does not take it.
4. **Glyph colour** is `--canvas-snap` (the info blue checked at 3:1 on the white sheet and on the backdrop, Story 3.8), not `--info` (the chrome's info blue, 2.4:1 on white in Blueprint).
5. **The snap tolerance** is 12 CSS px (the prototype's 13 px, rounded to the 4 px grid's half).
6. **Annotations are not linework**: the operator list is read with annotations off; existing PDF annotations would be the markup source later.
7. The segment cap is 1 M (the A0 stress file keeps its first 1 M of 9.66 M segments); A0 is a synthetic stress file, real sheets are ~0.2 M.

### File List

- `src/core/snap/extract.ts`, `index.ts`, `resolve.ts`, `constrain.ts` and their tests (new)
- `src/features/viewer/snap-controller.ts`, `snap-controller.test.ts` (new)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-input.ts`, `viewer-input.test.ts`, `viewer-store.ts` (modified)
- `src/features/workspace/tool-rail.tsx` (modified)
- `src/components/ui/tokens.ts`, `viewer-palette.test.ts` (modified)
- `src/workers/render-protocol.ts`, `render.worker.ts`, `render.worker.test.ts`, `render-pdfjs.ts` (modified)
- `fixtures/pdf/snap.pdf`, `scripts/fixtures/make-snap-fixture.mjs` (new); `fixtures/README.md` (modified)
- `e2e/viewer-snap.spec.ts`, `e2e/perf-snap.spec.ts` (new)
- `_bmad-output/implementation-artifacts/4-1-snap-to-drawing-linework.md`, `sprint-status.yaml` (modified)

### Change Log

- 2026-10-24: Story 4.1 implemented (Claude Opus 5.5): snap core, worker build, controller and glyph, toggles, e2e and measurements. Status → review. Commits 224e263, 9f8c059, f8bd430 and the Task 5 commit.
