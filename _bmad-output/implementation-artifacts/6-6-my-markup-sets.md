# Story 6.6: My markup sets

Status: done

## Story

As a drafter,
I want to see my markup sets and open one,
so that I can get back to my work even when I do not have the PDF at hand.

## Acceptance Criteria

1. **List:** File → Markup sets… and the EmptyWorkspace recent list show my sets with filename, page count and last modified, newest first, with an empty state (FR51). (The dialog list shipped with Story 6.5.)
2. **Open asks for the PDF:** opening a set (Open… in the list, or a recent item) asks for its local PDF ("Choose PDF…"). The same bytes (any filename) open as usual and the markups restore (Story 6.4).
3. **Blank pages otherwise:** "Blank pages", or a PDF with other bytes, shows the markups on blank pages with the set's page geometry, named like the set's file and with its page count; an info notice "Markups on blank pages: <file>, <n> pages" offers "Open the PDF…". Wording never suggests loss.
4. **The PDF replaces the stand-in:** opening the set's PDF while its blank pages are open replaces that tab (one tab per document); edits on blank pages save to the same set.
5. `npm run typecheck`, `lint`, `test`, `build`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Server** — `lib/db/markups.ts` `loadMarkupSetPages(drawingId)` (first file, pages in index order, paged by 1000); action `loadMarkupSetPages` (guid input).
- [x] **Task 2: Blank pages** — `core/markup-set/blank-pages.ts` `blankPagesPdf(pages)` (pdf-lib: crop box → media box, /Rotate).
- [x] **Task 3: Viewer** — `ViewerEngine.open(file, documentId?)`: markups use `documentId` (the set's sha) while caches keep the file's own hash; `standIn` in the viewer state; `viewerTabs.open(file, documentId?)` and `openDocumentAs`; a hashed PDF replaces a stand-in with the same document id.
- [x] **Task 4: UI** — `markup-sets-ui.tsx`: Open… per row, `OpenMarkupSetDialog` (Choose PDF… / Blank pages), `openSetWithFile` (sha-256 in the browser), `openOnBlankPages`, `useBlankPagesHint`, `useRecentSets` / `openRecentSet`; EmptyWorkspace recent items are buttons with "N pages · date".
- [x] **Task 5: Tests** — unit (blank pages, tabs stand-in, UI ×4, EmptyWorkspace ×2); `e2e/open-markup-set.spec.ts`.

## Dev Notes

- The blank file is generated in the browser; no PDF bytes leave the machine (NFR26). Its own hash only keys the render caches (previews, scale detection), so a later real PDF never sees cached results of blank pages.
- Hashing the chosen file runs on the main thread (`crypto.subtle`); the render worker hashes it again on open.
- The recent list shows the 5 newest sets, loaded whenever the workspace becomes empty.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.6], FR51, NFR26, UX-DR11, UX-DR30

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- CI green (1749e13). Unit: markup-set/workspace/viewer/core markup-set 361 pass. e2e (dev): open-markup-set, other-version, restore-markups, workspace-shell, document-tabs, open-drawing pass.

### File List

- src/lib/db/markups.ts, src/features/markup-set/actions.ts
- src/core/markup-set/blank-pages.ts (new), blank-pages.test.ts (new)
- src/features/viewer/viewer-engine.ts, viewer-store.ts, viewer-tabs.ts, viewer-tabs.test.ts, index.ts
- src/features/markup-set/markup-sets-ui.tsx, markup-sets-ui.test.tsx, save-indicator.test.tsx, sync.test.ts
- src/features/workspace/empty-workspace.tsx, empty-workspace.test.tsx (new), workspace-shell.tsx, workspace-shell.test.tsx
- e2e/open-markup-set.spec.ts (new)
