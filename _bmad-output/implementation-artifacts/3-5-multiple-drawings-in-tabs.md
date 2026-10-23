# Story 3.5: Multiple drawings in tabs

Status: ready-for-dev

## Story

As a drafter,
I want several PDFs open in tabs,
so that I can compare and switch between sheets quickly.

## Acceptance Criteria

1. **Given** one drawing is open, **when** I open another PDF (File > Open, `Ctrl+O`, drop on the canvas or EmptyWorkspace), **then** it opens in a new document tab (above the canvas) and becomes active; opening a file whose sha256 is already open activates that tab instead of opening a duplicate (FR18).
2. Tabs switch by click and by keyboard: `Ctrl+Tab` / `Ctrl+Shift+Tab` are browser-reserved, so use `Ctrl+PageDown` / `Ctrl+PageUp` when the canvas or tab strip has focus (check the UX shortcut table first and follow it if it names others); the tab strip is a Radix/Story 1.7 `Tabs` list with roving focus, arrow keys and `aria-selected`.
3. Each tab keeps its own page, per-page views (zoom, centre, rotation, fit mode), thumbnails scroll position and active tool; switching back restores them exactly, without re-parsing when the document is still loaded.
4. Closing a tab (close button, middle-click, `Ctrl+F4` — `Ctrl+W` is browser-reserved) frees its render resources: worker document closed, in-memory tiles/thumbnails/bitmaps released (IndexedDB cache kept). Closing the active tab activates the neighbour (right, else left); closing the last tab returns to EmptyWorkspace.
5. The tab shows the sheet label or file name (truncated, near-sharp tokens) with a thin progress bar while loading (UX: "Loading PDF … thin progress bar in the tab"); the tooltip shows the full file name. A render error shows in that tab only.
6. Memory: background tabs keep the document open in the worker but drop their in-memory tiles beyond a small budget so the active tab keeps most of the 256 MB tile budget; the number of open tabs is capped (e.g. 8) with a quiet toast explaining the limit.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) covers: open two fixtures, switch by click and keys, state kept per tab (page + zoom), duplicate open activates existing tab, close frees and returns to EmptyWorkspace, tooltip text.

## Tasks / Subtasks

- [ ] **Task 1: Model** — multi-document store: list of open documents (id, sha256, file name, labels, status, per-page views, current page, tool state), active id; the current single-document viewer store becomes per-document state (keep `src/core` framework-free; zustand vanilla stores).
- [ ] **Task 2: Worker/engine** — one render worker for all documents (documents keyed by id in `render.open`/`render.close` and every request) or one per document — measure memory and choose; record the decision. Close frees pdf.js documents and caches; cancel in-flight work of an inactive tab.
- [ ] **Task 3: DocumentTabs UI** — tab strip above the canvas with Story 1.7 `Tabs`, close buttons (`IconButton` X), tooltips, loading bar, error marker; keyboard per AC 2/4; EmptyWorkspace when none.
- [ ] **Task 4: Wiring** — open/drop/recent paths create tabs; status bar, pager, thumbnails panel and HintBar follow the active tab; per-tab memory budget and cap.
- [ ] **Task 5: Tests** — unit (store transitions, duplicate detection, close neighbour rule, resource release, budget split) and `e2e/viewer-tabs.spec.ts` using committed fixtures (`fixtures/pdf/multi-page.pdf` plus one other committed PDF). Local check with L17 + L21 open together (private, never commit): switching shows the cached view instantly, no main-thread task ≥ 50 ms; screenshot to `fixtures/private/traces/3-5-tabs.png`.

## Dev Notes

- Builds on 3.1–3.4: `src/features/viewer/*` (viewer-store, viewer-engine, canvas-viewport, document-viewer, page-pager, thumbnails-panel), render worker protocol (`render.<verb>`, `result | progress | error`, `serializeWorkerError` + `code`, Zod at the boundary), IndexedDB tile cache keyed by sha256. Read the 3.2–3.4 story files including review follow-ups and deviations first.
- Founder decision (2026-10-23): clicking a thumbnail moves focus to the canvas (Revu behaviour) — applied in the 3.4 review fixes.
- Undo history per document (UX) is a later epic; keep the per-document state shape ready for it.
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; tests co-located; exact pins; one browser/server at a time; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`); zoom % Revu-style.
- Commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.5]; FR18
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] tabs (sheet labels, tab progress bar, tooltip), Keyboard Shortcuts, EmptyWorkspace
- [Source: _bmad-output/implementation-artifacts/3-4-thumbnails-panel.md]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
