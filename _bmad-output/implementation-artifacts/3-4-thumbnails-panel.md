# Story 3.4: Thumbnails panel

Status: in-progress

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

- [ ] **Task 1: Worker** — `render.thumbnail { page, widthPx }` → `ImageBitmap` (transferred) via the existing `render.<verb>` protocol (`result | progress | error`, `serializeWorkerError` + `code`); priority queue so tile requests always run first; `render.cancel` for thumbnails that left the window. Unit tests with the stubbed renderer.
- [ ] **Task 2: Engine/store** — engine API `requestThumbnail(page, widthPx)` / `cancelThumbnail(page)`, IndexedDB cache reuse (`src/lib/idb/tile-cache.ts`, same budget and eviction), page sizes and labels exposed from the viewer store for the panel. Bitmaps owned by the panel are closed on unmount/eviction.
- [ ] **Task 3: Virtual list** — `src/features/viewer/thumbnails-panel.tsx` (+ a small fixed-row-height windowing helper, framework-free math in `src/core/render/` or co-located; no new dependency unless clearly justified — if one is added, pin it exactly and note why). Draw bitmaps into per-row `<canvas>` elements. Story 1.7 components and near-sharp tokens only; English copy.
- [ ] **Task 4: Wire into the left panel** — replace the Thumbnails placeholder body in `workspace-shell.tsx` / registry with the panel; empty state when no document; current-page highlight and scroll-into-view; click/Enter navigation.
- [ ] **Task 5: Tests** — unit: windowing math, cancel-on-scroll, cache size steps, accessible names, keyboard roving focus (jsdom opt-in + `@/test/radix-jsdom`); e2e `e2e/viewer-thumbnails.spec.ts` on `fixtures/pdf/multi-page.pdf`. Local check on L17/L21 (private, never commit): thumbnails render, labels "A1721"/"A2121", no long tasks; save one screenshot to `fixtures/private/traces/`.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
