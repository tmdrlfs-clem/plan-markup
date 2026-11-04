# Story 5.12: Markup layers

Status: done

## Story

As a drafter,
I want to organise markups into layers,
so that I can show, hide or lock groups of work.

## Acceptance Criteria

1. **Panel:** `Alt+Y` (or the left rail) opens Layers: the document's layers, top first, each with its markup count; "No layers yet" until one is made, "No drawing open" with none open; a note says what the active, hidden and locked layers do.
2. **Create, rename, reorder:** New layer adds "Layer n" (the first free n) on top and makes it active; the pencil or a double-click renames (Enter or leaving keeps it, Esc reverts, an empty name keeps the old one, up to 100 characters); the arrows move a layer up or down (D1: the list's order; the markups' drawing order does not change). Each is one undo step.
3. **Active layer:** the radio picks the active layer ("No layer": none); new markups go to it (copies and pasted markups keep their layers; restored ones go back where they were). A hidden or locked layer cannot be active; hiding or locking the active one leaves no layer active (D2).
4. **Show / hide, lock:** each one undo step. A hidden layer's markups are not painted, picked (click, marquee, Ctrl+A) or kept selected, and are not walls for Dynamic fill; a locked layer's markups behave as locked markups (selectable, not moved, edited or deleted; the locked note says why).
5. **Assign:** Properties has a Layer field (once the document has layers): the selection's layer ("Mixed" when they differ); choosing one moves the markups that are not locked, one undo step ("Move to layer").
6. **Delete:** an empty layer is deleted at once; one with markups asks where they go, with the scope ("It has n markups on m pages"): moved to another layer or none, or deleted with it; either is one undo step ("Delete layer", a compound op) and its undo puts the markups back in their drawing order.
7. **Session:** the layers are kept with the markups for the browser tab session (as Story 4.5's); print and export (later epics) leave hidden layers out unless chosen (FR67, recorded for those stories).
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI e2e on `fixtures/pdf/snap.pdf`: Alt+Y, New layer (active, "Undo Add layer"), a rectangle goes to it (count 1), Hide hides it ("Undo Hide layer"), Show brings it back, Delete asks with "It has 1 markup on 1 page." and moving it to No layer keeps it ("Undo Delete layer").

## Tasks / Subtasks

- [x] **Task 1: Core** — core/schema/layer.ts (layer schema, shown / locked, next name, move); markups' optional `layerId`; ops `layers.set` and `compound` (parts in order, undone in reverse, not nested); unit tests.
- [x] **Task 2: Editor** — the store's layers and active layer (`layersOf`, `activeLayerOf`, `setDocLayers`, `setActiveLayer`, `isShown`, `isLocked`); applying the ops; new markups to the active layer (`executeOp`); hidden markups out of painting, picking and Ctrl+A; locked by layer wherever a markup's lock counts; the session record's layers; layers.ts actions; unit tests.
- [x] **Task 3: Panels** — layers-panel.tsx (rows, active radio, rename, hide, lock, move, delete dialog); Properties' Layer field; component tests.
- [x] **Task 4: Tests** — `e2e/layers.spec.ts` (AC 8), in CI.

## Dev Notes

- A markup whose layer no longer exists counts as on no layer (shown, not locked by a layer).
- Layer changes are undoable document edits (Revu's are too in its markup set); the active layer is a per-session choice, not an undo step.
- Defaults chosen here, to confirm with the founder: D1 the layer order is the panel's only (no drawing order change; drag to reorder later); D2 a hidden or locked layer cannot be active; D3 deleting a layer "with its markups" deletes locked ones too (the dialog states the scope); D4 copies keep their layer, new markups with none go to the active layer.
- Clean-room: behaviour from official Revu help and user observation.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.12], FR67, UX-DR23
- [Source: _bmad-output/implementation-artifacts/5-10-properties-panel-and-format-painter.md] (D5: the layer field)
- [Source: _bmad-output/implementation-artifacts/5-3-group-align-order-and-lock.md] (locked markups)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Debug Log References

### Completion Notes List

- Task 1: `layerSchema`, `layerListSchema`, `layerById`, `layerShown`, `layerLocked`, `nextLayerName`, `moveLayer`; `layerId` on every markup; `layers.set`, `compound`, `SimpleDocOp`, `opParts`, `applyLayersOp`. Unit tests.
- Task 2: `doc.layers` / `doc.activeLayer`; `pageMarkups` leaves hidden layers out; `setDocLayers` drops the active layer when hidden, locked or gone and hidden markups from the selection; `withActiveLayer` in `executeOp`; the select index and Ctrl+A skip hidden layers; `isLocked` replaces `m.locked` checks (select, nudge, delete, align, handles, caption drag, Properties, the context menu); session `layers` (optional, older records still read); `recordBelongsTo` checks compound parts. Unit tests.
- Task 3: `LayersPanel`, `DeleteLayerDialog`; Properties' Layer `Select`. Component tests.
- Unit tests: 1901 pass. Local e2e not run (Docker off); CI run 41911847705 green with `e2e/layers.spec.ts`.

### File List

- src/core/schema/layer.ts (new), layer.test.ts (new), src/core/schema/markup.ts, src/core/commands/ops.ts
- src/features/editor/editor-store.ts, commands.ts, undo-store.ts, session.ts, select-tool.ts, measure-tool.ts, properties.ts, properties-panel.tsx, markup-context-menu.tsx, layers.ts (new), layers.test.ts (new), layers-panel.tsx (new), layers-panel.test.tsx (new), image-dimension.test.ts, index.ts
- src/features/workspace/workspace-shell.tsx, workspace-shell.test.tsx
- e2e/layers.spec.ts (new)
