# Story 4.5: Draw a length measurement (editor foundation)

Status: done

## Story

As a drafter,
I want to measure a straight length,
so that I can read real distances off the drawing.

## Acceptance Criteria

1. **Given** a calibrated page, **when** I choose Length (ToolRail, or `Shift+Alt+L`) and click two points, **then** while drawing the live value shows beside the cursor (CSS-px label on the active layer, in the page calibration's unit and precision), and the finished measurement is drawn on the page with its value as a caption (FR26, UX-DR15). Clicks use the 4.1 snap service and the 4.3 review R1 rules (glyph, `Shift` holds 0/45/90° from the first point, `Alt` turns snapping off). On an uncalibrated page the live label and the caption say "Scale not set" in the warning colour, never a number (4.7 adds the prompt).
2. **Values** come from `src/core/measure` (`lengthMm` over the 4.4 `measureLength`, separate X/Y factors, UserUnit) and are formatted with the 4.3 formatter (`formatReal`), so a length equals what Verify (4.4) reports for the same two points exactly (NFR8); unit-tested (NFR45). A measurement stores its geometry only (PDF user-space points); its value is derived from the page's calibration when drawn, so recalibrating the page updates its captions (Revu behaviour).
3. **Tool behaviour:** the tool stays active after a measurement (the next click starts another) until `Esc` (UX-DR6): `Esc` while drawing cancels the measurement in progress; `Esc` with nothing in progress returns to Select. Another tool, page or tab cancels a measurement in progress. `Ctrl+Z` while drawing removes the placed point (UX-DR35: undo removes the last point while drawing).
4. **Undo:** each finished measurement is one undo step ("Add length"); `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` and Edit → Undo / Redo undo and redo it (FR35); calibrations stay undoable as in 4.3, in the same history.
5. **Editor foundation (AR7, AR8, AR12, AR13):** one zustand vanilla editor store in `src/features/editor/` with slices `doc` (markups by document), `view` (the active tab / document), `tools` (the measurement in progress), `selection` (ids; filled by Epic 5), `history` (per document tab; the 4.3 undo store moves here and keeps its API); every document mutation is a command `{ do, undo, label }` built from a serialisable op (`markups.add`, `markups.remove`, `calibrations.set`), no direct setState of document data from components. The Zod markup schema lives in `src/core/schema/markup.ts` (discriminated union on `type`, `length` first; PDF user-space points; permissive UUID pattern, ids are UUID v7). Rendering uses the layer stack: finished markups on the static markups canvas (layer 2), the measurement in progress, live label and snap glyph on the active canvas (layer 3); the viewer stays independent of the editor through a registered layer / tool interface.
6. **Session (UX-DR36):** the undo history is serialised per browser tab (`sessionStorage`, per user and document sha256) with the markups and calibrations it acts on, so a reload keeps them until the browser tab closes: opening the same PDF again in this browser tab restores its measurements, calibrations and undo history. Closing a document tab drops its undo history (as 4.3) but keeps its measurements and calibrations for the session. Epic 6 replaces this with saving.
7. **Feedback (NFR3):** a click that places a point or finishes a measurement is drawn within 50 ms (static layer repainted synchronously on commit; measured in e2e from the pointer event to the paint).
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` covers: Length from the ToolRail and `Shift+Alt+L`, the live value, a finished measurement with its caption in mm and after recalibration in ft-in, Shift 45°, Esc semantics (cancel, then Select), `Ctrl+Z` removing the placed point, undo / redo of a measurement, the 50 ms paint, "Scale not set" on an uncalibrated page, and a reload restoring the measurement and its undo step.

## Tasks / Subtasks

- [x] **Task 1: Core** — `src/core/schema/markup.ts` (Zod union, UUID pattern), `src/core/ids/uuid.ts` (v7), `src/core/measure/length.ts` (`lengthMm`, caption text, caption placement), `src/core/commands/ops.ts` (ops, Zod schema, inversion); unit tests.
- [x] **Task 2: Editor store and session** — `src/features/editor/editor-store.ts` (slices), op-based commands (`executeOp`), the 4.3 history moved in (API kept: `executeCommand`, `undoActive`, `redoActive`, `activeUndoLabels`), calibrate apply as a `calibrations.set` op, `session.ts` (sessionStorage per user + sha256, restore on open, drop history on tab close); unit tests.
- [x] **Task 3: Length tool** — viewer layer / tool interface (static and active layers, tool point / escape / cancel hooks, synchronous static repaint), `src/features/editor/length-tool.ts` (drawing, live label, captions, Esc / undo-in-progress rules), `Shift+Alt+L`, ToolRail Length live with its hint updated; unit tests.
- [x] **Task 4: Tests** — `e2e/measure-length.spec.ts` (AC 8); local L17/L21 check (L17 at 1:75: the "1905" dimension measured; L21 from its detected 1:75 @ A1: the "1491" dimension); screenshot `fixtures/private/traces/4-5-length.png` (never commit private files).

### Review Follow-ups (AI)

Adversarial review 2026-10-25 (Claude Opus 5.5) of 2a6f612..e55d1c5: the editor store and its slices, document ops and their inverses, undo across calibrations and lengths, the viewer ↔ editor painter interface, sessionStorage persistence (keying per user and sha256, stale and corrupt data, tab close, user change), memory and per-frame cost, Esc / Ctrl+Z / Shift+Alt+L, and the tests. Founder decisions 2026-10-25 (answered questions, not to be asked again; the founder will reassess after real use): (1) captions are 10 pt in page units (they scale with the zoom; editable with Epic 5 properties); (2) Esc with nothing drawn returns to Select (only an Esc meant for the canvas); (3) markups are Revu red #FF0000, 1 pt, with end ticks, caption above the line and never upside down; (4) closing a document tab keeps its measurements and calibrations for the browser session (history dropped) until Epic 6 saving.

- [x] **[Medium] R1: Undoing a removal put the markups on top.** `markups.remove` inverted to a plain `markups.add`, which appends: undo changed the drawing order (Epic 5 delete would have shipped it). Fix: removals carry each markup's position (`at`, built by `removeMarkupsOp`); the inverse add puts each back where it was; the inverse of the inverse is the op.
- [x] **[Medium] R2: A session record was trusted as a whole once it parsed.** A record holding an op, markup or calibration of another document (corrupt, edited, or written by a bug) restored into this document's history, and its undo would change the other document. Fix: `recordBelongsTo` requires every op's document, every markup's and calibration's page id (by `sha256:` prefix, so a longer id that only starts alike is refused) to be this document's; otherwise the record is ignored.
- [x] **[Medium] R3: Another user's records stayed in the browser tab's storage.** They were never read by the next user (keys are per user), but on a shared computer they lingered until the tab closed. Fix: mounting the workspace for a user removes this tab's records of other users.
- [x] **[Low] R4: The duplicate-tab close path was untested, and opens of closed tabs were tracked forever.** Fix: the decision is a pure function (`closedTabs`), tested for a duplicate closed in favour of the shown tab, a duplicate of a background tab, a single tab, and everything closed; the restored-open keys of a closed tab are dropped.
- [x] **[Low] R5: Edit > Undo named the history's step while drawing**, but Undo then removed the placed point instead. Fix: while drawing, the menu says "Undo Length point" (and is enabled even with an empty history).
- [x] **[Low] R6: Per-frame cost.** Every pan / zoom frame rewrote the markups canvas's data attributes and drew every length of the page, including huge captions far off screen when zoomed in. Fix: lengths wholly off the canvas are skipped (their captions are still listed); the attributes are written only when they change, the paint time only on a markups change.

Also covered: one history across calibrations and lengths, undone and redone through four mixed steps in order (`session.test.tsx`).

Not defects (checked): op inverses for `markups.add` and `calibrations.set` (round trips in `ops.test.ts`); redo of an add after a restore replaces the same id, never duplicates; old records without `at` still parse (optional); a calibrations op for a document that is not shown changes nothing (undo only runs in the active tab); R5 of Story 4.3 (a retried open drops its history; the session restores history and calibrations together when the document is back); quota or blocked storage only loses the reload copy; sideways pages measure through the user-space X / Y factors (4.3 R2); the painter registers once per mounted shell (reference counted); an Esc handled by a menu, field or dialog never leaves the tool.

## Dev Notes

- Builds on 4.1 (snap, Shift / Alt, `getSnappedPoint`), 4.3 (calibration, undo stack per tab, R1 Shift-held point, R2 axes), 4.4 (`measureLength`, `verifyCalibration`; its review V1-V4). Read those story files including their review sections.
- Polylength and caption options are Story 4.6; the FR82 scale prompt and the uncalibrated rules beyond "Scale not set" are 4.7; selection, move and delete are Epic 5; saving is Epic 6.
- Markup colour: Revu's default measurement red (`#FF0000`), 1 pt line, caption 10 pt in page units (it scales with the zoom like the drawing).
- Facts carried: English everywhere; Story 1.7 components only; near-sharp tokens; warning = yellow + icon; `src/core` framework-free; tests co-located; exact pins; one browser/server at a time; stop Supabase/Docker with their own commands; never run `wsl --shutdown`; CI e2e on the production build (`E2E_PROD=1`).
- Commit per task with the repo's author; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5]; FR26, FR35, NFR3, NFR8, NFR45, AR7, AR8, AR12, AR13, UX-DR6, UX-DR15, UX-DR35, UX-DR36
- [Source: _bmad-output/planning-artifacts/architecture.md] editor store, rendering layers, `src/core` domains
- [Source: _bmad-output/implementation-artifacts/4-3-calibrate-a-page.md], [4-4-verify-a-calibration.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- `npx vitest run` (Docker stopped): 146 files, 1649 tests passed. `tsc --noEmit` and `eslint .` clean.
- `E2E_PROD=1 npx playwright test` (production build, local Supabase): 50 passed, 12 skipped (local-only perf checks).
- `measure-length.spec.ts`: click → layer 2 painted in 1.4 ms (NFR3: 50 ms).
- Local check `PERF_L17=1 E2E_PROD=1 npx playwright test perf-length`: L17 at 1:75, Length snapped to endpoints (-169.01, 98.57)-(-97.01, 98.57) reads **1905 mm** (paint 7.3 ms); L21 from its detected 1:75 @ A1, endpoints (139.12, -94.88)-(195.46, -94.88) read **1491 mm** (paint 1.4 ms). Screenshot `fixtures/private/traces/4-5-length.png` (not committed).

### Completion Notes List

- Core (Task 1): markup Zod schema (discriminated union, permissive UUID pattern, AR7), UUID v7, `core/measure/length.ts` (values through `measureLength` + `formatMeasured`, the same functions as Verify, so the two always agree), serialisable document ops with inverses.
- Editor store (Task 2): one zustand store with `doc` / `view` / `tools` / `selection` / `history` slices; the 4.3 per-tab histories moved into `history`; `executeOp` records ops as undo commands; Calibrate now applies a `calibrations.set` op (one undo step, as before). `session.ts` keeps markups, calibrations and the history (as ops) per user and sha256 in sessionStorage, Zod-validated on restore; another user starts empty; closing a document tab drops its history but keeps its markups and calibrations; a duplicate tab closed in favour of the open one keeps that tab's history (covered by code review only: the tab manager cannot be faked in a unit test).
- Length (Task 3): the viewer paints layer 2 and the drawing on layer 3 through a registered `MarkupPainter` (`features/viewer/markup-layer.ts`), so the viewer never imports the editor (AR10). Markup changes repaint synchronously. Clicks use the engine's tool point (snap, Shift 45°, Alt off: the 4.1 / 4.3 R1 rules). The tool stays armed; Esc while drawing cancels, Esc again returns to Select (only an Esc meant for the canvas: not one handled by a menu, field or dialog); Ctrl+Z while drawing removes the placed point; another tool, page, tab or document cancels. `Shift+Alt+L` arms Length (by `code`, not in fields or dialogs). Captions are derived on every paint: a recalibration (or its undo) updates them; without a calibration they read "Scale not set" in the new `--canvas-warning` token (#8a6400, readable on the white sheet in every theme).
- Defaults chosen (Revu-like, listed as questions): red #FF0000, 1 pt line with short end ticks, 10 pt caption in page units (scales with the zoom), caption above the line and never upside down; live value in screen px beside the pointer; a second click on the first point is ignored.

### File List

- `src/core/ids/uuid.ts` (new), `src/core/schema/markup.ts` (new), `src/core/measure/length.ts` (new), `src/core/commands/ops.ts` (new), `src/core/measure/length.test.ts` (new), `src/core/commands/ops.test.ts` (new)
- `src/core/calibration/units.ts`, `src/core/calibration/verify.ts`, `src/core/undo/stack.ts`
- `src/features/editor/editor-store.ts` (new), `commands.ts` (new), `session.ts` (new), `session.test.tsx` (new), `length-tool.ts` (new), `length-tool.test.ts` (new), `undo-store.ts`, `undo-store.test.ts`, `index.ts`
- `src/features/viewer/markup-layer.ts` (new), `viewer-engine.ts`, `viewer-engine.test.ts`, `viewer-input.ts`, `viewer-input.test.ts`, `viewer-store.ts`, `canvas-viewport.tsx`, `index.ts`
- `src/features/calibration/calibrate-store.ts`
- `src/features/workspace/workspace-shell.tsx`, `workspace-shell.test.tsx`, `workspace-menu-bar.tsx`, `tool-rail.tsx`, `use-workspace-shortcuts.ts`, `use-workspace-shortcuts.test.ts`
- `src/app/globals.css`, `src/components/ui/tokens.ts`, `token-names.ts`, `viewer-palette.test.ts`
- `e2e/measure-length.spec.ts` (new), `e2e/perf-length.spec.ts` (new, local only), `e2e/viewer-snap.spec.ts`

### Change Log

- 2026-10-25: Story 4.5 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
- 2026-10-25: Tasks 1-4 implemented (9c48602, 2c6c323, 8a202f8, 2a7dab8). CI run 40180790714 green (unit, e2e on the production build, secret scan). Status → review.
- 2026-10-25: Adversarial review R1-R6 fixed with tests (0f2125c, CI run 40182610430 green); founder decisions (1)-(4) recorded. Status → done.
