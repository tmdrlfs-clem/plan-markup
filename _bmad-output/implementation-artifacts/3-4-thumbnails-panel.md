# Story 3.4: Thumbnails panel

Status: done

## Story

As a drafter,
I want page thumbnails in the left panel,
so that I can jump to a sheet visually.

## Acceptance Criteria

1. **Given** an open drawing, **when** I open Thumbnails (left rail button or `Alt+T` — both already registered in `src/features/workspace/panel-registry.ts`), **then** a virtualised list shows one thumbnail per page with the page number and sheet label (same label source as the Story 3.3 PagePager: `/PageLabels`, else the detected sheet number, else nothing) (UX-DR21).
2. Thumbnails are rendered lazily by the render worker: only rows in or near the visible window (±1 screen) are requested; scrolling fast cancels requests for rows that left the window; the page's preview raster is reused when it already exists at a usable size. Thumbnail rasters are cached in IndexedDB with the tile cache (key `<sha>:<page>:thumb:<px>`) so reopening the file shows them instantly.
3. The current page is highlighted (accent border + `aria-current="page"`) and kept scrolled into view when the page changes from the pager or keys; clicking a thumbnail (or Enter/Space on the focused one) navigates to it via the Story 3.3 `goToPage` path, restoring that page's remembered view.
4. Keyboard: the list is one tab stop with roving focus; `↑`/`↓`, `Home`/`End`, `PageUp`/`PageDown` move focus; Enter/Space navigates. Each item has an accessible name "Page 3, A1721" (label omitted when unknown). Page keys from Story 3.3 still act only with canvas focus.
5. A designed empty state shows when no drawing is open (panel copy from the registry, no spinner). While a thumbnail is pending it shows a sized placeholder with the page's aspect ratio (no layout shift); a failed thumbnail shows a quiet error glyph and the row still navigates.
6. Thumbnail size: fits the panel width (220–420 px panel, default 280 px) at the device pixel ratio, aspect ratio from page size and rotation (/Rotate plus the view rotation is NOT applied — thumbnails show the page's native orientation). Resizing the panel re-renders only when the needed pixel width crosses a cache size step (e.g. 160 / 240 / 320 CSS px × DPR).
7. Performance: opening the panel on L17/L21 or the 4-page fixture never adds a main-thread task ≥ 50 ms; thumbnail requests run at a lower priority than visible canvas tiles (the canvas never waits behind thumbnails).
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) covers: open panel with `Alt+T`, all 4 thumbnails of `fixtures/pdf/multi-page.pdf` render, label text, current-page highlight follows the pager, click navigates, keyboard navigation, empty state with no document.

## Tasks / Subtasks

- [x] **Task 1: Worker** — `render.thumbnail { page, widthPx }` → `ImageBitmap` (transferred) via the existing `render.<verb>` protocol (`result | progress | error`, `serializeWorkerError` + `code`); priority queue so tile requests always run first; `render.cancel` for thumbnails that left the window. Unit tests with the stubbed renderer.
- [x] **Task 2: Engine/store** — engine API `requestThumbnail(page, widthPx)` / `cancelThumbnail(page)`, IndexedDB cache reuse (`src/lib/idb/tile-cache.ts`, same budget and eviction), page sizes and labels exposed from the viewer store for the panel. Bitmaps owned by the panel are closed on unmount/eviction.
- [x] **Task 3: Virtual list** — `src/features/viewer/thumbnails-panel.tsx` (+ a small fixed-row-height windowing helper, framework-free math in `src/core/render/` or co-located; no new dependency unless clearly justified — if one is added, pin it exactly and note why). Draw bitmaps into per-row `<canvas>` elements. Story 1.7 components and near-sharp tokens only; English copy.
- [x] **Task 4: Wire into the left panel** — replace the Thumbnails placeholder body in `workspace-shell.tsx` / registry with the panel; empty state when no document; current-page highlight and scroll-into-view; click/Enter navigation.
- [x] **Task 5: Tests** — unit: windowing math, cancel-on-scroll, cache size steps, accessible names, keyboard roving focus (jsdom opt-in + `@/test/radix-jsdom`); e2e `e2e/viewer-thumbnails.spec.ts` on `fixtures/pdf/multi-page.pdf`. Local check on L17/L21 (private, never commit): thumbnails render, labels "A1721"/"A2121", no long tasks; save one screenshot to `fixtures/private/traces/`.

### Review Follow-ups (AI)

Adversarial review 2026-10-23 (Claude Opus 5.5) of 3cf79d6..741a636 against db40c15. Checked without a finding: the worker's yield/cancel interplay (a cancel that lands between a yield's abort and its catch still wins), late replies after a document switch (generation guards in engine and worker), bitmap release on a new document and on engine destroy, the IndexedDB key and its LRU budget shared with tiles, the windowing range math.

- [x] **[AI-Review][High] Sheet-label lookups from the panel are never cancelled and run ahead of thumbnails.** Every row that mounts (overscan included) calls `requestSheetLabel`, which has no cancel. A fling or `End` on a long set queues one `getTextContent` per row passed, at sheet-label priority (above thumbnails), so the destination rows' thumbnails wait behind text extraction of pages no longer shown; a running extraction is not interruptible, so canvas tiles wait behind it as well (AC 2, AC 7). Fix: a cancellable, reference-counted lookup (`ViewerEngine.sheetLabel(index)` returns a release); the engine's own lookup for the shown page is pinned; a row releases on unmount. (`viewer-engine.ts`, `viewer-commands.ts`, `thumbnails-panel.tsx`)
- [x] **[AI-Review][Medium] Off-screen rows are requested before the visible ones.** Rows mount in index order and the worker runs thumbnails FIFO, so the screen of overscan rows above the viewport renders before what the user sees. Fix: visible rows request at once; overscan rows only after a short delay (rows that just pass through during a fling never request). (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Medium] Opening the panel on a page far down requests and cancels the top rows.** The first render mounts rows 0…N at scrollTop 0; their effects request thumbnails and labels; then the reveal scroll (a passive effect, a frame late) unmounts and cancels them, with a visible jump. Fix: reveal in a layout effect before paint, and start requests from a macrotask so rows unmounted by that synchronous re-render never post. (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Medium] An evicted bitmap paints a blank thumbnail.** The engine's LRU closes bitmaps that mounted rows still hold; a panel resize within a step repaints: `clearRect` runs, `drawImage` throws (caught) and the row stays white with `data-state="ready"`. Fix: `paint` reports the failure and the row asks the engine again. (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Medium] The virtualised listbox has no set size.** Only the mounted options exist in the DOM, so screen readers announce "3 of 7" on a 60-page set. Fix: `aria-setsize` / `aria-posinset` on every option (AC 4). (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Low] One-frame blank flash on resize.** Setting the canvas size clears it, and the repaint runs in a passive effect after the browser painted. Fix: repaint in a layout effect. (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Low] Crossing a size step hides every thumbnail** until the new raster arrives. Fix: keep the previous raster visible while the new step is pending (`data-state` still reports `pending`). (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Low] A DPR change alone is not seen** (window moved to another monitor): the ResizeObserver does not fire, so thumbnails stay at the old DPR. Fix: a `matchMedia` resolution listener re-measures. (`thumbnails-panel.tsx`)
- [x] **[AI-Review][Low] `revealRow` on a row taller than the list** aligns its bottom, hiding the thumbnail's top. Fix: align the top. (`thumbnail-layout.ts`)
- [x] **[AI-Review][Founder decision 2026-10-23] Click / Enter / Space on a thumbnail navigate and move the keyboard focus to the canvas** (Revu). Enter on the current page's thumbnail only moves the focus. Update the unit and e2e tests and deviation 7. (`thumbnails-panel.tsx`)

## Dev Notes

- Builds on 3.1–3.3: `src/features/viewer/` (viewer-store, viewer-engine, canvas-viewport, document-viewer, page-pager), render worker, tile cache, sheet-label detection (`src/core/pdf/sheet-label.ts`). Read the 3.2 and 3.3 story files including review follow-ups before starting.
- Left panel: 44 px rail + collapsible panel (default 280 px, 220–420 px); panel state remembered per user (existing layout store). Page edit actions in the context menu (rotate, insert, delete, reorder) are NOT in this story — they come with the page-editing epic.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`); zoom % follows Revu (100 % = 96/72 CSS px per pt) since 3.3.
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4]; UX-DR21
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] ThumbnailsPanel, left rail, Keyboard Shortcuts (Panels)
- [Source: _bmad-output/implementation-artifacts/3-3-page-pager-and-page-keys.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI run **39866168246** (typecheck/lint/unit/guards, Playwright e2e on the production build including `viewer-thumbnails.spec.ts`, gitleaks): success.
- Local checks: `npm run typecheck`, `npm run lint` and `npm run build` are clean. `npm test`: 1190 unit tests in 107 files.
- Local e2e on the production build (`E2E_PROD=1`, workers 1, Docker + local Supabase): 39 passed, 2 skipped (the opt-in L17 checks). `viewer-thumbnails.spec.ts` passed on its first run. Three `auth.spec.ts` tests failed once right after Supabase restarted cold, then passed (11/11) on a rerun; no auth code changed.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-thumbnails`, private, nothing committed): the L17 thumbnail is named "Page 1, A1721" and the L21 thumbnail "Page 1, A2121". All four thumbnails of `multi-page.pdf` render. The longest main-thread task from opening the panel until the last thumbnail was drawn: **0 ms** on L17, L21 and multi-page (the Long Tasks API reported no task ≥ 50 ms). Screenshot: `fixtures/private/traces/3-4-thumbnails.png` (workspace on L17 with the panel open), reviewed and not committed.

### Completion Notes List

- **Task 1: worker.** New verb `render.thumbnail { page, widthPx, heightPx }`, Zod-validated (16…2048 integer px). The worker fits the whole page, with /Rotate applied, into the box at an exact scale, so the raster never overflows the box. The raster is cached in IndexedDB under `<sha>:<page>:thumb:<w>x<h>`.
  - Scheduling: open, preview and tile jobs run first, then sheet labels, then thumbnails. A running thumbnail yields when a preview or tile arrives: it is aborted and re-queued, not failed. A cancel always wins over a yield.
  - On a cached reopen, a stored thumbnail answers before pdf.js has parsed. A thumbnail that misses the cache waits for the parse without holding the head of the queue.
- **Task 2: engine and store.** `ViewerEngine.thumbnail(index, box, listener)` returns a cancel function.
  - Rasters live in their own LRU (48 MB). The engine owns the bitmaps and closes them on eviction or when a new document opens. The panel only draws them.
  - When a page's finished preview (shown, or kept from 3.3) is at least as large as the thumbnail, the engine resizes it with `createImageBitmap` and does not ask the worker.
  - Listeners share one request. The last listener to leave cancels it. A new document cancels everything and drops late replies; a page change does not.
  - The store now carries `pages` (sizes with /Rotate) and `documentId`. `viewerThumbnails` routes the panel's requests to the mounted engine.
  - `requestSheetLabel` is public, so visible rows can look up the sheet numbers of pages without a page label.
- **Task 3: virtual list** (`thumbnails-panel.tsx`, geometry and keys in `thumbnail-layout.ts`, no new dependency).
  - Rows have a fixed height: one box shape per document (the tallest page's aspect, clamped 0.5…1.42). Each page is fitted into the box, and a pending row keeps the page's size.
  - The list mounts the visible rows plus one screen above and below, and always the current and the focused rows. Rows that leave the window cancel their requests.
  - Rasters come in width steps (160/240/320/400 CSS px × DPR). A panel resize within a step only redraws.
  - The current page has an accent border (drawn as a ring, so nothing shifts) plus `aria-current="page"` and `aria-selected`, and it is scrolled into view when the page changes.
  - A failed thumbnail shows a quiet `ImageOff` glyph, and its row still navigates.
- **Task 4:** the left panel's Thumbnails body is the `ThumbnailsPanel`. Without a drawing it shows the registry's "No drawing open", with no spinner.
- **Task 5:** unit tests cover the worker (render, cache, priority, yield, cancel, cached reopen, boundary validation), the engine (shared and cancelled requests, preview reuse, failure, document change), commands, the layout math, the panel (names, virtualisation and cancel on scroll, keys, click, failed glyph, empty state, reveal) and the shell (Alt+T). E2E: `viewer-thumbnails.spec.ts` (CI) and `perf-thumbnails.spec.ts` (opt-in, local).

**Decisions and deviations (for review):**

1. **The listbox uses `aria-activedescendant`, not a moving `tabindex`.** It is one tab stop, and focus stays on the list. With virtualisation, a roving tabindex would lose focus whenever the focused row unmounts. The focused and current rows are always mounted.
2. **Payload and cache key name a box.** The payload is `{ page, widthPx, heightPx }` and the key is `<sha>:<page>:thumb:<w>x<h>`, instead of `{ page, widthPx }` and `thumb:<px>`. Thumbnails fit a box shared by the whole document, so the height is part of the key.
3. **Orientation.** "/Rotate plus the view rotation is NOT applied" is read as: /Rotate is applied (the page as the PDF displays it, the same as the canvas and the PageInfo sizes), and the view rotation is not.
4. **The engine owns the thumbnail bitmaps**, not the panel. They are closed on LRU eviction or on a new document, and the panel only draws them into its canvases. This lets rows that scroll back in redraw at once.
5. **Thumbnails made from a preview are not written to IndexedDB.** Only rasters rendered by the worker are stored. On a reopen, those pages come from the preview again, or from the worker.
6. **The visible rows trigger the sheet-number lookup**, so the thumbnails of unvisited pages without a page label also get their detected number. These jobs run at sheet-label priority, before thumbnails and after tiles.
7. **Keys inside the list.** With the list focused, PageUp, PageDown, Home and End move the list's focus. The Story 3.3 page keys still act only with canvas focus.
8. **A click, Enter or Space on a thumbnail navigates and moves the keyboard focus to the canvas** (founder decision 2026-10-23, Revu behaviour; applied in the review fixes). Enter on the current page's thumbnail only moves the focus. Keyboard browsing of the list starts again with Tab / F6 into the list.

**Questions for the founder:** none open (the click-focus question was answered on 2026-10-23: focus goes to the canvas).

**Review fixes (2026-10-23, Claude Opus 5.5)** — all ten Review Follow-ups (AI) fixed with tests:

- High, sheet-label lookups: `ViewerEngine.sheetLabel(index)` returns a release. Rows hold the lookup; when the last holder goes and the engine has not pinned it (its own lookup for the shown page), the worker job is cancelled and a later visit asks again. `resetDocument` cancels lookups in flight. `viewerThumbnails.requestSheetLabel` became `viewerThumbnails.sheetLabel`.
- Medium, request order and wasted work: a row asks from a macrotask, at once when on screen and after `OVERSCAN_DELAY_MS` (150 ms) in the overscan; rows a fling only passes through never ask. The reveal of the current (or key-moved) row runs in a layout effect and moves the window in the same commit, so opening the panel on page 150 only asks for rows around it.
- Medium, evicted bitmap: `paint` returns false for a closed bitmap (0 × 0) or a failed draw, and the row asks again. Medium, a11y: options carry `aria-setsize` / `aria-posinset`.
- Low: repaint in a layout effect; the previous raster stays visible while a new size step is pending; a `matchMedia` resolution listener catches DPR changes; `revealRow` shows the top of a row taller than the list.
- Founder decision: click / Enter / Space call `viewerCommands.focusCanvas()` after navigating; unit and e2e tests updated (the e2e now checks the canvas has focus and that its page keys act at once).
- Checks: typecheck, lint, build clean; `npm test` 1195 tests in 107 files; e2e on the production build 40 passed, 2 skipped (opt-in L17 checks); the private L17/L21/multi-page thumbnail check again reports 0 ms as the longest main-thread task.

### File List

- `_bmad-output/implementation-artifacts/3-4-thumbnails-panel.md`, `sprint-status.yaml` (modified)
- `src/workers/render-protocol.ts`, `render.worker.ts`, `render.worker.test.ts` (modified)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts`, `viewer-commands.ts`, `viewer-commands.test.ts`, `index.ts` (modified)
- `src/features/viewer/thumbnail-layout.ts`, `thumbnail-layout.test.ts`, `thumbnails-panel.tsx`, `thumbnails-panel.test.tsx` (new)
- `src/features/workspace/workspace-shell.tsx`, `workspace-shell.test.tsx` (modified)
- `e2e/viewer-thumbnails.spec.ts`, `e2e/perf-thumbnails.spec.ts` (new)

### Change Log

- 2026-10-23: Code review (Claude Opus 5.5): 10 follow-ups (1 High, 4 Medium, 4 Low, 1 founder decision) fixed with tests. Status → done.
- 2026-10-23: Story 3.4 implemented (Claude Opus 5.5). Status → review.
  - Worker `render.thumbnail` at the lowest priority, yielding to the canvas and cached in IndexedDB.
  - Engine thumbnails with preview reuse and their own LRU.
  - The virtualised Thumbnails panel in the left panel.
  - Unit tests and e2e.
  - Commits 3cf79d6, 3455fae, 153eaed, e63ff05, 0ab0497.
