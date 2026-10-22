# Story 3.3: Page pager and page keys

Status: ready-for-dev

## Story

As a drafter,
I want to move between pages from the status bar and keyboard,
so that I always know where I am in a multi-page set.

## Acceptance Criteria

1. **Given** a multi-page drawing, **when** I use the status-bar PagePager (first / previous / page-number input / next / last) or press `PageDown`/`PageUp`, `Ctrl+→`/`Ctrl+←`, `Home`/`End` with canvas focus, **then** the page changes, rendering the new page with the Story 3.1/3.2 pipeline (preview → tiles, IndexedDB cache by page) (FR19, UX-DR8).
2. The pager shows "3 / 12" plus the sheet label: the PDF page label (`/PageLabels`, via pdf.js `getPageLabels()`) when present and different from the page number, otherwise a sheet number detected from the page's text near the title block (Task 3), otherwise nothing. The canvas `aria-label` reads "Drawing canvas, page 3 of 12" (and includes the sheet label when known).
3. Typing in the page input: Enter or blur commits; a number outside 1…n or non-numeric text reverts silently to the current page (no dialog, no toast); Escape reverts and returns focus to the canvas. A page label typed exactly (e.g. "A1721") also navigates if it matches a label.
4. On a single-page file all four arrow buttons are disabled; first/previous are disabled on page 1 and next/last on the last page; the keys do nothing at the ends.
5. Each page keeps its own view (zoom, centre, rotation, fit mode) for the session; a page visited for the first time opens at the current fit mode (fit page by default).
6. The page change is announced in the status bar's polite live region ("Page 3 of 12, A1721").
7. Page keys act only with canvas focus (single-key rule; `Ctrl+←/→` too, so text fields keep word navigation). Rapid key repeats cancel stale renders (only the final page renders fully).
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e covers pager buttons, keys, input revert, single-page disabled state and the live-region text on a committed multi-page fixture.

## Tasks / Subtasks

- [ ] **Task 0 (carry-over, founder decision 2026-10-23): zoom percentage like Revu** — 100 % = actual size, i.e. 1 PDF point = 96/72 CSS px (the convention of Revu, Acrobat and pdf.js). Update the status-bar zoom readout, zoom clamps (1 %–6400 % in the new unit), `+`/`-` steps if they reference percentages, unit tests and e2e assertions, and the 3.2 story notes. Do not change rendering scale or cache keys — only the displayed/limit unit.
- [ ] **Task 1: Worker/engine**: `render.open` result adds `pageLabels: string[] | null`. Engine `goToPage(index)`: cancel the old page's in-flight tiles, show the cached preview/tiles of the new page immediately if any, request preview then tiles. Content flags (image-only HintBar) update per page.
- [ ] **Task 2: PagePager** (`src/features/viewer/page-pager.tsx`, in the status bar's fixed slot order — UX-DR7): Story 1.7 components (`IconButton` with `ChevronsLeft`, `ChevronLeft`, `ChevronRight`, `ChevronsRight`; a small numeric `TextField`), tooltips with shortcuts, `aria-label`s ("First page", …, "Page number"). Hidden when no document is open.
- [ ] **Task 3: Sheet number detection** (`src/core/pdf/sheet-label.ts`, framework-free, unit-tested): from pdf.js text content of a page (worker side, on demand per page, cached), pick the most likely sheet number: tokens matching common drawing-number patterns (e.g. `^[A-Z]{1,3}[-.]?\d{2,5}[A-Z]?$`, `^\d{2,4}-[A-Z]{1,2}-\d{2,4}$`), preferring the bottom-right quadrant and larger font size; return null if unsure. Validate on the founder's L17/L21 (expected "A1721" / "A2121" — check locally, never commit private files) and on synthetic text fixtures.
- [ ] **Task 4: Keys + live region + per-page view** (AC 5–7).
- [ ] **Task 5: Fixtures and tests**: generate `fixtures/pdf/multi-page.pdf` (4 pages, mixed sizes/orientations, page labels on two pages, one page with a sheet number in a title block) with a script; unit tests for sheet-label detection, input revert logic, per-page view memory, engine page switch cancellation; Playwright `e2e/viewer-pages.spec.ts`.

## Dev Notes

- Builds on 3.1/3.2: `src/features/viewer/` (viewer-store, viewer-engine, canvas-viewport, document-viewer), `src/core/render/{view,tiles}.ts`, render worker `render.<verb>` protocol, tile cache keys `<sha>:<page>:…` (already per page). Read both story files, including review follow-ups and deviations (e.g. per-document view memory keyed by file hash; zoom 100 % was 1 pt/CSS px — Task 0 changes the display unit).
- Status bar slots (UX-DR7, fixed order): file name · pager · scale · snap · cursor · zoom · save. Only file name, pager and zoom exist now.
- Founder note: `Ctrl+9` stays Fit page for now; the founder will report if desktop Chrome swallows it.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; `src/core` framework-free; tests co-located (jsdom opt-in + `@/test/radix-jsdom`); exact pins; one browser/server at a time; do not run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3]; FR19, UX-DR7, UX-DR8
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] PagePager, sheet labels, Keyboard Shortcuts (Pages)
- [Source: _bmad-output/implementation-artifacts/3-1-open-a-local-pdf-and-see-the-first-page-fast.md], [3-2-zoom-pan-fit-and-rotate-the-view.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
