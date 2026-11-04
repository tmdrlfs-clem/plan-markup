# Story 5.7: Pen and highlight tools

Status: review

## Story

As a drafter,
I want freehand pen and highlighter,
so that I can mark quickly by hand.

## Acceptance Criteria

1. **Tools and keys:** Pen (`P`) and Highlight (`H`) arm from the keyboard (canvas focused; `Shift+P` stays Polygon) and from the Tool rail; the HintBar says how they work.
2. **Drawing:** a press and drag draws a freehand stroke that follows the pointer (never snapped); the release adds it as one undo step ("Add pen", "Add highlight"); the tool stays armed. Holding `Shift` holds the stroke horizontal or vertical on screen (whichever the pointer is nearer) from where Shift was pressed, or from the stroke's start; releasing Shift continues freehand. A click, or a press that never moved, adds nothing (D2). Esc during the stroke, or a lost pointer, drops it.
3. **Smoothing:** the stroke is captured at points at least 1 CSS px apart, simplified on release (Douglas–Peucker within 0.35 CSS px at the zoom it was drawn at), and painted smoothed through its points (quadratic curves through the segments' midpoints) with round caps and joins (FR31).
4. **Markups and rendering:** Zod schemas `pen` and `highlight` (2–10 000 points). A pen stroke takes the markup style (red, 1 pt, D1). A highlight is yellow, 12 pt, at 40 % opacity (D1), painted on its own canvas between the sheet and the other markups with a multiply blend, so the sheet's linework stays dark under it (D3: highlights are always under the other markups). Layer 2 lists them as "Pen" and "Highlight".
5. **Editing:** strokes work with Select (hit within half their width), move, nudge, delete, resize / rotate, copy / paste, group, order (among strokes of their kind for highlights), align, lock; no vertex handles (D4).
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: `P` drags a stroke; a click adds nothing; `H` with Shift draws a horizontal highlight, the highlights canvas is `mix-blend-mode: multiply` with 40 % alpha on the held line and none where the pointer went; each one undo step.

## Tasks / Subtasks

- [x] **Task 1: Core** — schemas; core/markup/ink.ts (straight hold, simplification, smoothing); hits and R-tree padding by half the width; unit tests.
- [x] **Task 2: Viewer** — tools `pen`, `highlight` (`InkTool`, markup tools, not snapping); keys `P`, `H`; an `ink` drag in the input (Shift held on screen); engine `inkTool`; the highlights canvas (`mix-blend-multiply`, the host `isolate`) painted by the painter's `paintUnder`.
- [x] **Task 3: Editor** — the stroke in progress (`Drawing.anchor` for Shift), committing, painting (smoothed, round; highlights under), moves repaint layer 3 only; no vertex handles; rail live with hints; unit tests.
- [ ] **Task 4: Tests** — `e2e/ink-tools.spec.ts` (AC 6), in CI.

## Dev Notes

- Shift is held in screen space by the input (it knows the pointer), so a stroke is straight on screen on a rotated sheet too; the painter replaces the points after the anchor with the held one.
- Each move sets the drawing; the editor tells the viewer `activeOnly` when only the drawing changed, so layer 2 is not repainted on every move (it paints none of the drawing).
- Defaults chosen here, to confirm with the founder: pen red 1 pt, highlight yellow 12 pt 40 % (D1); a click adds nothing (D2); highlights always under the other markups, on the multiply layer; the stroke being drawn shows at 40 % without the multiply (D3); no vertex handles on strokes (D4); one stroke is one markup (D5: no joining of quick successive strokes).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.7], FR31
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Keyboard Shortcuts]
- [Source: _bmad-output/implementation-artifacts/5-6-text-box-callout-typewriter-note-and-cloud.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `pen` and `highlight` schemas, `InkMarkup`, `isInkMarkup`, `DEFAULT_HIGHLIGHT_STYLE`; core/markup/ink.ts: `straightFrom`, `simplifyStroke` (iterative Douglas–Peucker), `strokeHasLength`, `smoothPath`; a stroke is hit within half its width, the R-tree pads it so. Unit tests.
- Task 2: `InkTool` / `isInkTool` (markup tools, not snapping); keys `P`, `H`; input drag kind `ink` (press focuses the canvas, Shift held from where it began, Esc and lost capture cancel); `ViewerEngine.inkTool` and the painter's optional `ink` and `paintUnder`; `ViewerCanvases.highlights` (optional), a `highlights-canvas` in the viewport.
- Task 3: measure-tool `inkStroke` (start ends any typing; moves add points a CSS px apart or hold the straight part; end simplifies and adds, a click adds nothing; cancel drops), `strokeInk`, highlights in `paintUnder` (layer 2 lists them and draws their selection), the stroke in layer 3; the editor's subscription passes `activeOnly` when only the drawing changed; `vertexIndices` none for strokes; rail Pen and Highlight live with hints.
- Unit tests: 1848 pass. Local e2e not run (Docker off); CI runs `e2e/ink-tools.spec.ts`.

### File List

- src/core/schema/markup.ts, src/core/markup/ink.ts (new), ink.test.ts (new), geometry.ts, markup-index.ts
- src/features/viewer/viewer-store.ts, index.ts, viewer-input.ts, viewer-input.test.ts, viewer-engine.ts, markup-layer.ts, canvas-viewport.tsx
- src/features/editor/measure-tool.ts, editor-store.ts, undo-store.ts, handles.ts, ink-tool.test.ts (new)
- src/features/workspace/tool-rail.tsx, workspace-shell.test.tsx
- e2e/ink-tools.spec.ts (new)
