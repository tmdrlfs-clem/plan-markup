# Story 3.3: Page pager and page keys

Status: done

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

- [x] **Task 0 (carry-over, founder decision 2026-10-23): zoom percentage like Revu** — 100 % = actual size, i.e. 1 PDF point = 96/72 CSS px (the convention of Revu, Acrobat and pdf.js). Update the status-bar zoom readout, zoom clamps (1 %–6400 % in the new unit), `+`/`-` steps if they reference percentages, unit tests and e2e assertions, and the 3.2 story notes. Do not change rendering scale or cache keys — only the displayed/limit unit.
- [x] **Task 1: Worker/engine**: `render.open` result adds `pageLabels: string[] | null`. Engine `goToPage(index)`: cancel the old page's in-flight tiles, show the cached preview/tiles of the new page immediately if any, request preview then tiles. Content flags (image-only HintBar) update per page.
- [x] **Task 2: PagePager** (`src/features/viewer/page-pager.tsx`, in the status bar's fixed slot order — UX-DR7): Story 1.7 components (`IconButton` with `ChevronsLeft`, `ChevronLeft`, `ChevronRight`, `ChevronsRight`; a small numeric `TextField`), tooltips with shortcuts, `aria-label`s ("First page", …, "Page number"). Hidden when no document is open.
- [x] **Task 3: Sheet number detection** (`src/core/pdf/sheet-label.ts`, framework-free, unit-tested): from pdf.js text content of a page (worker side, on demand per page, cached), pick the most likely sheet number: tokens matching common drawing-number patterns (e.g. `^[A-Z]{1,3}[-.]?\d{2,5}[A-Z]?$`, `^\d{2,4}-[A-Z]{1,2}-\d{2,4}$`), preferring the bottom-right quadrant and larger font size; return null if unsure. Validate on the founder's L17/L21 (expected "A1721" / "A2121" — check locally, never commit private files) and on synthetic text fixtures.
- [x] **Task 4: Keys + live region + per-page view** (AC 5–7).
- [x] **Task 5: Fixtures and tests**: generate `fixtures/pdf/multi-page.pdf` (4 pages, mixed sizes/orientations, page labels on two pages, one page with a sheet number in a title block) with a script; unit tests for sheet-label detection, input revert logic, per-page view memory, engine page switch cancellation; Playwright `e2e/viewer-pages.spec.ts`.

### Review Follow-ups (AI)

Adversarial review 2026-10-23 (Claude Opus 5.5) of 518d050..af08214 against cb4525c. Task 0 checked: only `zoomPercent` and the clamps changed unit; render scales, bucket choice (`bucketForScale` still clamps to `MAX_BUCKET`, 6400 % x DPR 6 = 512 = bucket 9) and cache keys are unchanged — no finding.

- [x] **[AI-Review][High] A page that fails to render locks the whole document.** `loadPreview` turns any preview failure into document status `error`: the pager is hidden (`hasDocument` is false), the page keys stop (`active()`), and "Try again" reopens at the remembered page (`documentViews.pageIndex`), which fails again — a loop with no way to reach the other pages. Fix: on a multi-page document a page's preview failure is a page-level failure (status stays usable, the Retry overlay re-requests the preview, the pager and keys keep working); only a worker crash or a single-page document fails the document. (`viewer-engine.ts`)
- [x] **[AI-Review][High] `render.sheetLabel` blocks rendering (head-of-line).** The worker queue is FIFO and the engine posts `render.sheetLabel` before the settle's tile requests. On a cached reopen the job awaits `doc.ready` (the full pdf.js parse, ~2 s on L17) while occupying the queue, so tiles that would come straight from IndexedDB wait behind it; on a parsed document `getTextContent` runs before the page's tiles. Fix: the worker runs sheet-label jobs only when no open/preview/tile job is queued and the document is parsed (or the answer is cached), re-pumping when pdf.js is ready; the engine asks after the settle's tile requests. (`render.worker.ts`, `viewer-engine.ts`)
- [x] **[AI-Review][Medium] Content flags written across documents.** `loadPreview` stores `this.contents[index] = content` before the generation check; a cancelled preview of the previous document that still resolves writes its flags into the new document's page (wrong image-only HintBar). Fix: write into the `contents` array of the request's own document. (`viewer-engine.ts`)
- [x] **[AI-Review][Medium] Sheet-number false positives from pipe sizes and standards.** `^[A-Z]{1,3}[-.]?\d{2,5}[A-Z]?$` accepts `DN150`, `PN16`, `NZS4541`, `AS1851`, `EN12845`, `BS9251` — exactly what fire-protection title blocks and notes cite, often in larger type. Fix: reject pipe-size / pressure tokens and 4–5 digit standard references. (`sheet-label.ts`)
- [x] **[AI-Review][Medium] The live region floods screen readers.** Every intermediate page of a key repeat is announced, and a page without a page label is announced twice (number first, then again when the detected sheet label arrives). Fix: the announcement settles first (short debounce; waits, bounded, for the page's sheet-label lookup). (`page-pager.tsx`, `workspace-shell.tsx`)
- [x] **[AI-Review][Low] Pre-3.3 cache entries can lose their page labels for good.** While the background label read of an old entry is pending, `persist` (after a preview's content flags or a sheet label) writes `pageLabels: null`, which later reads as "this document has none"; an interrupted session never reads them again. Fix: unknown labels stay absent in the stored metadata. (`render.worker.ts`)
- [x] **[AI-Review][Low] A page label over 1000 characters poisons the cache entry.** The worker stores labels unbounded but `parseDocMeta` rejects labels over 1000 characters, so such a document misses the raster-cache metadata on every reopen. Fix: `cleanPageLabels` truncates to the schema's limit (shared constant). (`sheet-label.ts`, `render-cache.ts`)
- [x] **[AI-Review][Low] Typed labels are case-sensitive** (founder decision 2026-10-23: match case-insensitively, e.g. "a1721"). (`sheet-label.ts`)
- [x] **[AI-Review][Low] The page input asks touch keyboards for digits only** (`inputMode="numeric"`), so labels (AC 3) cannot be typed there. Fix: a normal text keyboard. (`page-pager.tsx`)

Founder decision kept: the pager shows only the sheet number ("A1721"), the full label stays in the tooltip.

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI run **39837415230** (typecheck/lint/unit/guards, Playwright e2e on the production build including `viewer-pages.spec.ts`, gitleaks): success. Commit 4eb3129.
- Review fixes: CI run **39840573587** (typecheck/lint/unit/guards, Playwright e2e on the production build, gitleaks): success. Commit db40c15.
- Local checks: `npm run typecheck`, `npm run lint` and `npm run build` are clean. `npm test`: 1147 unit tests in 105 files.
- Local e2e on the production build (`E2E_PROD=1`, workers 1, Docker + local Supabase): 39 passed, 1 skipped (the opt-in L17 perf check). `viewer-pages.spec.ts` 3/3.
  - Its first local run caught a real bug: Escape in the page input moved focus to the canvas, and the blur that followed committed the stale draft. Fixed, and covered by the unit test.
- **Sheet labels on the founder's drawings** (checked locally with pdf.js 6.4.299 in Node; nothing private committed):

  | File | `/PageLabels` | Detected from text | Pager shows | Tooltip |
  | --- | --- | --- | --- | --- |
  | L17 | `"A1721 - LEVEL 17 REFLECTED CEILING PLAN\u0000"` | **A1721** (19.5 pt, under "DRAWING NUMBER") | **A1721** | the full label |
  | L21 | `"A2121 - LEVEL 21 REFLECTED CEILING PLAN\u0000"` | **A2121** | **A2121** | the full label |
  | synthetic A0 | none | none | nothing | – |

  Both L17 and L21 carry a page label, so the label wins (AC 2). Text detection gives the same number independently.
- Screenshots of the status bar (pager on pages 1 and 3 of `multi-page.pdf`) were reviewed locally and not committed. The pager fits the 24 px bar, and page 3 (/Rotate 90) renders upright.

### Completion Notes List

- **Task 0: zoom % like Revu.** `view.ts` `ACTUAL_SIZE` = 96/72 CSS px per point is 100 %. `zoomPercent` and the clamp (`MIN_ZOOM` / `MAX_ZOOM` = 1 % / 6400 % of that) use the new unit.
  - Rendering scales and cache keys are unchanged. The internal zoom is still CSS px per point.
  - Updated: the unit tests, the e2e percent helper, the store doc and the 3.2 story note (decision 1, marked superseded).
- **Task 1: worker and engine.**
  - `render.open` returns `pageLabels`: cleaned with `cleanPageLabels` (control characters stripped; pdf.js keeps a trailing NUL from these writers), or null when they are only page numbers. They are stored with the document in the raster cache. An entry cached before this story reads them once pdf.js is ready, for next time.
  - New verb `render.sheetLabel { page } -> { label }`: text runs (pdf.js `getTextContent`, mapped to page space) go through `detectSheetLabel`. The result is cached per document (`DocMeta.sheetLabels`), so a reopen answers before pdf.js has parsed.
  - `ViewerEngine.goToPage(index)`:
    - cancels the old page's tile and preview requests and bumps the generation, so late replies are dropped and rapid repeats render only the last page;
    - keeps the old page's finished preview in the tile LRU (`LruByteCache.take` hands it back without closing), so the budget still governs memory;
    - shows the new page's kept preview at once, or requests a progressive preview, then tiles.
  - Tiles and bucket counts are keyed by page. Content flags are tracked per page, so the image-only HintBar follows the shown page.
  - The detected sheet number is requested only for pages without a meaningful page label, once each, after the preview.
- **Task 2: PagePager** (`page-pager.tsx`), between the file name and the zoom in the status bar.
  - Story 1.7 parts: `IconButton` with `ChevronsLeft` / `ChevronLeft` / `ChevronRight` / `ChevronsRight`, and tooltips with shortcuts (`aria-keyshortcuts` now maps arrow glyphs to `ArrowLeft` / `ArrowRight`).
  - The numeric input is built from `FieldShell` (label hidden, "Page number") and `fieldControlClasses`. `TextField` has a visible label and is 40 px tall, too big for the 24 px bar.
  - Then "/ n" and the sheet label (tooltip: the full label).
  - Disabled reasons: "Already on the first page", "Already on the last page", or "This drawing has one page".
  - The pager is hidden without a drawing.
- **Task 3: sheet-number detection** (`src/core/pdf/sheet-label.ts`, framework-free).
  - Tokens matching the story's patterns, in the bottom-right quadrant, score their font size relative to the page's median, +1 next to (or in the same run as) a "DRAWING NO." / "DWG NO" / "SHEET NUMBER" caption, and up to +0.5 for closeness to the corner.
  - The result is null when unsure:
    - nothing found;
    - an uncaptioned number under 1.25x the body text;
    - a runner-up within 0.25.
  - Unit-tested on synthetic title blocks, including an L17-like layout with detail callouts as decoys, ties, rotated page space and in-run captions.
- **Task 4: keys, live region and per-page view.**
  - PageDown / PageUp, Ctrl+→ / Ctrl+← and Home / End act only with canvas focus. Repeats are allowed, and nothing happens at the ends.
  - The status bar's announcement is a visually hidden polite `role="status"` span: "Page 3 of 12, A1721". The canvas `aria-label` includes the sheet label.
  - Each page keeps its view. A first visit uses the current fit mode (fit page when the view was zoomed by hand) and keeps the view rotation.
  - Reopening a document in the session returns to the page it was left on.
- **Task 5: fixtures and tests.**
  - `fixtures/pdf/multi-page.pdf` is generated deterministically by `scripts/fixtures/make-viewer-fixtures.mjs`.
  - Unit tests:
    - `sheet-label.test.ts`, `page-pager.test.tsx`;
    - engine paging: cancellation, kept preview, per-page view, first-visit fit mode, rapid repeats, out of range, sheet-label requests, reopen;
    - worker labels and `render.sheetLabel`, keys, commands, the shell announcement, the LRU `take`, and the protocol bucket schema.
  - Playwright `e2e/viewer-pages.spec.ts`.

**Decisions and deviations (for review):**

1. **Compact page labels.** A page label of the form "`<sheet number> - <title>`" shows only its sheet number in the pager, with the full label as the tooltip. Both founder drawings have such labels ("A1721 - LEVEL 17 REFLECTED CEILING PLAN"), and the story expects "A1721". Other labels are shown whole, truncated at 160 px.
2. **Live region.** The whole status bar was the live region (`role="status"`), which would put the interactive pager inside it and announce every zoom change. The announcement now has its own hidden polite region. The shell unit test reads the file name from the footer instead.
3. **Typed labels match exactly** (case-sensitive). *Superseded in review: they match ignoring case (founder decision).* They match a page label (full, or its sheet number) or a detected number of a page already visited. Pages are detected on demand, so an unvisited page's text-detected number is not yet known.
4. **New worker verb** `render.sheetLabel`, and `pageLabels` / `sheetLabels` are added to the cached document metadata (both optional, so older entries still parse).
5. **Rotation on first visit.** A page seen for the first time keeps the current view rotation, as well as the fit mode.

**Founder answers (2026-10-23):** the pager keeps showing only the sheet number ("A1721"), the full label in the tooltip; typed labels match case-insensitively (done in the review fixes, decision 3 superseded).

**Review fixes (2026-10-23, Claude Opus 5.5)** — all nine Review Follow-ups (AI) fixed with tests:

- High, page failure: `loadPreview` on a multi-page document reports a page-level failure (`failedTiles: 1`, new store flag `pageFailed`, overlay "This page could not be drawn." with Retry → `retryFailedTiles` re-requests the preview); status stays `ready`, so the pager and keys keep working. A `worker-failed` error or a single-page document still fails the document.
- High, head-of-line: `RenderWorkerHost.nextJob()` runs `render.sheetLabel` only when no open/preview/tile job is queued and pdf.js has parsed the document (`Doc.parsed`, re-pump when `ready` settles), unless the answer is cached. The engine asks from the settle, after `requestTiles`.
- Medium: `loadPreview` writes content flags into its own document's array; `isSheetNumber` rejects `DN/NB/PN` sizes and 4–5 digit `NZS/AS/BS/EN/ISO/DIN/IEC` references; `usePageAnnouncement` settles the live-region text (300 ms, waiting up to 1.5 s for a pending sheet-label lookup).
- Low: unknown page labels stay absent from stored metadata; `cleanPageLabels` caps labels at `MAX_PAGE_LABEL_LENGTH` (1000, shared with `render-cache.ts`); case-insensitive label match; the page input no longer sets `inputMode="numeric"`.
- Checks: typecheck, lint, build clean; `npm test` 1159 tests in 105 files; e2e on the production build 39 passed, 1 skipped (L17 perf opt-in).

### File List

- `_bmad-output/implementation-artifacts/3-3-page-pager-and-page-keys.md` (modified)
- `_bmad-output/implementation-artifacts/3-2-zoom-pan-fit-and-rotate-the-view.md` (modified: Task 0 note)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
- `e2e/viewer-navigate.spec.ts` (modified: zoom percent)
- `e2e/viewer-pages.spec.ts` (new)
- `fixtures/README.md` (modified)
- `fixtures/pdf/multi-page.pdf` (new, generated)
- `scripts/fixtures/make-viewer-fixtures.mjs` (modified)
- `src/components/ui/shortcut.ts`, `shortcut.test.ts` (modified: arrow key names)
- `src/core/pdf/sheet-label.ts`, `sheet-label.test.ts` (new)
- `src/core/render/view.ts`, `view.test.ts` (modified: ACTUAL_SIZE)
- `src/core/render/tiles.ts`, `tiles.test.ts` (modified: LruByteCache.take, doc)
- `src/features/viewer/page-pager.tsx`, `page-pager.test.tsx` (new)
- `src/features/viewer/canvas-viewport.tsx`, `index.ts`, `viewer-commands.ts`, `viewer-commands.test.ts`, `viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-input.ts`, `viewer-input.test.ts`, `viewer-store.ts` (modified)
- `src/features/workspace/workspace-shell.tsx`, `workspace-shell.test.tsx`, `workspace-status-bar.tsx` (modified)
- `src/workers/render-cache.ts`, `render-pdfjs.ts`, `render-protocol.ts`, `render.worker.ts`, `render.worker.test.ts` (modified)
- Review fixes: `src/core/pdf/sheet-label.ts`, `sheet-label.test.ts`, `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts`, `canvas-viewport.tsx`, `canvas-viewport.test.tsx`, `page-pager.tsx`, `page-pager.test.tsx`, `index.ts`, `src/features/workspace/workspace-shell.tsx`, `workspace-shell.test.tsx`, `src/workers/render-cache.ts`, `render.worker.ts`, `render.worker.test.ts`

### Change Log

- 2026-10-23: Story 3.3 implemented (Claude Opus 5.5). Status → review.
- 2026-10-23: Code review (Claude Opus 5.5): 9 findings (2 High, 3 Medium, 4 Low), all fixed with tests; founder decisions applied (sheet number only in the pager; case-insensitive typed labels). Status → done.
  - Zoom % like Revu (Task 0).
  - Page labels and sheet-number detection in the worker; page switching in the engine with per-page views.
  - The PagePager in the status bar, page keys, and the page announcement.
  - The multi-page fixture, unit tests and the pages e2e.
  - Commits 518d050, 00f9a29, 09a5cbd, 4ccb88c, 52c9c01, f2a24e3.
