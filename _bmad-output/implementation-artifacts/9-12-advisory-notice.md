# Story 9.12: Advisory notice

Status: done

## Story

As a sprinkler designer,
I want it clear that layouts are advisory,
so that responsibility for compliance is never misunderstood.

## Acceptance Criteria

1. Given the 4541 panel, when it is open, its footer states that layouts are advisory and the designer remains responsible for compliance (FR78).
2. The Export and Flatten dialogs offer "Include advisory notice", which adds the notice to exported pages.

## Tasks / Subtasks

- [x] `ADVISORY_NOTICE` in `core/sprinkler/report.ts` (no pdf-lib, so the panel can import it).
- [x] `core/export/notice.ts`:
  - `viewedFrame` finds the viewed page's bottom-left corner and reading direction for each /Rotate;
  - `noticeSize` scales the text to the sheet (7–12 pt, at least 5 pt, always one line);
  - `drawNotice` / `addNotice` draw a white band and the line into the page content.
- [x] `exportJobPdf(…, { notice })`, the export worker's `notice` field, and `ExportChoice.notice` passed through `runExport` to the writer.
- [x] Export / Flatten dialog: an "Include advisory notice" checkbox.
- [x] 4541 panel footer: an info line, always shown at the foot of the panel.
- [x] Tests:
  - `notice.test.ts` (4): frames per rotation, size, drawn on chosen pages (including a turned page), export with and without;
  - `export-dialog.test.tsx` (2): the default and the choice reaching `runExport`;
  - `run-export.test.ts`: the flag reaches the writer;
  - panel: the footer text.

## Dev Notes

- **D1, default.** The checkbox starts on when the drawing has zones or heads, and off otherwise. It can always be changed.
- **D2, which pages.** The notice goes on every exported page, not only the pages with zones.
- **D3, placement and look.**
  - It sits at the bottom left of the page as it is viewed (rotation applied), 12 pt in from the edges.
  - It is dark grey Helvetica on an 85% white band.
  - It is burned into the page content in both editable and flattened exports, so it cannot be deleted as an annotation.
- **D4, Print is unchanged.** The AC names Export and Flatten only; Print can get the same checkbox later if wanted.
- **D5, wording**, the same in the panel and on paper: "Sprinkler layout is advisory. The designer remains responsible for compliance with NZS 4541."

## Dev Agent Record

### File List

- src/core/export/notice.ts, notice.test.ts (new); export.ts (modified)
- src/core/sprinkler/report.ts (modified)
- src/workers/export.worker.ts (modified)
- src/features/export/export-dialog.tsx, run-export.ts, run-export.test.ts (modified); export-dialog.test.tsx (new)
- src/features/sprinkler/sprinkler-panel.tsx, sprinkler-panel.test.tsx (modified)
