# Story 8.2: Flatten markups and export a flattened PDF

Status: done

## Story

As a drafter,
I want to burn markups into the drawing,
so that I can issue a final as-built that nobody can change by accident.

## Acceptance Criteria

1. **Flatten (FR58, FR61, AR25):** with a drawing open (its own PDF), `Ctrl+Shift+M` (⌘⇧M), File → Flatten… or File → Export → Flattened PDF… opens the dialog "Flatten and export" (pages, hidden layers as in 8.1, the count). Flatten writes every chosen visible markup (white-out covers included) drawn into its page (on its layer's optional content), none left as an annotation, as a new local PDF "… (flattened).pdf"; the original file is untouched, and the PDF's own annotations (links, forms) are left as they are.
2. **Looks the same:** the flattened output is drawn from the same appearances as the editable export; the pdf.js render matches the canvas (checked), and the Story 2.4 harness keeps flattened vs native at 0 differing pixels.
3. **The app is unchanged (A2):** the markup set keeps its markups, editable; flatten output is only a deliverable.
4. A toast "Exported A1721 Rev C (flattened).pdf · N markups drawn into the pages." confirms; failures say why.
5. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Write** — `exportJobPdf(…, { flatten })` flattens every annotation it wrote (`flattenPage(…, only)`), returns `flattened`; the worker passes `flatten`.
- [x] **Task 2: UI** — `ExportKind` (`editable` | `flattened`), `exportName(…, "flattened")`; one dialog for both kinds (`openExport(kind)`); `Ctrl+Shift+M` (`isFlattenShortcut`); File → Flatten… and Export → Flattened PDF… enabled.
- [x] **Task 3: Tests** — core flatten keeps the base's own annotation (1), run-export flattened + shortcut (1); e2e `export-pdf.spec.ts` "flatten" (Ctrl+Shift+M, the download has no annotations and two drawn appearances, the markups unchanged).

## Dev Notes

- Defaults taken (D questions in the report):
  - the flattened file is "<drawing> (flattened).pdf" (the editable one keeps the drawing's name);
  - Flatten always writes a new file (download); it never changes the open drawing or its markups (A2);
  - flattened markups stay on their layers (optional content), so Revu/Acrobat can still hide a layer;
  - the PDF's own annotations are not flattened;
  - one dialog for both, with the same page and hidden-layer choices.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.2], FR58, FR61, AR25, A2, docs/export-mapping.md (A5)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 213 files / 2093 tests pass; build ok; check:* pass; e2e export-pdf (2), workspace-shell, whiteout pass.
- pdf.js render of the flattened download matches the canvas.
- CI green on a77ac2d (unit, guards, Playwright e2e, gitleaks).

### File List

- src/core/export/export.ts, from-app.test.ts; src/workers/export.worker.ts
- src/features/export/run-export.ts, run-export.test.ts, export-dialog.tsx, index.ts
- src/features/workspace/workspace-menu-bar.tsx
- e2e/export-pdf.spec.ts
