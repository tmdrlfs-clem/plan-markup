# Story 8.1: Export a PDF with editable markups

Status: review

## Story

As a drafter,
I want to export my drawing with markups as standard PDF annotations,
so that others can open and edit them in Acrobat or Revu.

## Acceptance Criteria

1. **Export (FR60, AR25):** with a drawing open (its own PDF, not stand-in blank pages), File → Export → Editable PDF… opens the ExportDialog: Pages (all / current / a range like "1-3, 5"), "Include markups on hidden layers" (asked only when the document has hidden layers; otherwise markups on hidden layers are left out), and how many markups it will write. Export converts the markups on the main thread and `export.worker` writes them with `@cantoo/pdf-lib` following `docs/export-mapping.md` (native annotations; white-out and eraser flattened, A5); the original file and the markup set are unchanged.
2. **Opens and stays editable (NFR41):** the file opens in Chrome (pdf.js render checked); the Revu / Acrobat cells are recorded in `docs/export-mapping.md` for the founder's check before release (Story 8.5).
3. **Values (NFR8):** a measurement's `/Contents` and appearance label are the caption the app shows (its unit and precision; "Scale not set" when uncalibrated); the page's `/Measure` carries its scale.
4. **Confirms (UX-DR29):** the download is the drawing's own file name; a toast "Exported A1721 Rev C.pdf" says how many markups went in. Failures say why ("The PDF could not be written.").
5. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Convert** — `core/export/from-app.ts`: `exportCalibration`, `captionText`, `exportMarkup` (every app type; upright boxes as Square/Circle/FreeText, turned ones as polygons; revision stamp and legend as FreeText of their text; images with alpha), `exportJob` (pages, hidden layers, covers to flatten). `core/export/page-range.ts`.
- [x] **Task 2: Write** — `exportJobPdf` (layers once for all pages, `flattenPage(…, only)` for covers); `ImageResource.alpha` → `/SMask`; `valueText` overrides the computed measurement text; `writeAnnotations` takes shared `ocgs`; `workers/export.worker.ts`.
- [x] **Task 3: UI** — `features/export`: `runExport` (decode images, fresh worker, download), `ExportDialog`, File → Export submenu (Flattened PDF… stays for 8.2); the shell sets the author.
- [x] **Task 4: Tests** — from-app (7, incl. a real PDF written and read back), page-range (2), export worker (2), run-export (3); e2e `export-pdf.spec.ts` (draw, export, read the download with pdf-lib).

## Dev Notes

- Defaults taken (D questions in the report):
  - the file downloads under the drawing's own name (the browser adds " (1)" if taken);
  - white-out and eraser strokes are flattened even in the editable export (A5); everything else stays editable;
  - revision stamps and legends export as editable text boxes (the legend's symbols are not drawn);
  - an annotation's author is the signed-in user's display name;
  - export needs the drawing's real PDF (stand-in blank pages refuse with why).
- Known gaps: area holes are not cut out of the exported appearance; a turned text box is written upright; highlight is ink without multiply.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.1], FR60, NFR8, NFR41, AR25, UX-DR29, docs/export-mapping.md (A5)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 213 files / 2091 tests pass; build ok; check:* pass; e2e export-pdf, legend, whiteout, workspace-shell pass (11).
- pdf.js render of the e2e's exported PDF matches the canvas (length, rectangle, white-out burned in).

### File List

- src/core/export/from-app.ts (new), from-app.test.ts (new), page-range.ts (new), page-range.test.ts (new), export.ts, annotations.ts, flatten.ts, measure.ts, model.ts; src/core/pdf/form.ts
- src/workers/export.worker.ts (new), export.worker.test.ts (new)
- src/features/export/run-export.ts (new), run-export.test.ts (new), export-dialog.tsx (new), index.ts (new)
- src/features/workspace/workspace-menu-bar.tsx, workspace-shell.tsx
- e2e/export-pdf.spec.ts (new); docs/export-mapping.md
