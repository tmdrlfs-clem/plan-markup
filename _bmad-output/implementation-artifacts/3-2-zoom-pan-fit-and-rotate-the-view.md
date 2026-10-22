# Story 3.2: Zoom, pan, fit and rotate the view

Status: in-progress

## Story

As a drafter,
I want to move around the drawing the way I do in Revu,
so that navigating a large sheet feels instant.

## Acceptance Criteria

1. **Given** an open drawing, **when** I use any of these inputs, **then** the view updates (FR20):
   - Wheel scrolls the view (vertical; `Shift+wheel` horizontal; trackpad two-finger pan both axes). `Ctrl+wheel` (and trackpad pinch, which browsers send as `ctrlKey` wheel) zooms around the cursor.
   - Hold `Space` and drag → temporary pan without leaving the active tool (cursor `grab`/`grabbing`; releasing Space restores the tool cursor). Middle-mouse drag pans.
   - Pan tool (`Shift+V`, ToolRail Pan button becomes enabled): left-drag pans. Select (`V`) is the default tool; the ToolRail shows which tool is active.
   - `+` / `=` zoom in, `-` zoom out (around the viewport centre, or the cursor when it is over the canvas), in steps of √2 (≈ 1.414), clamped to 1 %–6400 % of actual size.
   - Zoom tool (`Z`): click = zoom in at the point, `Alt`+click = zoom out, drag a rectangle = zoom to that area.
   - Fit page (`Ctrl+9`), Fit width (`Ctrl+0`) — keyboard, View menu and toolbar row 1 buttons (currently disabled with "Open a drawing first") become enabled when a drawing is open.
   - Rotate view 90° clockwise / counter-clockwise from the View menu and toolbar (no keyboard default; view rotation only, the PDF is not changed — page rotation is Epic 12).
2. Pan and zoom sustain ≥ 30 fps (target 60) and no main-thread task exceeds 50 ms (NFR2, A10): during a gesture the existing tile bitmaps are transformed (no re-render); after the gesture settles (~150 ms idle) tiles for the new zoom bucket are requested, visible-first and centre-first, stale requests cancelled; old-bucket tiles stay visible underneath until replaced (no flash to blank).
3. Shortcuts (`+`, `-`, `Z`, `V`, `Shift+V`, `Space`) only act when focus is on the canvas (UX: single-letter keys never fire while typing). `Ctrl+9`/`Ctrl+0` and `Ctrl+wheel` work when the canvas has focus or the pointer is over it, and `preventDefault` there so the browser's own zoom/reset does not happen; outside the canvas the browser keeps its defaults.
4. Rendering uses `devicePixelRatio` (and reacts to DPR changes when the window moves between monitors) within the 256 MB tile memory budget; hairlines stay one device pixel (pdf.js renders at bucket × DPR; tiles are drawn at integer device-pixel positions without smoothing artefacts at bucket scale) (UX-DR37).
5. The IndexedDB tile cache from Story 3.1 serves revisited buckets; when the in-memory budget would be exceeded and eviction cannot free enough (e.g. extreme zoom on a huge page), a HintBar warning "This drawing is using a lot of memory — some areas may redraw as you move" shows once per document (UX-DR31); never before.
6. The status bar shows the zoom percentage (relative to actual size at 72 dpi = 100 %) as a `StatusBarItem`; the view (zoom, centre, rotation) is kept per document in memory (tabs in 3.5 rely on it) but not persisted.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e covers wheel scroll, Ctrl+wheel zoom around cursor, Space-drag, keyboard zoom, Fit page/width, rotate, and the browser-zoom suppression (page `devicePixelRatio`/`visualViewport.scale` unchanged after `Ctrl+0` on the canvas).

## Tasks / Subtasks

- [x] **Task 1: View transform (core)**: `src/core/render/view.ts` (framework-free, unit-tested): view = `{ zoom, centerX, centerY, rotation: 0|90|180|270 }` in PDF user space; page↔screen matrices including rotation and the page's own `/Rotate`; `zoomAt(point, factor)` keeps the point fixed; fit page / fit width with a margin; clamping (zoom range, keep at least 10 % of the page visible); step zoom (√2). Bucket selection from zoom × DPR (existing `tiles.ts`).
- [x] **Task 2: Input handling** (`src/features/viewer/`): pointer + wheel + key handlers on `CanvasViewport` (pointer capture for drags; `wheel` listener registered `{ passive: false }` only on the canvas element; normalise `deltaMode` lines/pages to pixels). Tool state in the viewer store: `select | pan | zoom` (+ temporary pan flag for Space/middle). Cursor per tool. Zoom tool rectangle drawn on the active canvas.
- [x] **Task 3: Gesture rendering**: during gestures draw the current tile bitmaps with the live transform (one `drawImage` per visible tile, culling); after 150 ms idle request new-bucket tiles via the worker protocol (`render.tile`, priority order from `tiles.ts`, `render.cancel` for stale ones). Keep old-bucket tiles until the new ones cover the area. Coalesce redraws with one `requestAnimationFrame`.
- [x] **Task 4: Commands**: enable toolbar row 1 zoom out / zoom in / fit page / fit width + View menu items (and add Rotate view clockwise / counter-clockwise to the View menu and toolbar) when a document is open; ToolRail Select and Pan become enabled (other tools stay disabled with their reason). Shortcuts bound in `use-workspace-shortcuts.ts` (or the viewer's own hook) with the canvas-focus rule.
- [ ] **Task 5: DPR + memory warning + status bar** (AC 4–6).
- [ ] **Task 6: Tests**: unit for `view.ts` (zoomAt fixed point incl. rotation, fit page/width for portrait/landscape/rotated pages, clamps, bucket choice), input normalisation, the shortcut focus rule; viewer store tool transitions (Space temp pan restores tool). Playwright `e2e/viewer-navigate.spec.ts` on the committed `fixtures/pdf/vector-a3.pdf` (AC 7). Optional local-only perf check (not in CI): 5 s scripted pan/zoom on the L17 fixture reporting p50/p5 frame time and longest task, run once and recorded in the Debug Log.

## Dev Notes

- Builds on Story 3.1: `src/features/viewer/` (viewer-store, viewer-engine, canvas-viewport, document-viewer), `src/core/render/tiles.ts`, render worker protocol `render.<verb>`, IndexedDB tile cache in `src/lib/idb/`. Read the 3.1 story file (Dev Notes, deviations, review fixes) first: at fit page no tiles are requested (preview is sharp enough); tile cache key includes bucket device scale and tile size.
- Story 2.3 measured ~60 fps with transformed bitmaps during gestures; the main risk is re-render storms — debounce and cancel.
- Windows occludes background windows → rAF at 1 Hz; e2e must keep the browser window in front (headless in CI is fine).
- Revu keys from the UX shortcut table only; no invented keys (rotate view has none).
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; `src/core` framework-free; tests co-located (jsdom opt-in + `@/test/radix-jsdom`); exact pins; one browser/server at a time on this machine; CI e2e runs on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]; FR20, NFR2, A10, AR12, UX-DR12, UX-DR31, UX-DR37
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] Keyboard Shortcuts (MVP basic set), CanvasViewport, ToolRail
- [Source: _bmad-output/implementation-artifacts/3-1-open-a-local-pdf-and-see-the-first-page-fast.md]
- [Source: docs/spikes/2-3-render-report.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
