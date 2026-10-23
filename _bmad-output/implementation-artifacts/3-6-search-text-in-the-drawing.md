# Story 3.6: Search text in the drawing

Status: done

## Story

As a drafter,
I want to search text on the drawing,
so that I can find room names, notes and tags fast.

## Acceptance Criteria

1. **Given** a drawing with a text layer, **when** I press `Ctrl+F` with canvas focus (in-app search; with focus elsewhere the browser keeps `Ctrl+F`; *amended by the founder 2026-10-24: anywhere in the workspace while a drawing is open, the browser keeps it only with no drawing open and in text fields of dialogs/forms; see Review Follow-ups R3*) and type a query, **then** a Search panel opens in the left panel area with a query field (focused) and a hit list; results update as I type (debounced ~150 ms) (FR21, UX "Search and filtering").
2. Hits cover all pages of the active tab's document: the list is grouped by page (page number + sheet label) with a short text snippet around each hit and a total count ("24 results on 3 pages"); matching is case-insensitive and whitespace-tolerant (runs of spaces/line breaks in the PDF text match a single space), with an option toggle for "Match case" and "Whole word".
3. Hits are highlighted on the canvas (accent outline/fill on a separate overlay layer above tiles, crisp at every zoom, follow rotation); the current hit is emphasised. `Enter` / `Shift+Enter` in the query field (and `F3` / `Shift+F3`) move to next / previous across pages, wrapping with a quiet "Search wrapped" status; moving to a hit switches page if needed and pans/zooms so the hit is visible with margin (zoom only increases when the hit would be smaller than ~24 CSS px tall). Clicking a hit in the list does the same and moves focus to the canvas (Revu behaviour, founder decision 2026-10-23).
4. An image-only page (no text content — reuse Story 3.1 content flags) is listed as "No searchable text on this page" when the whole document has no text, or summarised ("2 pages have no searchable text") otherwise.
5. Text extraction runs in the render worker (`render.text { page }` → items with string + quad in PDF user space), cached per document (memory, and IndexedDB keyed by sha256 + page like the tile cache), at a priority below tiles (same queue rules as 3.4 thumbnails / sheet labels; cancellable); searching never blocks the canvas — no main-thread task ≥ 50 ms on L17/L21. Matching itself runs in the worker or in a framework-free `src/core/search/` module on chunked input.
6. `Esc` in the field clears highlights and returns focus to the canvas; closing the panel clears highlights; the search state (query, current hit) is per tab and survives tab switches.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on a committed fixture with known text (extend or add a fixture: multiple pages, a phrase split across text runs, one image-only page) covers `Ctrl+F`, typing, count, next/previous with wrap, page switch, highlight presence, image-only message, Esc.

## Tasks / Subtasks

- [x] **Task 1: Worker text extraction** — `render.text` via the existing protocol (Zod at the boundary, `serializeWorkerError` + `code`), pdf.js `getTextContent`, items → quads (transform + width/height, rotation-safe), page text cache, cancellation and priority.
- [x] **Task 2: Search core** — `src/core/search/` (framework-free): normalisation (whitespace, ligatures/NFKC, case), match across item boundaries mapping back to item quads, whole-word, snippets; unit-tested.
- [x] **Task 3: Search panel UI** — left-panel registry entry "Search" (Story 1.7 components: TextField, ToggleButtons for options, list rows), hit list grouped by page, counts, empty/no-text states, keyboard (`Enter`/`Shift+Enter`/`F3`, list roving focus).
- [x] **Task 4: Canvas highlight + navigation** — overlay layer for hit quads (no React state per hit; reuse view transform), go-to-hit with page switch and minimal pan/zoom, per-tab state.
- [x] **Task 5: Tests** — unit (core search, quads, worker handler with stubbed pdf.js, panel), e2e `e2e/viewer-search.spec.ts`. Local check on L17/L21 (private, never commit): search "CH +2700" or "D1" finds expected hits, highlight positions match the drawing, no long tasks; screenshot `fixtures/private/traces/3-6-search.png`.

### Review Follow-ups (AI)

Adversarial review 2026-10-24 (Claude Opus 5.5) of 221b77d..626784a, with the founder decisions of 2026-10-24 applied. All fixed with tests unless marked otherwise.

- [x] **[High] R1: Stale current hit after a new query or new options.** `run()` kept `currentKey` (page + number), so `publish()` re-selected hit *n* of the old current page in the new results: a hit the user never chose was emphasised and Enter continued from it (visible in the first 3-6 screenshot: row 5 current right after re-typing "CH +2700"). Fix: `run()` clears the current hit (`document-search.ts`); test "a new query or new options start without a current hit".
- [x] **[High] R2: Enter / F3 right after typing did nothing.** `step()` flushed the debounce, which empties the hits, then returned because nothing was matched yet; the same while pages were still being read. Fix: a pending step, run on the first publish that can decide it (every page matched, or the pages from the shown one to the nearest hit in that direction are); typing drops it. Tests in `document-search.test.ts` and the e2e (`fill` + immediate Enter).
- [x] **[Medium] R3: Ctrl+F scope (founder decision 2).** Ctrl+F was in-app only with the canvas focused, so Ctrl+F in the Search field itself, the page number or a panel opened the browser's find bar. Now: in-app anywhere in the workspace while a drawing is open; the browser keeps it with no drawing open and in a text field of a dialog (`role=dialog/alertdialog`, `<dialog>`) or a `<form>`. `use-workspace-shortcuts.ts` (`searchScope`), `workspace-shell.tsx` (handlers only while `hasDocument`); UX spec keyboard table updated; unit tests and e2e (Ctrl+F from the page number field, from the Search field, and with no drawing).
- [x] **[Medium] R4: Highlight colour (founder decision 1) and theme changes.** Highlights used the accent orange, read once per engine, so a theme switch never recoloured them. Now theme tokens `--canvas-search-hit` (yellow fill), `--canvas-search-current` (amber fill) and `--canvas-search-outline` (dark amber outline, contrast pair at least 3:1 on the sheet) in all three themes, read through `readCanvasTokens` and re-read on every theme change (`subscribeCanvasTokens`). The engine test asserts the colours; the e2e asserts the canvas highlight pixels are yellow.
- [x] **[Medium] R5: Hit rows could not be told apart (founder decision 4).** The drawing-order snippet gave rows like "60 60 CH +2700 CH +2700 ...". Design: each row shows the matched text, then up to two texts nearest to it on the sheet (`src/core/search/context.ts` `nearbyText`: other items within 8 text heights, nearest first, not blank, not another copy of the matched text, cut at 20 characters, listed once), then a small locator (a dot in a page outline at the hit's position). Nearby text is worked out lazily per shown row and cached per hit (`DocumentSearch.nearbyOf`). On L17 the 14 "CH +2700" rows now read "CT.03 · A1", "D1 · CT.03", "CT.02 · 245", and so on. Unit tests (core, panel) and e2e (a locator per row).
- [x] **[Medium] R6: Hits within a page were in PDF drawing order**, so next / previous jumped around the sheet. Now sorted by position: top to bottom, and left to right within a line (centres within half a text height share a line); `sortByPosition` in `src/core/search/context.ts`, applied per page in `DocumentSearch`.
- [x] **[Medium] R7: Worker text memory was unbounded.** Every page's text items read for sheet labels or search stayed in the worker for the document's lifetime (and the main thread keeps its own copy for search). Now at most `TEXT_PAGES_IN_MEMORY` (32) pages, least recently used out; the rest come back from IndexedDB (`holdText`, unit-tested).
- [x] **[Low] R8: The results list's keyboard row survived a new query**, so Enter in the list could go to a hit index of the old results. The row now belongs to one query + options; test added.
- [x] **[Low] R9: F3 in the workspace's own fields or on a toolbar button fell through to the browser's Find next.** F3 / Shift+F3 now use the same scope as Ctrl+F (R3).
- [x] **[Low] R10: Blurry lower band in the founder-reviewed screenshot (investigation).** Finding: **tiles were still loading; not a request bug.** `perf-search` waited a fixed 1.5 s after each go-to-hit and 2 s before the screenshot, but on L17 at 188 % (bucket 2, about 35 tiles in and around the view) a reveal needs 2.3 to 10.3 s until every tile is in: 35, 3, 7 and 16 tiles were still pending 1.5 s after the four reveals, and every reveal reached zero pending (no tile left un-requested or stale, no memory-budget cut-off). Tiles are requested visible-first and centre-first, so the corners and the edge row come last: exactly the blurry band (the preview raster scaled up) in the screenshot. Fix: the engine publishes `data-pending-tiles` on the canvas (tiles in flight, plus 1 while the page preview is loading; unit-tested) and `perf-search` waits for it to reach 0 before measuring and before the screenshot. The re-taken screenshot is sharp everywhere. (Tile render speed on L17 is a 3.2 concern and is not changed here.)
- [x] **[Low] R11: An astral character in a match got half a glyph of quad** (`matchQuads` took `offset + 1` code units). Now the source character's full length; test added.
- [ ] **[Deferred] R12: "Search all open drawings" (founder decision 3).** Not implemented. Backlog note here and in `epics.md` (post-3.x follow-up after Story 3.6): an option in the Search panel to search every open tab, results grouped by drawing then page; the per-tab `DocumentSearch` engines can be queried together.

## Dev Notes

- Builds on 3.1–3.5: viewer engine/store per tab (`src/features/viewer/viewer-tabs.ts`, `src/core/documents/tabs.ts`), render worker queue/priority from 3.4, sheet-label text work from 3.3 (`src/core/pdf/sheet-label.ts` — reuse the text extraction, do not extract twice). Read the 3.3–3.5 story files including review follow-ups and deviations first.
- `Ctrl+F` is in-app only with canvas focus (UX shortcut table); do not steal it from text fields or the browser otherwise.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`); zoom % Revu-style.
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.6]; FR21
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] Search and filtering, Keyboard Shortcuts (Search text)
- [Source: _bmad-output/implementation-artifacts/3-5-multiple-drawings-in-tabs.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI run **39937204065** (5b5aa92: typecheck/lint/unit/guards, Playwright e2e on the production build including `viewer-search.spec.ts`, gitleaks): success.
- Local checks: `npm run typecheck`, `npm run lint` and `npm run build` are clean. `npm test`: 1274 unit tests in 114 files (Docker stopped).
- Local e2e on the production build (`E2E_PROD=1`, workers 1, Docker + local Supabase): 42 passed, 4 skipped (the opt-in private checks). `viewer-search.spec.ts` needed one fix on its first run: the image-only tab's canvas state is `image-only`, not `ready`.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-search`, private, nothing committed): L17 and L21 open in two tabs.
  - L17, "CH +2700": **14 results on 1 page**, the number of `CH +2700` text items pdf.js reads from the page. "D1", whole word: **31**, the number of `D1` items. L21, "CH +2700": **15 results**.
  - From the first key typed (40 ms per key) to the results: 558 ms, including the 150 ms debounce and the first text read (pdf.js `getTextContent` on L17: 826 items, 4,618 characters, about 275 ms in the worker).
  - Highlight positions: four hits in a row were each revealed: zoomed until the text is at least 24 px tall, and centred. In a 40 × 16 px box at the canvas centre, 640 of 640 px are highlighted and 46–159 px of dark drawing ink lie under them (the label's glyphs). The screenshot `fixtures/private/traces/3-6-search.png` shows every "CH +2700" label on screen boxed exactly, the current one stronger. It was reviewed and is not committed.
  - Longest main-thread task while typing, matching and moving between hits: **0 ms** (Long Tasks API: nothing ≥ 50 ms).
- **Review fixes (2026-10-24):** CI run **40020791406** (ebba035: typecheck/lint/unit/guards, Playwright e2e on the production build, gitleaks): success. `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 1291 tests in 115 files (Docker stopped). Local e2e on the production build (`E2E_PROD=1`, workers 1): 42 passed, 4 skipped. Locally Supabase ran on remapped ports 583xx (Windows had reserved 55956-57055 this boot; `supabase/config.toml` changed only locally, never committed).
  - Founder drawings (`PERF_L17=1`): L17 "CH +2700" 14 results (typed to results 553-727 ms), whole-word "D1" 31, L21 "CH +2700" 15. Highlight over the label's ink at the canvas centre for all four reveals (640 of 640 px). Reveals at 188 %: 35, 3, 7 and 16 tiles pending at 1.5 s; every tile in after 10.3, 2.3, 3.3 and 5.3 s (R10). Longest main-thread task 0 ms in four runs; the very first run after a fresh build (cold IndexedDB and code cache, before the per-phase instrumentation) logged one 219 ms task that did not recur.
  - Screenshot re-taken after the tiles settled: `fixtures/private/traces/3-6-search.png` (yellow highlights, the current hit amber, rows "CH +2700 · CT.03 · A1" with locators; not committed).

### Completion Notes List

- **Task 1: worker text extraction.**
  - `render.text { page }` → `{ items, index }` (Zod at the boundary, error codes as before).
  - `PdfjsTileRenderer.pageText` reads `getTextContent` once per page. `textItemOf` in `src/core/search/page-text.ts` turns each item into a run (baseline start, advance, font size) and a quad in page space, using the font's ascent and descent. The quads are rotation-safe: the text matrix and the viewport (with /Rotate) are applied.
  - pdf.js's empty line-end items mark the item before them as `eol`.
  - The worker keeps the items per page in memory and in IndexedDB (`<sha>:<page>:text:v1`, a JSON blob in the tile store, validated with Zod on the way out).
  - `render.sheetLabel` now reads the same items, so each page's text is read once.
  - The worker builds the normalised index (`buildPageText`) and transfers its typed arrays.
  - Priority: after previews and tiles, in queue order with sheet labels, before thumbnails. A cache miss waits for pdf.js off the queue's head, as thumbnails do. Text jobs can be cancelled.
- **Task 2: search core** (`src/core/search/`, framework-free).
  - `page-text.ts`: per-character NFKC (ligatures, full-width forms), whitespace runs collapsed to one space, and trimming. A virtual space goes between two items on different lines or with a visible gap (≥ 0.15 em); none goes inside a word split across runs. `folded` is the lower-case text, with the same length. Every code unit maps back to its item and offset.
  - `match.ts`: non-overlapping matches, case-insensitive by default, with Match case and Whole word. An edge that is not a word character needs no boundary, so `+2700` still matches as a whole word.
  - At most 5,000 matches per page.
  - Snippets are cut at spaces. Each item's quad is sliced to the matched characters.
- **Task 4: per-tab search, highlights and navigation.**
  - `DocumentSearch` belongs to a `ViewerEngine`, so there is one per tab. The query is debounced (150 ms); the options apply at once.
  - Text is asked for with the shown page first. Matching runs in time slices of 8 ms, at least one page per slice, so a slow page or a slow clock never starves the search. Results appear as pages arrive.
  - The current hit is kept by page and number while later pages are matched.
  - Next / previous start from the shown page and wrap around with a "wrapped" signal.
  - A background tab cancels its text requests and asks again on resume. A new document drops the texts and keeps the query.
  - The engine draws the highlights on the active layer as vector quads under the view transform, crisp and rotation-aware, in the theme accent: every hit at 30 %, the current hit at 55 % with an outline. They show only while the Search panel is open (`searchUi.panelOpen`) and not hidden by Esc.
  - `revealHit`: switches the page if needed. It zooms only up when the text would be under 24 px tall on screen (from the quad's text height, not the box), and centres the hit only when it is not already in view with a 32 px margin.
  - The canvas carries `data-highlights` ("<n>[ current]") for e2e and diagnostics, like `data-view`.
  - `activeSearch` (viewer-commands) follows the active tab's engine.
- **Task 3: Search panel** (`search-panel.tsx`), built from Story 1.7 parts:
  - A left-panel registry entry "Search" (Ctrl+F, no Alt key), between Thumbnails and Properties.
  - The panel has the query field (`TextField`), Match case and Whole word (`ToggleButton`), and previous / next (`IconButton`, with the Enter / F3 and Shift+Enter / Shift+F3 tooltips).
  - A polite status line gives the count ("24 results on 3 pages", "… so far · searching 3 of 12 pages", "No results") and a quiet "Search wrapped" for 2.5 s.
  - The results are a virtualised listbox, grouped by page with sheet labels. It uses `aria-activedescendant` and the arrow, Home / End, Page Up / Page Down and Enter keys.
  - A click or Enter on a result goes there and hands the focus to the canvas (founder decision). Esc in the field hides the highlights and returns to the canvas.
  - "No searchable text on this page" is listed per page when no page has text. Otherwise a summary such as "1 page has no searchable text" is shown.
  - Shortcuts: Ctrl+F with the canvas focused opens the panel (`openLeftPanel`, which never collapses it) and focuses and selects the field. F3 / Shift+F3 work on the canvas, in the Search panel or with nothing focused.
- **Task 5: tests.**
  - Unit tests: page text and quads, matching, worker `render.text` (priority, cancel, IndexedDB, shared reads), `DocumentSearch` (debounce, order, options, wrap, slices, pause/resume, prefetch, failures), the engine (reveal, highlights, lifecycle), the panel and the shortcuts.
  - Fixture `fixtures/pdf/search.pdf` (generator updated; the other fixtures regenerate byte-identical). `e2e/viewer-search.spec.ts` runs in CI; `e2e/perf-search.spec.ts` is opt-in and local.

**Decisions and deviations (for review):**

1. **Quads in page space**, the viewer's space (points, y down, /Rotate applied). This is a deviation: the story says PDF user space. The worker converts with the pdf.js viewport, so the main thread never handles PDF matrices.
2. **The normalised index is built in the worker.** Only the per-query matching runs on the main thread, in `src/core/search` with 8 ms slices. On L17 a page has about 4.6 k characters, so matching takes microseconds.
3. **"No searchable text"** means that the page's extracted text is empty. The 3.1 content flags are only known once a page's preview has rendered; for scans the result is the same.
4. **Positions inside a text item are proportional to the character index.** `getTextContent` gives no per-glyph widths. In a proportional font, a match that starts or ends inside a run can be off by a fraction of a glyph; hits on whole runs (the usual case: labels like "CH +2700") are exact.
5. **Highlight colour:** the theme accent (`--accent`), read once per engine.
6. **When highlights show.** Esc hides the highlights and keeps the query; Enter, F3, a click or a new query show them again. Closing the panel clears them, and reopening it shows them again. F3 also opens the Search panel if it is closed, so its highlights can show.
7. **Text is read when the panel opens**, for the no-text notes. Background tabs stop their text requests.
8. **Matches are capped at 5,000 per page** (a one-letter query on a dense sheet).
9. **Snippets follow the PDF's reading order**, which on drawings is the order the text was drawn, not its position on the sheet. A hit's neighbours in the list can come from elsewhere on the sheet.
10. **The search is lost when the workspace remounts.** If the workspace unmounts with tabs open, the engines are rebuilt, as in 3.5 decision 8.
11. **Task 4 was committed before Task 3**, because the panel needs the search model.

**Questions for the founder:** answered 2026-10-24 (yellow highlights, Ctrl+F anywhere in the workspace, "Search all open drawings" deferred, distinguishable hit rows); see Review Follow-ups.

**Review decisions (2026-10-24):**

12. **Hit rows:** matched text · up to two nearest texts on the sheet · a position locator (R5); a page's hits in reading order of their position (R6). Decision 9 (snippets in drawing order) is superseded.
13. **Highlight colours** are theme tokens (`--canvas-search-hit/-current/-outline`): the same yellow and amber in Blueprint and Daylight (the sheet is always white), stronger in Contrast. Decision 5 (accent) is superseded.
14. **Ctrl+F / F3 scope** (R3, R9): the workspace while a drawing is open; text fields of dialogs and forms, and "no drawing", keep the browser's.
15. **A pending Enter / F3** (R2) waits only for the pages between the shown one and the nearest hit in that direction; typing drops it.
16. **`data-pending-tiles`** on the canvas is a diagnostics attribute like `data-view` (R10).

### File List

- `_bmad-output/implementation-artifacts/3-6-search-text-in-the-drawing.md`, `sprint-status.yaml` (modified)
- `src/core/search/page-text.ts`, `page-text.test.ts`, `match.ts`, `match.test.ts` (new)
- `src/workers/render-protocol.ts`, `render.worker.ts`, `render.worker.test.ts`, `render-pdfjs.ts`, `render-cache.ts` (modified)
- `src/features/viewer/document-search.ts`, `document-search.test.ts`, `search-ui.ts`, `search-panel.tsx`, `search-panel.test.tsx` (new)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-commands.ts`, `index.ts` (modified)
- `src/features/workspace/panel-registry.ts`, `layout-store.ts`, `use-workspace-shortcuts.ts`, `use-workspace-shortcuts.test.ts`, `workspace-shell.tsx` (modified)
- `scripts/fixtures/make-viewer-fixtures.mjs`, `fixtures/README.md` (modified); `fixtures/pdf/search.pdf` (new)
- `e2e/viewer-search.spec.ts`, `e2e/perf-search.spec.ts` (new)
- Review fixes: `src/core/search/context.ts`, `context.test.ts` (new); `src/core/search/match.ts`, `match.test.ts`; `src/features/viewer/document-search.ts`, `document-search.test.ts`, `search-panel.tsx`, `search-panel.test.tsx`, `viewer-engine.ts`, `viewer-engine.test.ts`; `src/features/workspace/use-workspace-shortcuts.ts`, `use-workspace-shortcuts.test.ts`, `workspace-shell.tsx`, `panel-registry.ts`; `src/workers/render.worker.ts`, `render.worker.test.ts`; `src/app/globals.css`, `src/components/ui/tokens.ts`, `tokens.test.ts`, `token-names.ts`, `contrast-pairs.ts`; `e2e/viewer-search.spec.ts`, `e2e/perf-search.spec.ts`; `_bmad-output/planning-artifacts/ux-design-specification.md`, `epics.md` (modified)

### Change Log

- 2026-10-23: Story 3.6 implemented (Claude Opus 5.5). Status → review.
  - Worker text extraction with quads and a normalised index, cached per page; the search core; a per-tab search with canvas highlights and go-to-hit; the Search panel with Ctrl+F and F3.
  - Unit tests, e2e and the local L17/L21 check.
  - Commits 221b77d, ccf935c, c51481e, e33705e, 5b5aa92.
- 2026-10-24: Code review (Claude Opus 5.5): 11 findings fixed (2 High, 5 Medium, 4 Low), 1 deferred to the backlog by the founder; founder decisions applied (yellow highlights, Ctrl+F in the workspace, distinguishable hit rows). Status → done.
