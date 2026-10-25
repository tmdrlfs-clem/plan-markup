# Story 4.5: Draw a length measurement (editor foundation)

Status: in-progress

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
- [ ] **Task 3: Length tool** — viewer layer / tool interface (static and active layers, tool point / escape / cancel hooks, synchronous static repaint), `src/features/editor/length-tool.ts` (drawing, live label, captions, Esc / undo-in-progress rules), `Shift+Alt+L`, ToolRail Length live with its hint updated; unit tests.
- [ ] **Task 4: Tests** — `e2e/measure-length.spec.ts` (AC 8); local L17/L21 check (L17 at 1:75: the "1905" dimension measured; L21 from its detected 1:75 @ A1: the "1491" dimension); screenshot `fixtures/private/traces/4-5-length.png` (never commit private files).

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

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-25: Story 4.5 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
