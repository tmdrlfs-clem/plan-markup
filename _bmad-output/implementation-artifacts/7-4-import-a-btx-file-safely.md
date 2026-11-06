# Story 7.4: Import a `.btx` file safely

Status: done

## Story

As a drafter,
I want to import my Revu tool set file,
so that I keep the tools I already use.

## Acceptance Criteria

1. **Import:** Tool Chest → Import .btx picks a `.btx` file; the .btx worker parses it with the Story 2.1 parser (file 32 MB, decompressed per value / total, XML depth, no DOCTYPE/ENTITY, PDF node and item limits; NFR31) and draws each item with pdf.js in the worker (no eval, no scripting, annotations into the raster only), at 4 px/pt (≤ 2048 px), transparent, its paper size kept.
2. **F7 outcomes:** all ok → a set named after the file's title (else its file name) with every item as a tool, toast "Sprinkler Tools — 66 tools"; partial → the set plus a per-item report dialog with reasons (draws nothing, could not be drawn, too large, unreadable, could not be saved); invalid → "Not a Revu tool set file" with the reason, nothing changed; nothing drawable → the report, nothing created (FR42, UX-DR19).
3. **Never freezes or crashes:** parsing and drawing run in a worker started per import and ended after it (or after 2 minutes); each item's draw is given up after 15 s; a file over 32 MB is refused before it is read.
4. Items become image tools (the item's appearance as one PNG, subject = item name) stored like Story 7.2's (`tool-assets`), placed by Story 7.3. Faithful per-kind conversion (vector markups, counts, Carlito) is Story 7.5.
5. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Core** — `core/btx/import.ts` (`importItems`, `itemName`, `renderSize`, reasons): `buildItemPdf` (margin 0) per item, an injected renderer.
- [x] **Task 2: Worker** — `btx.worker.ts` "import" request (reply `imported`, PNGs transferred); `btx-render.ts` pdf.js renderer (transparent, blank check, timeout, document destroyed and awaited before the next); pdf.js factories exported from `render-pdfjs.ts`.
- [x] **Task 3: Main** — `features/tool-chest/import-btx.ts` (`importBtx`, `readInWorker`, `invalidReason`, `setNameOf`, `importedText`): create the set, then `addTool` per item (one request each, under the 16 MB action limit).
- [x] **Task 4: UI** — `import-btx-ui.tsx` (button with Importing…, outcomes, report dialog mounted in the shell); the panel's Import .btx is live.
- [x] **Task 5: Tests** — unit: core import 4, worker +3, import-btx 5, import UI 5; e2e `import-btx.spec.ts` (not a set, XML entities, synthetic 5 tools drawn and persisted; the founder's sprinkler-tools locally: 65 tools + 1 reported).

## Dev Notes

- Local run on the founder's sprinkler-tools.btx (66 items): 65 tools in about 15 s, 1 reported "It draws nothing" (#65, no appearance in the file, as the 2.1 report found); tiles checked by eye.
- pdf.js shares its parser worker port: destroying a document must be awaited before the next one opens ("PDFWorker.create - the worker is being destroyed").
- Defaults taken (D questions in the report): one tool per item as an image (vector conversion is 7.5); set name from the title; duplicate names kept; an import always makes a new set (no merge into an existing one); the report lists only the items not imported.
- Clean-room: behaviour from official Revu help and user observation; the format knowledge is the Story 2.1 spike's.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.4], FR42, NFR31, UX-DR19 (F7), docs/spikes/2-1-btx-report.md

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 2038 pass; build ok; check:* pass; e2e import-btx (2 incl. private file) + tool-chest pass (dev).
- CI green on a83f223 (unit, guards, Playwright e2e, gitleaks).

### File List

- src/core/btx/import.ts (new), import.test.ts (new)
- src/workers/btx.worker.ts, btx.worker.test.ts, btx-render.ts (new), render-pdfjs.ts
- src/features/tool-chest/import-btx.ts (new), import-btx.test.ts (new), import-btx-ui.tsx (new), import-btx-ui.test.tsx (new), tool-chest-panel.tsx, tool-chest-panel.test.tsx
- src/features/workspace/workspace-shell.tsx
- e2e/import-btx.spec.ts (new), e2e/tool-chest.spec.ts
