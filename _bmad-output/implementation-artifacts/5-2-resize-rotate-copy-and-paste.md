# Story 5.2: Resize, rotate, copy and paste

Status: ready-for-dev

## Story

As a drafter,
I want to resize, rotate and duplicate markups,
so that I can reuse and adjust them.

## Acceptance Criteria

1. **Handles (UX-DR13):** a selection shows, around its bounding box, 8 resize handles (when the box is at least 3 handles wide and tall on screen; a straight line has none) and a rotate handle above its top edge; a single selected markup also shows a handle on each vertex (a count: each marker). Handles are white squares (8 CSS px) with an accent border; the cursor shows the action over each (resize directions, `crosshair` for rotate and vertices).
2. **Resize:** dragging a resize handle scales the selection from the opposite handle (edges: one axis); `Shift` keeps the proportions, `Alt` scales from the centre. Captions keep their offsets.
3. **Rotate:** dragging the rotate handle turns the selection about its box's centre in 15° steps, `Shift`: 1° steps. Captions' offsets turn with it.
4. **Vertices:** dragging a vertex handle moves that vertex (an area's outline; a count's marker). An area that would cross itself is not kept (it goes back, with a note).
5. **Copy and paste:** `Ctrl+C` copies the selection; `Ctrl+V` pastes it centred at the pointer (the view's centre when the pointer is not over the canvas) on the shown page; `Ctrl+Shift+V` pastes in place (same coordinates). Pasted markups are new (new ids) and become the selection. `Ctrl+drag` on a markup copies the selection to where it is dropped, `Ctrl+Shift+drag` along a straight line (0°, 45°, 90° steps).
6. **Feedback and undo:** every change follows the pointer (NFR3, ≤ 50 ms) and is **one undo step** ("Resize markup(s)", "Rotate markup(s)", "Move vertex", "Paste markup(s)", "Copy markup(s)"); `Esc` during a drag puts it back (FR33).
7. **Core:** the transforms (scale about an anchor, rotate, set a vertex, constrain to 45° steps, copies with new ids on a page) in `src/core/markup`, unit-tested.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e (production build) on `fixtures/pdf/snap.pdf` at 1:100: an area around the rectangle; resize from a corner with Shift (area ×4 when doubled), undo; rotate 90° (area unchanged, outline turned), undo; a vertex drag changes the area; Ctrl+C / Ctrl+V adds a second area at the pointer; Ctrl+Shift+V adds one in place; Ctrl+drag copies; each step one undo.

## Tasks / Subtasks

- [ ] **Task 1: Core** — `src/core/markup/transform.ts`; unit tests.
- [ ] **Task 2: Viewer** — `ctrl` in the Select context; the cursor at a point as a string (`cursorAt`); Ctrl+C / Ctrl+V / Ctrl+Shift+V as selection keys with the pointer in user space.
- [ ] **Task 3: Editor** — handles (painted with the selection on layer 2, hit in device px), resize / rotate / vertex / copy gestures with a preview (`tools.preview`), the clipboard, paste; unit tests.
- [ ] **Task 4: Tests** — `e2e/resize-rotate-copy.spec.ts` (AC 8).

## Dev Notes

- Builds on 5.1 (`select-tool.ts`, `tools.moveDrag`, `MarkupIndex`). The preview holds changed markups by id and added ones; the measure painter paints them in place of the stored ones.
- Measurements stay measurements: resizing a length changes its value, as in Revu.
- Defaults chosen here, to confirm with the founder: corner handles scale freely, `Shift` proportional (D1); a line or polyline that is straight gets no box handles, only vertex and rotate handles (D2); vertex drags do not snap to the drawing yet (D3, a later polish); the clipboard is the app's own, per browser tab (D4); paste centres the copy at the pointer (D5); an area edited into a crossing outline goes back (D6).
- Revu behaviour (official help: Editing markups): resize / rotate handles, vertex handles, Ctrl+drag copy, paste in place.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2], FR33, NFR3, UX-DR13
- [Source: _bmad-output/implementation-artifacts/5-1-select-move-and-delete-markups.md]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

### File List
