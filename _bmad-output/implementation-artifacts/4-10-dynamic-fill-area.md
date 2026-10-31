# Story 4.10: Dynamic fill area

Status: review

## Story

As a drafter,
I want to press and hold inside a room to fill it,
so that I get a room area without clicking every corner.

## Acceptance Criteria

1. **Dynamic fill** (the measure menu, or `J` with the canvas focused): pressing and holding inside a room starts a fill that **visibly spreads every animation frame** from the pointer in a near circle, stopped by the drawing's lines; dragging while holding seeds the fill along the way; releasing pauses it, pressing again adds more (FR28).
2. **Speed (NFR5):** the spread accelerates while held (about 8 CSS px of radius per frame for the first second, 24 after), so a room that fills the view completes within 2 s of holding; a typical room (≤100 m²) completes within 2 s.
3. **Barriers:** the page's vector linework (the 4.1 snap index: straight lines and flattened curves) and the page's Length and Polylength measurements (so a line drawn across a doorway closes it) stop the fill; text does not.
4. **Brushes:** `Shift` + drag paints fill under a brush (18 CSS px) and lets the spread continue through what it painted; `Ctrl` + drag erases under the brush. `Ctrl+Z` / `Backspace` undo the last stroke (a hold, a paint or an erase stroke) while filling.
5. **Result:** `Enter` (or a double-click) traces the filled region into an **area markup** (Story 4.8: outline in the measure style, area and perimeter caption, "Add area", one undo step); regions enclosed by the fill (furniture outlines, hatching islands) count as part of the room unless erased (erased islands become `holes`). The outline is stored as **vector polygons** (A11), simplified, at about one CSS px of accuracy at the zoom it was filled at. Unconnected patches are left out with a note. `Esc` discards the fill (Esc again: Select); another tool, page or tab discards it.
6. **Leaks:** a fill that reaches the edge of the view stops and shows guidance (toast): block the opening with a Length line or erase it with Ctrl + drag, or zoom out if the room is bigger than the view; Ctrl+Z undoes the stroke that leaked. The manual Area tool (4.8) stays available.
7. **Live value:** the filled area so far beside the pointer (m² / ft² as 4.8; "Scale not set" without a calibration). Dynamic fill prompts for a scale like Area (4.7).
8. **Core (A12, NFR45):** the fill logic is refactored from the prototype (`C:\bluebeam\tool\src\core\60-fill.js`) into `src/core/fill` (framework-free, no DOM): grid and wall rasterisation (4-connected lines, so an 8-connected spread cannot slip through a diagonal), bucketed chamfer spread in steps, brush paint / erase with stroke history, and region → polygon (bridge thin gaps, fill enclosed islands except erased ones, close diagonal pinches, trace loops, RDP simplification, a half-cell outward offset, user space). Unit-tested: a room with a door gap closed by a barrier line, a leak, hatching inside, an erased island as a hole, stroke undo, the traced area of a rectangle within one cell per side.
9. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` at 1:100: hold inside the rectangle, Enter → an area of 37.34 m² ± 1 % (P ≈ 24694 mm); undo; a hold outside the rectangle leaks and shows the guidance; Esc. Local: the L17 hold-to-complete time for a room is measured (NFR5) and recorded.

## Tasks / Subtasks

- [x] **Task 1: Core** — `src/core/fill/` (`grid.ts` window + rasterisation, `spread.ts` session state: seeds, steps, brushes, strokes, leak, `polygon.ts` region → rings in user space); unit tests.
- [x] **Task 2: Viewer** — viewer tool `fill` (a measuring tool that does not snap or place points), press / move / release with the fill tool forwarded to the painter with the page's segments, the visible window in user space and the cell size; `J`; measure menu entry; HintBar text.
- [x] **Task 3: Editor** — the fill session (`fill-tool.ts`): barriers from segments + the page's Length / Polylength markups, the frame loop, the overlay on layer 3, the live area, Enter → area markup, Esc / tool / page / tab discard, stroke undo through `registerDrawingUndo`, leak toast; unit tests.
- [x] **Task 4: Tests** — `e2e/measure-dynamic-fill.spec.ts` (AC 9); local L17 timing.

## Dev Notes

- The prototype floods the rendered page's pixels. Here the page renders in tiles at changing zooms, so the grid is built from the vector linework instead (the epic's "vector page"); a scanned page has no linework and the fill leaks (manual Area remains).
- Grid: the visible part of the page in user space (axis-aligned; the view turns in 90° steps), one cell per CSS px at the current zoom, at most ~4 M cells (coarser beyond). Leaving the grid = a leak.
- Undo while filling is per stroke (the fill's own history); after Enter the area is one ordinary undo step ("Add area").
- Defaults chosen here, to confirm with the founder: the fill is bounded by the view (zoom out for big rooms) (D1); enclosed islands count as room, erased ones are holes (D2); Length / Polylength measurements are barriers (D3); Shift paints, Ctrl erases, brush 18 CSS px (D4); fill colour: the measure colour at 35 % opacity (D5); `J` arms Dynamic fill (the 4541 zone tool shares `J` later, by mode) (D6).
- Revu behaviour (official help: Dynamic Fill): press and hold to spread a fill bounded by lines, brush to add or erase, apply to create an area.
- Clean-room: behaviour from official Revu help and user observation; the algorithm is our own prototype's (A12: refactored, not copied).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.10], FR28, NFR5, A11, A12, NFR45
- [Source: _bmad-output/implementation-artifacts/4-8-area-and-count-measurements.md]
- Prototype: `C:\bluebeam\tool\src\core\60-fill.js`

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Walls come from the page's snap linework (4.1), not the rendered pixels: the grid is the view at one CSS px per cell (≤ 4 M cells), so the outline is accurate to about a pixel at the zoom it was filled at and the result does not depend on tiles.
- `core/fill`: `grid.ts` (window, 4-connected Amanatides–Woo wall lines), `spread.ts` (Dial's bucket queue with chamfer 10 / 14 costs, steps per frame, leak = the grid's border, round brushes, stroke history), `polygon.ts` (bridge, islands except erased, diagonal pinches, loop tracing, RDP, half-cell outward offset). Core timing (unit run, 2000 × 2000 grid, 20 000 dashes): 3.1 M cells spread in 337 ms over 54 bands (worst band 18 ms); rings 204 ms.
- The viewer gained a press drag for the fill tool (`pressTool` → painter `press`) with Shift = paint, Ctrl = erase; `J` arms it; the measure menu lists it. The editor's session (`fill-tool.ts`) is the measure painter's "fill" drawing, so the undo label ("Undo Fill stroke"), Esc and the another-tool / page / tab rules come with it.
- Local: snap.pdf rectangle at 1:100 completes in ~220 ms of holding and reads 37.34 m², P 24694 mm (exact: its edges sit on cell lines, the half-cell offset restores them). L17 at 1:75, 163 %: the meeting room by "1905" (ceiling texture, furniture, a dimension line inside) completes in **809 ms**, 18.41 m², P 21559 mm (screenshots fixtures/private/traces/4-10-l17-fill.png / -area.png, not committed). No printed area to compare with.
- The live value counts filled cells only; enclosed islands (furniture, texture dashes) join at Enter, so the added area is larger than the last live value (L17: 15.62 → 18.41 m²).
- Unit 152 files / 1728+ tests; related e2e 18 passed.

### File List

- src/core/fill/grid.ts, spread.ts, polygon.ts, fill.test.ts
- src/features/editor/fill-tool.ts, fill-tool.test.ts, measure-tool.ts, undo-store.ts
- src/features/viewer/viewer-store.ts, markup-layer.ts, index.ts, snap-controller.ts, viewer-input.ts, viewer-input.test.ts, viewer-engine.ts
- src/features/workspace/tool-rail.tsx, workspace-shell.test.tsx
- e2e/measure-dynamic-fill.spec.ts

### Change Log

- 2026-11-01: Story 4.10 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
- 2026-11-01: Tasks 1-4 done (L17 room 809 ms); Status → review (Claude Opus 5.5).
