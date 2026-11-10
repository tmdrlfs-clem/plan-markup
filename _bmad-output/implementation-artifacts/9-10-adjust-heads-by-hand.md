# Story 9.10: Adjust heads by hand

Status: done

## Story

As a sprinkler designer,
I want to move, add or delete heads and see the check update live,
so that I can work around lights and services.

## Acceptance Criteria

1. Given a placed layout, when I drag, add or delete heads, the oracle checks the layout again live, and the report and markers update while I drag (FR76).
2. Edited heads are marked manual. Re-running placement on a zone first confirms the scope ("Re-place 2 zones, keep 3 edited heads") and keeps those heads fixed (UX-DR24, founder decision).

## Tasks / Subtasks

- [x] `core/sprinkler/heads.ts`:
  - `zoneAt(point, zones)`: the zone under a point, holes excluded.
  - `refineHeadEdits(op, markups)`: a head whose points change (a move, nudge, align, resize or rotate), or a head added that is not a restore (a copy or paste), becomes `manual` (a `locked` head stays locked). It also joins the zone its centre now sits in, or keeps its zone when it sits in none.
- [x] `undo-store.executeOp` runs every op through `refineHeadEdits`, so every edit path is covered. Place heads still uses `applyOp` + `recordAppliedOp`, so the engine's own heads stay `row` / `gapFill`. Undo restores the head as it was, kind included.
- [x] `editor-store.gestureMarkups`: the page's markups as they look mid-gesture (a move, a resize/rotate/vertex preview, or copies being dragged). The coverage overlay paints from it, so a head's coverage follows the drag.
- [x] `features/sprinkler/engine-channel.ts`: one engine worker and one request counter, shared by Place heads and the live check. `place-run` re-exports `setEngineChannelFactory`.
- [x] `features/sprinkler/live-check.ts`:
  - `zoneCheckStore` holds the latest `OracleReport` for each zone on the shown page.
  - `checksOf` collects each zone that has heads and a hazard, plus its neighbours: zones with heads whose box comes within the coverage radius. Each zone gets a key built from the zone version, the hazard, its heads rounded to 1 mm, and its neighbours' heads.
  - It subscribes to the editor, the viewer, the use map and the run, and evaluates once per microtask.
  - It skips while a run is going and checks once the run is over.
  - Per zone, at most one check is in flight. The newest state is sent when the reply comes in.
  - The engine opens with the first check (there is no Worker in jsdom).
- [x] Add head (`features/editor/head-place.ts`):
  - The Stamp tool runs in head mode, with a `heads` flag on `stampStore`. Arming a Tool Chest tool or choosing another tool ends it.
  - A click inside a zone adds a manual head there (one undo step, "Add head").
  - A click outside every zone adds nothing and shows a toast.
  - A ghost head follows the pointer.
- [x] 4541 panel:
  - an Add head button;
  - a re-run on zones that already have heads opens an AlertDialog ("Re-place 1 zone, keep 1 edited head", action "Re-place 1 zone");
  - each zone row shows a check badge: ✓, ⚠ n or ✕ n, with the first messages in the tooltip and an sr-only label;
  - the panel starts the live check.
- [x] Tests:
  - `heads.test.ts` +4: zoneAt; a move makes a head manual and moves it to another zone; a style change, a locked head and a zone move are left alone; paste vs restore; compound ops.
  - `live-check.test.ts` (4, real oracle in process): a check after the run and mid-drag; coalescing (5 changes while one check is in flight → 1 follow-up); a delete, and the report dropped when the heads are gone; neighbour choice and keys.
  - `head-place.test.ts` (5): add a head, click outside, mode end, a dragged head made manual through the nudge-end commit, gestureMarkups.
  - panel +2: check badge pass → error, confirm text, Cancel, Re-place keeps the edited head in place; Add head mode.

## Dev Notes

- **D1, "edited" means the head's points changed or it was added by hand.**
  - A recolour leaves a head as the engine's.
  - A head dragged into another zone joins that zone.
  - A head dragged outside every zone keeps its zone, and the check flags it as OUTSIDE.
  - Deleting an engine head is not remembered: a re-run places that spot again. Exclusion areas (keep-outs) come post-MVP with obstructions.
- **D2, Add head reuses the Stamp tool**, the way Fill zone and Polygon zone reuse Fill and Area. The ToolRail shows Stamp as active while heads are being added. A new ViewerTool would mean new rail, cursor and shortcut wiring for one panel button.
- **D3, live-check scope.**
  - Only the zone whose heads changed is checked again, plus the zones within reach of it (box within Rc), because spacing across zones counts.
  - Office floor: 5–13 ms per zone check with 14 neighbours, in the worker. Drag feedback lands within about a frame.
- **D4, what this story shows.**
  - The zone row badge (✓ / ⚠ n / ✕ n) is the live part.
  - The full ZoneReport, the canvas ✕/⚠ markers, zoom-to-marker and the polite live-region announcement are Story 9.11, which reads `zoneCheckStore`.
- **D5, the re-run confirmation appears only when a zone in scope already has heads.** A first run starts at once. The confirmation counts the edited heads that stay (manual and locked), and says how many zones have no heads yet.
- **D6, Place heads checks its own zones.** The live check waits while a run is going, then checks every changed zone once, so a run is checked twice. That costs about 0.1 s on the office floor, off the main thread, and keeps one source for the badges.

## Dev Agent Record

### File List

- src/core/sprinkler/heads.ts, heads.test.ts (modified)
- src/features/editor/undo-store.ts, editor-store.ts, measure-tool.ts, index.ts (modified)
- src/features/editor/head-place.ts, head-place.test.ts (new)
- src/features/tool-chest/stamp-store.ts, tool-chest-panel.tsx (modified)
- src/features/sprinkler/engine-channel.ts, live-check.ts, live-check.test.ts (new)
- src/features/sprinkler/place-run.ts, sprinkler-panel.tsx, sprinkler-panel.test.tsx (modified)
