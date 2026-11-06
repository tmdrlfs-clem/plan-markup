# Story 7.3: Place tools and count devices

Status: review

## Story

As a drafter,
I want to place tools from the Tool Chest,
so that I can stamp symbols quickly and know how many I placed.

## Acceptance Criteria

1. **Arm and place:** a tile click arms the tool (the viewer's Stamp tool; the tile shows pressed); each click on the drawing places it centred there (one undo step, "Place tool") and it stays armed until `Esc` (back to Select); `S` arms the last tool again. A ghost of the tool follows the pointer (FR41, UX-DR19).
2. **Drag:** a tile dragged onto the drawing places it once where it is dropped.
3. **Real size:** a tool saved from a calibrated page is placed at real size (scaled by the source's and target's mm per user unit); on a page without a scale its tile is disabled with the reason ("Set this page's scale to place it at real size"); an unscaled tool keeps its paper size. Tiles also say why when no drawing is open or a tool cannot be read.
4. **Counts:** a device-typed tool's placement counts once per device type (group, label): its first markup carries `device`; several markups of a tool are placed as one group. The Markups List has a Device column, filter and sort; `deviceCounts` gives the counts for the legend (Story 7.8).
5. **Tip:** the first use of the Tool Chest shows one dismissible inline tip (UX-DR16).
6. `npm run typecheck`, `lint`, `test`, `db:test`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Core** — `core/tools/place.ts` (`toolScale`, `needsScale`, `placedMarkups`, `deviceCounts`, `deviceText`, `NEEDS_SCALE`); markup schema `device` ({group, label}); a saved tool drops `device` from its markups; Markups List `device` column/filter/sort/quick filter.
- [x] **Task 2: Viewer** — `stamp` tool (a markup tool), `S` key, `MarkupPainter.drop`, `ViewerEngine.dropTool`, canvas drag-over/drop of `TOOL_DRAG_TYPE`; HintBar text.
- [x] **Task 3: Editor** — `place` with Stamp, ghost in `paintActive`, `drop`; toasts for no tool / no scale / image loading.
- [x] **Task 4: Tool Chest** — `stamp-store.ts` (armed, dragging; reset per user); tiles are buttons (arm, drag, disabled reason, pressed); first-use tip.
- [x] **Task 5: Tests** — unit: place 4, stamp 4, tiles 2, viewer-input S, markup-list device; Markups List tests updated for the column; e2e `save-tool.spec.ts` "place tools".

## Dev Notes

- Defaults taken (D questions in the report): a placement keeps the tool's markups' own subjects; line widths and text sizes are not scaled (paper size), only geometry; page /Rotate swapping x/y factors is not handled specially (equal factors are the norm); the device sort puts non-devices first ascending; the counts are shown through the Device column and filter (a totals view comes with the legend, 7.8).
- Copy/paste of a placed device copies its count mark too (a copied symbol is another device).
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3], FR41, UX-DR16, UX-DR19

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 2021 pass; db:test 185 pass; check:* pass; e2e save-tool (3), tool-chest, markups-list, image-dimension, group-align-lock, shape-tools pass (dev).

### File List

- src/core/tools/place.ts (new), place.test.ts (new), tool.ts; src/core/schema/markup.ts; src/core/markup/markup-list.ts, markup-list.test.ts
- src/features/viewer/viewer-store.ts, viewer-input.ts, viewer-input.test.ts, markup-layer.ts, viewer-engine.ts, canvas-viewport.tsx, index.ts
- src/features/editor/measure-tool.ts, undo-store.ts, markups-list-panel.tsx, markups-list-panel.test.tsx, stamp.test.ts (new)
- src/features/tool-chest/stamp-store.ts (new), tool-chest-panel.tsx, tool-preview.tsx, tool-tiles.test.tsx (new)
- src/features/workspace/tool-rail.tsx
- e2e/save-tool.spec.ts
