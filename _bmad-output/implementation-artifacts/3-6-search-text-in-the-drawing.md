# Story 3.6: Search text in the drawing

Status: review

## Story

As a drafter,
I want to search text on the drawing,
so that I can find room names, notes and tags fast.

## Acceptance Criteria

1. **Given** a drawing with a text layer, **when** I press `Ctrl+F` with canvas focus (in-app search; with focus elsewhere the browser keeps `Ctrl+F`) and type a query, **then** a Search panel opens in the left panel area with a query field (focused) and a hit list; results update as I type (debounced ~150 ms) (FR21, UX "Search and filtering").
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

**Questions for the founder:**

- Highlight colour: the theme accent (now), or a Revu/Acrobat-style yellow?
- Should Ctrl+F also open Search when the focus is elsewhere in the workspace (a panel, the toolbar), not only on the canvas? The browser keeps it there today, as the UX table says.
- Revu can search all open documents. Should the panel get a "Search all open drawings" option (a later story)?

### File List

- `_bmad-output/implementation-artifacts/3-6-search-text-in-the-drawing.md`, `sprint-status.yaml` (modified)
- `src/core/search/page-text.ts`, `page-text.test.ts`, `match.ts`, `match.test.ts` (new)
- `src/workers/render-protocol.ts`, `render.worker.ts`, `render.worker.test.ts`, `render-pdfjs.ts`, `render-cache.ts` (modified)
- `src/features/viewer/document-search.ts`, `document-search.test.ts`, `search-ui.ts`, `search-panel.tsx`, `search-panel.test.tsx` (new)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-commands.ts`, `index.ts` (modified)
- `src/features/workspace/panel-registry.ts`, `layout-store.ts`, `use-workspace-shortcuts.ts`, `use-workspace-shortcuts.test.ts`, `workspace-shell.tsx` (modified)
- `scripts/fixtures/make-viewer-fixtures.mjs`, `fixtures/README.md` (modified); `fixtures/pdf/search.pdf` (new)
- `e2e/viewer-search.spec.ts`, `e2e/perf-search.spec.ts` (new)

### Change Log

- 2026-10-23: Story 3.6 implemented (Claude Opus 5.5). Status → review.
  - Worker text extraction with quads and a normalised index, cached per page; the search core; a per-tab search with canvas highlights and go-to-hit; the Search panel with Ctrl+F and F3.
  - Unit tests, e2e and the local L17/L21 check.
  - Commits 221b77d, ccf935c, c51481e, e33705e, 5b5aa92.
