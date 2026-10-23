# Story 3.5: Multiple drawings in tabs

Status: review

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

- [x] **Task 1: Model** — multi-document store: list of open documents (id, sha256, file name, labels, status, per-page views, current page, tool state), active id; the current single-document viewer store becomes per-document state (keep `src/core` framework-free; zustand vanilla stores).
- [x] **Task 2: Worker/engine** — one render worker for all documents (documents keyed by id in `render.open`/`render.close` and every request) or one per document — measure memory and choose; record the decision. Close frees pdf.js documents and caches; cancel in-flight work of an inactive tab.
- [x] **Task 3: DocumentTabs UI** — tab strip above the canvas with Story 1.7 `Tabs`, close buttons (`IconButton` X), tooltips, loading bar, error marker; keyboard per AC 2/4; EmptyWorkspace when none.
- [x] **Task 4: Wiring** — open/drop/recent paths create tabs; status bar, pager, thumbnails panel and HintBar follow the active tab; per-tab memory budget and cap.
- [x] **Task 5: Tests** — unit (store transitions, duplicate detection, close neighbour rule, resource release, budget split) and `e2e/viewer-tabs.spec.ts` using committed fixtures (`fixtures/pdf/multi-page.pdf` plus one other committed PDF). Local check with L17 + L21 open together (private, never commit): switching shows the cached view instantly, no main-thread task ≥ 50 ms; screenshot to `fixtures/private/traces/3-5-tabs.png`.

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

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- CI run: _pending (recorded after the push)_.
- Local checks: `npm run typecheck`, `npm run lint` and `npm run build` are clean. `npm test`: 1219 unit tests in 110 files.
- Local e2e on the production build (`E2E_PROD=1`, workers 1, Docker + local Supabase): 41 passed, 2 skipped (the opt-in L17 checks). `viewer-tabs.spec.ts` passed on its first run.
- **Founder drawings** (`PERF_L17=1 E2E_PROD=1 npx playwright test perf-tabs`, private, nothing committed): L17 and L21 open together as the tabs "A1721" and "A2121". With L17 zoomed in, six `Ctrl+PageDown` switches showed the other tab's view **8–12 ms** after the key press (a first run: 9.9–20.7 ms), with no re-parse and no new `render.open`. Longest main-thread task while switching: **0 ms** (Long Tasks API: nothing ≥ 50 ms). Worker JS heap (CDP `Runtime.getHeapUsage`): one tab 47.6 MB; two tabs 37.5 + 61.2 MB. Screenshot with both tabs, L17 active and zoomed: `fixtures/private/traces/3-5-tabs.png`, reviewed and not committed. The 3.4 thumbnail check (`perf-thumbnails`, whose sequential opens now become tabs) still reports 0 ms.

### Completion Notes List

- **Task 1: model.** `src/core/documents/tabs.ts` (framework-free): `MAX_TABS` (8), duplicate detection (`findDuplicate`: sha256, or before hashing a `name|size|lastModified` file key), the close rule (`activeAfterClose`: right neighbour, else left), `cycleTab`, the tile budget split (`tileBudgets`: 16 MB per background tab, the active tab gets the rest of 256 MB) and the tab keys (`resolveTabKey`). `LruByteCache.setBudget` shrinks or grows a cache in place. `ViewerState.tabId`.
- **Task 2: worker and engine.** One `ViewerEngine` and one render worker per tab (`src/features/viewer/viewer-tabs.ts`).
  - `viewerStore` stays the active tab's state, so the pager, status bar, thumbnails, HintBar, window title and commands follow the active tab unchanged. Each tab keeps a snapshot of that state. An engine's updates go to the store while its tab is active and to its snapshot otherwise. The store's own changes (tool, temporary pan) are copied to the active tab's snapshot. Switching puts the new tab's snapshot in the store. The tool is per tab, and a new tab starts with the tool in use.
  - `ViewerEngine.suspend()` (background tab): no frames and no settles. Tile and thumbnail requests are cancelled and thumbnail bitmaps dropped. The parsed document, the preview, the page views and the tiles within the background budget stay. A preview still loading keeps loading, and the tab reports ready when it arrives. `resume()` draws synchronously (the shared canvases never show the previous tab's frame) and settles at once. `setTileBudget()` sets the tile budget.
  - The CanvasViewport is the tabs' host. There is one set of canvases; the active engine gets the input (`ViewerInput`), the canvas size and `registerViewerEngine`. Closing a tab destroys its engine: this terminates its worker (pdf.js document and caches) and closes its bitmaps. The IndexedDB cache stays. Try again (render error) reopens the tab's file in the same tab.
- **Task 3: DocumentTabs** (`document-tabs.tsx`), built on the Story 1.7 `Tabs`:
  - Automatic activation: the arrows move and select, with roving focus and `aria-selected`.
  - The title is the shown page's sheet number, else the file name; the tooltip gives the full file name.
  - A thin progress bar shows in the tab while it loads. When the document failed, the tab shows a quiet `FileWarning` marker and ", could not be opened" in its name.
  - Close with the `IconButton` X (not a tab stop), a middle click, `Delete` on a focused tab or `Ctrl+F4`.
  - With the canvas or the strip focused, `Ctrl+PageDown` / `Ctrl+PageUp` and `Alt+PageDown` / `Alt+PageUp` cycle through the tabs.
- **Task 4: wiring.**
  - The canvas region is `DocumentTabs` around the viewer: the tab panel wraps the canvas, with no extra tab stop. The EmptyWorkspace shows when no tab is open.
  - Open…, `Ctrl+O` and drops open every PDF in its own tab and show the last one. Other files are skipped with a warning.
  - The cap shows a quiet info toast.
  - The Thumbnails list is keyed per tab and gets each tab's scroll offset back (`thumbnail-scroll.ts`).
- **Task 5: tests.**
  - Tab rules and `setBudget`.
  - The manager: a worker per tab; suspend and resume; page, view and tool per tab; background updates going to the tab's snapshot; duplicates by file key and by sha256; the cap; the close neighbour and worker termination; the empty workspace after the last tab; retry; host detach and re-attach.
  - The engine's suspend, resume and budget.
  - The strip: names, tooltip, loading and error states, click and arrows, close button, middle click and Delete, and keys scoped to the canvas or the strip.
  - The thumbnails scroll memory and the shell's multi-file drop.
  - E2E: `viewer-tabs.spec.ts` (CI) and `perf-tabs.spec.ts` (opt-in, local).

**Decisions and deviations (for review):**

1. **One render worker per tab** (Task 2's choice). Measured on L17/L21: about 40–60 MB of worker JS heap per open drawing, so 8 tabs stay around 0.5 GB of worker heap.
   - Per-tab workers keep the protocol and the 3.1–3.4 engine unchanged, and they render tabs in parallel.
   - A worker that crashes affects only its own tab, and closing a tab frees everything with one `terminate()`.
   - A shared worker would need document ids in every request and its own priorities across documents.
2. **Keys.** The UX shortcut table names no tab keys, so the story's `Ctrl+PageDown` / `Ctrl+PageUp` and `Ctrl+F4` are used.
   - Chrome keeps these keys for its own tabs unless the app is installed or in full screen. The e2e still passes because Playwright delivers them to the page.
   - So `Alt+PageDown` / `Alt+PageUp` also cycle the tabs, and `Delete` on a focused tab closes it. See the questions.
3. **The loading bar moved into the tab** (UX: "thin progress bar in the tab"). The canvas no longer has its own, so only one bar shows.
4. **Tab title.** The shown page's sheet number (as the pager shows it), else the file name. For a multi-page set the title follows the page.
5. **Duplicates.** Before hashing, a file with the same name, size and date activates the open tab at once. A copy under another name opens in a new tab. As soon as the worker's sha256 matches an open tab, that new tab closes and the existing one is shown.
6. **Memory.** A background tab keeps a 16 MB tile budget. The active tab gets 256 MB minus 16 MB per background tab, at least 144 MB with 8 tabs. The preview is held outside that budget, so switching back always shows the page at once while the tiles come back (from IndexedDB or rendered).
7. **Several files at once** all open as tabs (the last one shown), not only the first.
8. **Host re-attach.** If the workspace unmounts with tabs open (the sign-out flow, a dev double mount), the engines are destroyed. The files are reopened when it mounts again, which IndexedDB makes fast.
9. **Known minor issue:** a dismissed image-only HintBar notice shows again when its tab is shown again, because notices are per open, not per tab.

**Questions for the founder:**

- Chrome reserves `Ctrl+PageDown` / `Ctrl+PageUp` and `Ctrl+F4` for its own tabs unless the app is installed (PWA) or in full screen. There, `Ctrl+F4` closes the whole browser tab.
  - Should `Alt+PageDown` / `Alt+PageUp` be the everyday pair?
  - Do you want another close key (for example `Alt+W`, if no menu mnemonic needs it) or an "install the app" hint?
- Is 8 open drawings the right cap?
- Tab title: the shown page's sheet number (current behaviour) or always the file name?

### File List

- `_bmad-output/implementation-artifacts/3-5-multiple-drawings-in-tabs.md`, `sprint-status.yaml` (modified)
- `src/core/documents/tabs.ts`, `tabs.test.ts` (new)
- `src/core/render/tiles.ts`, `tiles.test.ts` (modified)
- `src/features/viewer/viewer-tabs.ts`, `viewer-tabs.test.ts`, `document-tabs.tsx`, `document-tabs.test.tsx`, `thumbnail-scroll.ts` (new)
- `src/features/viewer/viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-store.ts`, `canvas-viewport.tsx`, `canvas-viewport.test.tsx`, `thumbnails-panel.tsx`, `thumbnails-panel.test.tsx`, `index.ts`, `viewer-input.test.ts`, `page-pager.test.tsx` (modified)
- `src/features/workspace/workspace-shell.tsx`, `workspace-shell.test.tsx`, `open-files.ts` (modified)
- `e2e/viewer-tabs.spec.ts`, `e2e/perf-tabs.spec.ts` (new)

### Change Log

- 2026-10-23: Story 3.5 implemented (Claude Opus 5.5). Status → review.
  - Document tabs, each with its own engine and render worker; background tabs are suspended with a small tile budget.
  - The DocumentTabs strip, its keys, duplicate detection, the tab cap and per-tab thumbnail scroll.
  - Unit tests and e2e.
  - Commits 521a709, b814000, b355358, d1ed93b, bc719d7.
