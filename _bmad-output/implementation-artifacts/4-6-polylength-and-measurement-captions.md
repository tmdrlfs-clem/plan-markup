# Story 4.6: Polylength and measurement captions

Status: in-progress

## Story

As a drafter,
I want multi-segment lengths and movable captions,
so that I can measure pipe runs and keep labels readable.

## Acceptance Criteria

1. **Given** the Length tool from Story 4.5, **when** I choose Polylength (ToolRail, or `Shift+Alt+Q`) and click points, **then** each click adds a vertex (with the 4.1 snap service and the 4.3 R1 rules: glyph, `Shift` holds 0/45/90° from the last point, `Alt` turns snapping off), a rubber band follows the tool point from the last vertex, and the **live total** (placed segments plus the rubber band) shows beside the cursor in the page calibration's unit and precision (FR26, UX-DR15). An uncalibrated page says "Scale not set" in the warning colour (as 4.5).
2. **Finishing:** a double-click or `Enter` finishes the polylength when it has at least two vertices (the double-click adds no extra vertex); the finished polylength is drawn with its total as a caption and is one undo step ("Add polylength"). `Backspace` or `Ctrl+Z` while drawing removes the last vertex (the last one removed ends the drawing; Edit → Undo says "Undo Polylength point"); `Esc` cancels the polylength in progress, `Esc` again returns to Select (as 4.5). The tool stays armed after a finish. Another tool, page or tab cancels a polylength in progress.
3. **Values** come from `src/core/measure` (`lengthMm` summing the segments over the 4.4 `measureLength`, separate X/Y factors, UserUnit), formatted with `formatMeasured`, so a polylength equals the sum Verify would report for its segments at full precision (NFR8); unit-tested (NFR45). Geometry only is stored; recalibrating updates the caption (as 4.5).
4. **Caption placement:** by default a polylength's caption sits along its longest segment, centred, above it and never upside down (the 4.5 rule); a length's stays at its middle.
5. **Moving a caption:** with Select, `Shift` + drag on a length or polylength caption moves the caption only (the measurement stays); the move is previewed live and is one undo step ("Move caption"); the offset is stored with the markup (PDF user space, so it follows zoom and rotation) and survives a reload (4.5 session). `Esc` during the drag puts it back. A serialisable `markups.update` op (before / after markups) carries the change.
6. **Caption style** follows the markup's style (colour, size in points) and the page calibration's unit and precision (4.5): changing the calibration's unit or precision changes every caption on that page.
7. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` covers: Polylength from `Shift+Alt+Q` and the ToolRail, the live total, finishing with `Enter` and with a double-click, `Backspace` and `Ctrl+Z` removing the last vertex, `Esc`, undo / redo of "Add polylength", a caption moved with `Shift`+drag and its undo, and a reload keeping a moved caption.

## Tasks / Subtasks

- [x] **Task 1: Core** — `polylength` in the markup schema (2 to 10 000 points), an optional `captionOffset` on measurements, a `markups.update` op with its inverse, `polylineCaptionAnchor` (longest segment) in `src/core/measure/length.ts`; unit tests.
- [ ] **Task 2: Polylength tool** — `polylength` viewer tool (snapping, crosshair), engine finish hook (`Enter`, double-click) and `Backspace`, the measuring painter generalised to both tools (`src/features/editor/measure-tool.ts`), `Shift+Alt+Q`, ToolRail Polylength (live) and hint, undo labels; unit tests.
- [ ] **Task 3: Caption move** — caption hit boxes from the painter, engine caption drag (preview, commit, cancel), `Shift`+drag with Select in `viewer-input`, "Move caption" as a `markups.update` op; unit tests.
- [ ] **Task 4: Tests** — `e2e/measure-polylength.spec.ts` (AC 7); local L17/L21 check (a polylength along L17's "1905" dimension through its midpoint reads 1905 mm; L21's "1491" likewise); screenshot `fixtures/private/traces/4-6-polylength.png` (never commit private files).

## Dev Notes

- Reuse the 4.5 editor foundation: `executeOp` / ops for every change, `registerDrawingUndo` for the point undo, the viewer `MarkupPainter` interface (the viewer never imports the editor), the session (records validated by `recordBelongsTo`; `markups.update` ops must belong to the document too).
- Revu behaviour (official help: Polylength measurement; Markup captions): click vertices, double-click or Enter finishes, Backspace removes the last vertex, Esc cancels; the measurement stays editable through its properties (Epic 5).
- Founder decisions (4.5, confirmed): 10 pt captions in page units, Revu red #FF0000 1 pt with end ticks, caption above the line never upside down, Esc with nothing drawn returns to Select, measurements kept for the session on tab close.
- `Shift` while a measuring tool is armed keeps meaning 45° steps (4.1), so captions move with Select + `Shift`+drag (selection itself arrives with Epic 5).
- Clean-room: behaviour from official Revu help and user observation only.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6]
- [Source: _bmad-output/implementation-artifacts/4-5-draw-a-length-measurement-editor-foundation.md] including Review Follow-ups R1-R6 and the founder decisions

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log

- 2026-10-25: Story 4.6 created from the epics (Claude Opus 5.5). Status → ready-for-dev.
