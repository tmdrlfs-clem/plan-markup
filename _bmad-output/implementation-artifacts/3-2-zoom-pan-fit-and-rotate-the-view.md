# Story 3.2: Zoom, pan, fit and rotate the view

Status: done

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
- [x] **Task 5: DPR + memory warning + status bar** (AC 4–6).
- [x] **Task 6: Tests**: unit for `view.ts` (zoomAt fixed point incl. rotation, fit page/width for portrait/landscape/rotated pages, clamps, bucket choice), input normalisation, the shortcut focus rule; viewer store tool transitions (Space temp pan restores tool). Playwright `e2e/viewer-navigate.spec.ts` on the committed `fixtures/pdf/vector-a3.pdf` (AC 7). Optional local-only perf check (not in CI): 5 s scripted pan/zoom on the L17 fixture reporting p50/p5 frame time and longest task, run once and recorded in the Debug Log.

### Review Follow-ups (AI)

Code review of 2026-10-23: 10 findings, all fixed in commit 9982f15 (plus the `data-view` precision fix below). Each has a unit test.

- [x] [AI-Review][High] **1. Drawn scale differed from rendered scale** (`viewer-engine.ts`): tiles and the preview were rendered at the quantised scale but drawn at the exact view scale, so 512 px tiles were resampled to 511 px and the preview shrank.
  - Fix: a raster whose scale matches zoom x DPR is placed by `oneToOneBox`: the page origin is rounded once and the raster's integer offset is added for each view rotation. It is copied at its own pixel size, on whole device px, and neighbours abut exactly.
  - Tile scales are exact 2^k (see 3). Fit page snaps its zoom up to the preview's quantised scale (at most 0.07 % larger, inside the padding).
  - Tests: 25 sub-pixel pan phases, all four rotations, and the fit-page preview at an odd window size and DPR 1.25.
- [x] [AI-Review][High] **2. Fractional backing store** (`canvas-viewport.tsx`): the backing store is now sized from ResizeObserver `device-pixel-content-box`. A stale size (DPR changed first) is rounded until the observer reports.
  - Where `device-pixel-content-box` is unsupported (Safari), `measureDevice` floors the size to whole device px and sets the canvases' CSS size to device / DPR.
  - The engine takes the device size (`setViewport(..., device)`), so the viewport is exactly device / DPR.
- [x] [AI-Review][High] **3. Buckets anchored to the viewport fit**: buckets are absolute now. Bucket k is 2^k device px per point and is chosen from zoom x DPR (`bucketForScale(deviceScale)`).
  - A resize, panel toggle or DPR change at the same zoom keeps every tile, in memory and in IndexedDB, with nothing cancelled. A DPR change requests the new bucket at settle.
  - The preview stays keyed by its own fit-box scale. At fit page after a resize, the preview is re-rendered for the new box (non-progressive; the old one stays drawn) instead of requesting tiles.
  - Key docs updated in `tile-cache.ts` and `render.worker.ts`. The in-memory key is `page:bucket:col:row`.
- [x] [AI-Review][High] **4. Bucket cap** (old MAX_BUCKET 3 = 8x fit): the range is now MIN_BUCKET -8 to MAX_BUCKET 9 (512 device px per point). That is 6400 % at a DPR of up to 6, within the worker's scale limit of 1000.
  - Requests stay limited to the viewport plus a one-tile ring, and the 90 % budget stop is unchanged.
  - The worker's `render.tile` schema now takes its bucket bounds from `MIN_BUCKET` / `MAX_BUCKET` (it had capped at 8; `render-protocol.test.ts`).
- [x] [AI-Review][Med] **5. Failure state across buckets**: `failed` maps each key to its bucket. At settle, entries of other buckets are dropped and the alert count is republished, so returning to a bucket re-requests its tiles.
  - A failure that arrives after the view left its bucket is ignored. The hatch is drawn only for the target bucket.
- [x] [AI-Review][Med] **6. Per-frame cost**:
  - `bucketCounts` tracks cached tiles per bucket (counted on insert, uncounted in the LRU's `onEvict`), and drawing visits only those buckets.
  - Grids are computed once per bucket and page.
  - The viewport box is computed once per frame, and each bucket is walked over a plain `tileRange` (new in `tiles.ts`, also used by `visibleTiles`) with no priority sort.
- [x] [AI-Review][Med] **7. Browser zoom while loading or in render error**: Ctrl+wheel on the canvas and Ctrl+0 / Ctrl+9 (focus or pointer over the canvas) now always `preventDefault` while a document area exists (`status !== "empty"`). The viewer acts only once a page is shown (`hasDocument`).
- [x] [AI-Review][Low] **8. Duplicates**: `fitPageView` uses `tiles.ts` `fitScale`, which keeps the size guard (a non-positive page throws; the viewport is at least 1 px). `drawOrder` became `drawBuckets` (cached buckets only), and `allBuckets` and the engine's `fitScale` getter were removed.
- [x] [AI-Review][Low] **9. Alt+drag with the Zoom tool zoomed in**.
  - Chosen behaviour (documented in `viewer-input.ts` and `view.ts`): Alt+drag zooms out so that the current view fits into the rectangle.
  - `zoomOutToRect`: the zoom is multiplied by min(rect / viewport) and never increases, and the old view centre lands on the rectangle's centre. Alt+click still steps out by √2.
- [x] [AI-Review][Low] **10. pointerId**: `pointercancel` and `lostpointercapture` end the drag only for the dragging pointer.

Also fixed: `data-view` published the zoom with 6 decimals, too coarse for the e2e √2 ratio once fit page snaps to the quantised scale (CI run 39826327983 failed on it). It now has 9 decimals.

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI run **39763243132** (typecheck/lint/unit/guards, Playwright e2e on the production build including `viewer-navigate.spec.ts`, gitleaks): success. Commit 4629873.
- Local, production build (`next build` + `next start`, E2E_PROD=1, workers 1, Docker + local Supabase): full e2e 36 passed, 1 skipped (the opt-in perf check). `viewer-navigate.spec.ts` 4/4 passed on the first run.
- **L17 perf check** (`e2e/perf-navigate.spec.ts`, opt-in with `PERF_L17=1`, never in CI). Run once.
  - Setup: production build, headless Chromium, 1920 x 1080, DPR 1, file `fixtures/private/pdf/A1721-…-Rev.2.pdf`.
  - Script: 5 s of synthetic wheel input, one event per frame: Ctrl+wheel zoom in, then pan, a 300 ms pause (tiles settle and render), pan again, then Ctrl+wheel zoom out.
  - Results over 296 frames:
    - frame time p50 **16.7 ms**, p95 **16.8 ms** (the 5th-percentile frame rate is about 60 fps);
    - slowest frame 33.3 ms;
    - **no long task** (the Long Tasks API reported no task of 50 ms or more).
  - NFR2 asks for at least 30 fps (target 60) and no task over 50 ms.
- Screenshot: `fixtures/private/traces/3-2-l17-zoom.png` (git-ignored).
  - View: L17 at 4x fit (bucket 2 exactly: four Ctrl+wheel notches of √2), zoom 172 %.
  - Reviewed: the tiles are sharp (hairlines, dimension text and hatching are crisp). No seams, gaps or blank tiles at the 512 px tile edges.

- Review follow-ups: CI run **39833043253** (typecheck/lint/unit/guards, Playwright e2e on the production build, gitleaks): success, commit e16dc43. Run 39826327983 (commit 9982f15) had failed on the `data-view` zoom precision, fixed in the next commit.
- **Review follow-up re-check (2026-10-23)**, same setup: production build, headless Chromium, 1920 x 1080, DPR 1, L17, the same 5 s script.
  - 299 frames: p50 **16.7 ms**, p95 **16.7 ms**, slowest 33.4 ms; **no long task**.
  - Screenshot `fixtures/private/traces/3-2-l17-zoom.png`, taken at zoom exactly 2.000000000 (2 device px per point: bucket 1, so tiles are drawn 1:1). Hairlines, dimension text and hatching are crisp, with no seams. The script now steers Ctrl+wheel to an exact bucket scale, since 4x fit is no longer a bucket.
  - Local e2e (`viewer-navigate`, `viewer-open`, perf) on the production build: 10 passed.

### Completion Notes List

- **Task 1: view transform.** `src/core/render/view.ts` (framework-free).
  - The view is `{ zoom, centerX, centerY, rotation }`, with the centre in page space.
  - Page space is pdf.js's viewport at scale 1 with the page's /Rotate applied. It is the space of the tiles and of `PageInfo`.
  - `pdfToPageMatrix` maps PDF user space into page space exactly like pdf.js `PageViewport`, including /Rotate and view-box offsets.
  - Also provided:
    - page↔screen matrices with the view rotation (`pageToScreenMatrix`, inverse, multiply, apply);
    - `zoomAt` (keeps the point under the cursor fixed);
    - `stepZoom` (√2) and the 1 %–6400 % clamp;
    - `fitPageView` / `fitWidthView` (a tall page starts at its top edge);
    - `clampView` (at least 10 % of the page per axis stays on screen, capped at the viewport);
    - `zoomToRect`, `visibleBounds`, `zoomPercent`.
  - Buckets still come from `tiles.ts` (`bucketForScale(zoom, fit)`, `bucketScale(fit, k, dpr)`).
- **Task 2: input.** `src/features/viewer/viewer-input.ts`.
  - Pure helpers:
    - `normalizeWheel`: a line is 40 px, a page is the viewport height, and Shift turns vertical scroll horizontal;
    - `wheelZoomFactor`: one 100 px notch is one √2 step, so trackpad pinch (a Ctrl wheel) is smooth;
    - `resolveViewerKey`, which applies the focus rule;
    - `cursorFor`.
  - `ViewerInput` registers `wheel` on the canvas only, with `{ passive: false }`. It handles:
    - drags with pointer capture: Space, the middle button or the Pan tool pan; the Zoom tool zooms in on a click, out on an Alt+click, and to the rectangle on a drag;
    - suppression of the middle-button autoscroll;
    - `+` / `-` zoom about the cursor when it is over the canvas, otherwise about the centre.
  - Tool state lives in the viewer store: `tool` (select / pan / zoom) and `tempPan`. The tool is kept across documents.
  - The Zoom tool's rubber band is drawn on the active canvas.
- **Task 3: gesture rendering** (`viewer-engine.ts`, reworked on the new view).
  - Every view change redraws the bitmaps already held with the live transform, coalesced to one rAF.
  - After 150 ms idle, the target bucket's tiles are requested, visible first and centre first. Stale requests get `render.cancel`.
  - All other buckets' cached tiles are drawn underneath, farthest bucket first and the target last, so there is no flash to blank.
  - Rotation-aware placement: the destination box is rounded to integer device px and the bitmap is turned a quarter about its centre.
  - Zoom buckets are relative to the rotation-0 fit, so rotating the view never re-renders.
  - Raster scale quantisation is refined from 1/16 to 1/1024 octave (`SCALE_STEPS_PER_OCTAVE`). At its bucket scale a tile now lands on exactly its own pixel size at integer device px, a 1:1 copy, so hairlines stay one device pixel (AC 4). Unit-tested.
- **Task 4: commands.**
  - `viewer-commands.ts`: the mounted viewport registers its engine. `viewerCommands` (zoom in/out, fit page/width, rotate) and `setTool` are exported from the viewer's public index.
  - Toolbar row 1 enables Zoom out / Zoom in / Fit page / Fit width and adds Rotate view counter-clockwise / clockwise.
  - The View menu enables its zoom/fit items and adds both rotate items. These items have no keyboard shortcut.
  - The ToolRail enables Select and Pan with a drawing open, shows the active tool and switches it. Clicking the active tool keeps it.
  - The other tools stay disabled with "Arrives with the markup editor", or "Open a drawing first" when no drawing is open.
  - Keys use the viewer's own handler with the canvas-focus rule (AC 3).
- **Task 5: DPR, memory warning, status bar.**
  - DPR: a `(resolution: <dpr>dppx)` media query is re-armed after every change, so a window that moves to another monitor re-measures even without a resize. A DPR or fit change cancels in-flight tiles and re-keys them (3.1 review fix).
  - Memory warning: requests stop once the visible tiles would fill 90 % of the 256 MB budget, so the view never evicts its own tiles. The HintBar warning "This drawing is using a lot of memory — some areas may redraw as you move" shows once per document, and only when that limit is hit or an eviction drops a tile the current view needs.
  - Status bar: a zoom `StatusBarItem` after the file name. The engine publishes the percent only when it changes.
  - The view is kept per document (sha256) in memory for the session, not persisted. Reopening the same file comes back to its view, fit mode and rotation.
- **Task 6: tests.**
  - Unit tests:
    - `view.test.ts`: fixed point under zoom for every rotation, fit page/width for portrait, landscape and rotated pages, clamps, pdf.js-compatible /Rotate;
    - `viewer-input.test.ts`: wheel normalisation, the focus rule, cursors, store tool transitions (Space restores the tool), and DOM-level drags, keys and Zoom tool;
    - engine tests: settle debounce, priority, stale cancels, old buckets underneath, 1:1 tiles, rotation without re-render, fit modes, rubber band, zoom publishing, per-document view, memory warning;
    - `viewer-commands.test.ts`, shell tests and the DPR media-query test.
  - Playwright `e2e/viewer-navigate.spec.ts` on `vector-a3.pdf` covers:
    - wheel and Shift+wheel scroll, and Ctrl+wheel zoom about the cursor;
    - Space-drag, cursors, and `+` / `-`, ignored when the focus is off the canvas;
    - Ctrl+0 / Ctrl+9, the toolbar and the View menu;
    - rotate both ways;
    - the Zoom and Pan tools;
    - `devicePixelRatio` / `visualViewport.scale` unchanged after Ctrl+0 and Ctrl+wheel on the canvas.
  - The canvas publishes `data-view="zoom centerX centerY rotation"` for e2e and diagnostics.
  - Suite: 1087 unit tests in 102 files.

**Decisions and deviations (for review):**

1. **Zoom %.** 100 % is 1 pt per CSS px, as the AC says ("actual size at 72 dpi"). pdf.js and some viewers use 96/72 CSS px per pt for 100 %. The clamp is 0.01–64 CSS px per pt.
   - **Superseded (Story 3.3 Task 0, founder decision 2026-10-23):** 100 % is now 96/72 CSS px per pt, like Revu, Acrobat and pdf.js (`view.ts` `ACTUAL_SIZE`). The clamp is 1 %–6400 % in that unit, i.e. 0.0133–85.3 CSS px per pt. Rendering scales and cache keys are unchanged.
2. **Quantisation step.** The Story 3.1 review fix quantised raster scales to 1/16 octave. That left tiles up to 4.4 % oversampled at their bucket scale, which resamples hairlines. 1/1024 octave keeps cache keys consistent and makes tiles 1:1. Cross-window cache hits now need the same fit to within about 0.07 %, which is the "geometry matches" case.
3. **Window blur.** The listener is on the canvas's `focusout`, not on the window's `blur`: the near-sharp lint guard flags the string "blur". `focusout` also fires when the window loses focus, since the canvas is the focused element whenever Space-pan can be active.
4. **Focus after commands.** Toolbar and ToolRail clicks move focus to the button. Single-letter keys need the canvas focused again (a click on it), as AC 3 requires.

**Open questions:**

- Desktop Chrome may keep Ctrl+9 for "last tab" before the page sees it. Ctrl+0 is suppressed, and e2e covers both keys in headless Chromium.
- Touchscreen two-finger pinch/pan (pointer events) is not handled. Trackpad pinch works through Ctrl+wheel.
- The perf run used synthetic wheel events in headless Chromium at DPR 1. A headed run at DPR 1.5 and on L21 / A0 has not been done.

### File List

- `_bmad-output/implementation-artifacts/3-2-zoom-pan-fit-and-rotate-the-view.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `e2e/perf-navigate.spec.ts` (new: opt-in, local only)
- `e2e/viewer-navigate.spec.ts` (new)
- `src/core/render/tiles.ts`, `tiles.test.ts` (modified)
- `src/core/render/view.ts`, `view.test.ts` (new)
- `src/features/viewer/canvas-viewport.tsx`, `canvas-viewport.test.tsx`, `document-viewer.tsx`, `index.ts`, `viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts` (modified)
- `src/features/viewer/viewer-commands.ts`, `viewer-commands.test.ts`, `viewer-input.ts`, `viewer-input.test.ts` (new)
- `src/features/workspace/tool-rail.tsx`, `workspace-menu-bar.tsx`, `workspace-shell.tsx`, `workspace-shell.test.tsx`, `workspace-status-bar.tsx`, `workspace-toolbar.tsx` (modified)
- `src/lib/idb/tile-cache.ts` (modified: key format doc)
- `src/workers/render.worker.test.ts` (modified: quantisation step)

### Change Log

- 2026-10-23: Review follow-ups (Claude Opus 5.5): 10 findings fixed (absolute zoom buckets, 1:1 rasters, device-pixel backing store, failure scoping, draw loop, browser-zoom guard, Alt+drag zoom out, pointerId). Status → done. Commits 9982f15 and the follow-up below.
- 2026-10-22: Story 3.2 implemented (Claude Opus 5.5). Status → review.
  - View transform: zoom, centre, rotation; fit page/width; clamps; √2 steps.
  - Input: wheel, Ctrl+wheel and pinch, Space/middle/Pan-tool drag, Zoom tool, keys with the canvas-focus rule.
  - Gesture rendering with settle, cancel and old buckets kept underneath; 1:1 tiles at bucket scale.
  - Toolbar, View menu and ToolRail commands, and view rotation.
  - DPR re-measure, the memory warning, and the status bar zoom.
  - Unit tests, the navigation e2e, and the local L17 perf check.
  - Commits 9542e6f, 0017adb, 822a824, 05496af, ececd7e, 1919aea.
