# Story 8.3: Print

Status: review

## Story

As a drafter,
I want to print drawings with or without markups,
so that I can produce paper copies at scale.

## Acceptance Criteria

1. **Our print dialog (FR68):** with a drawing open (its own PDF), `Ctrl+P` (⌘P), File → Print… or the toolbar's Print… opens "Print" in place of the browser's own dialog: Pages (all / current / a range), "Print markups" (on by default), "Include markups on hidden layers" (only when markups are printed and there are hidden layers), Paper (Same as the drawing, A0–A4, Letter, Tabloid) and Scale (Fit to paper / Actual size 1:1). A summary line says what will print.
2. **A generated PDF:** Print builds the print PDF in the export worker. The chosen pages are flattened with their markups, or printed without them. Each page goes on one sheet of the paper, turned to the page's orientation (its /Rotate honoured), fit and centred or 1:1. The PDF is handed to the browser's print dialog through a hidden `blob:` frame, so actual-size output measures right on paper (the dialog reminds the user to keep the browser's scale at 100%).
3. **Hidden layers** are left out unless chosen.
4. Pages larger than the paper at actual size print cut at the edges, and a toast says how many. Failures say why (the print file could not be made; the browser did not open its print dialog). Stand-in blank pages cannot be printed.
5. The CSP allows `frame-src 'self' blob:` (nothing else is widened).
6. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Core** — `core/export/print.ts`: `PAPERS`, `placement()` (sheet, scale, centring, clipped), `rotatedOrigin()` (/Rotate 90/180/270), `printPdf()` (embedPage + drawPage; a page without a content stream prints blank), `printJobPdf()` (flatten the job first).
- [x] **Task 2: Worker** — `export.worker.ts` adds the `print` request (job or null, validated options) and the `printed` reply.
- [x] **Task 3: Run** — `run-export.ts`: shared `prepare()`, `runPrint()` (chosen hidden layers shown), the `inWorker()` helper, `printInFrame()` (hidden blob: iframe, `contentWindow.print()`).
- [x] **Task 4: UI** — `PrintDialog` (`openPrint`, `isPrintShortcut`, window keydown capture only while a drawing is open), File → Print… and the toolbar's Print… enabled, mounted in the shell.
- [x] **Task 5: Tests** — print.test.ts (5), worker print (1), runPrint (2), csp expectations; e2e `print.spec.ts` (Ctrl+P, summary, Print → blob frame + print(), toolbar and menu).

## Dev Notes

- Chrome prints a PDF in a `blob:` iframe through its PDF viewer even with `object-src 'none'`, once `frame-src` allows `blob:` (checked by hand in headed Chrome). Headless Chromium has no PDF viewer and never fires the frame's `load`, so the e2e fires it.
- The print frame stays in the DOM until the next print (removing it right away would cancel the browser's print dialog); its blob URL is revoked then.
- Without markups the job is null and the drawing's own PDF is laid out as is (its own annotations print as their appearances).

## Dev Agent Record

### File List

- src/core/export/print.ts (new), print.test.ts (new)
- src/workers/export.worker.ts, export.worker.test.ts
- src/features/export/run-export.ts, run-export.test.ts, print-dialog.tsx (new), index.ts
- src/features/workspace/workspace-menu-bar.tsx, workspace-toolbar.tsx, workspace-shell.tsx
- src/lib/security/csp.ts, csp.test.ts
- e2e/print.spec.ts (new)
