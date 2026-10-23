# Story 3.6: Search text in the drawing

Status: ready-for-dev

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

- [ ] **Task 1: Worker text extraction** — `render.text` via the existing protocol (Zod at the boundary, `serializeWorkerError` + `code`), pdf.js `getTextContent`, items → quads (transform + width/height, rotation-safe), page text cache, cancellation and priority.
- [ ] **Task 2: Search core** — `src/core/search/` (framework-free): normalisation (whitespace, ligatures/NFKC, case), match across item boundaries mapping back to item quads, whole-word, snippets; unit-tested.
- [ ] **Task 3: Search panel UI** — left-panel registry entry "Search" (Story 1.7 components: TextField, ToggleButtons for options, list rows), hit list grouped by page, counts, empty/no-text states, keyboard (`Enter`/`Shift+Enter`/`F3`, list roving focus).
- [ ] **Task 4: Canvas highlight + navigation** — overlay layer for hit quads (no React state per hit; reuse view transform), go-to-hit with page switch and minimal pan/zoom, per-tab state.
- [ ] **Task 5: Tests** — unit (core search, quads, worker handler with stubbed pdf.js, panel), e2e `e2e/viewer-search.spec.ts`. Local check on L17/L21 (private, never commit): search "CH +2700" or "D1" finds expected hits, highlight positions match the drawing, no long tasks; screenshot `fixtures/private/traces/3-6-search.png`.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
