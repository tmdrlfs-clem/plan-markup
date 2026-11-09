# Story 9.8: Place heads from the panel

Status: review

## Story

As a sprinkler designer,
I want to click Place heads and watch zones fill,
so that I get a full layout in seconds without freezing the app.

## Acceptance Criteria

1. Given zones on a calibrated page, when I click Place heads (the selected zones, or all of them when none is selected), `engine.worker` places them zone by zone. There is one progress tick per zone, heads appear zone by zone, and the canvas stays usable (FR73, UX-DR24).
2. Heads are device markups, so the legend and the Markups List count them. They are created through commands, and the whole run is one undo step (UX-DR35).
3. A migration creates `zone_layouts` (rule_figure_version, inputs, result, report). Each run stores the ruleset version it used (A7).
4. An infeasible zone shows an error card with its location, the reason and a suggestion; the other zones still complete.
5. A `sprinkler.placed` activity event is recorded, without drawing content.

## Tasks / Subtasks

- [x] `core/sprinkler/heads.ts` converts between the page and the engine:
  - page points ↔ mm (UserUnit and calibration factors);
  - `engineZoneOf`: outline, hole kinds from the hole tags, zone options, and locked heads;
  - `headMarkup`: an ellipse device markup (`Sprinkler / Sprinkler head`), with a fixed 300 mm real diameter and a `head: { zoneId, kind }` link to its zone.
- [x] Markup schema: an optional `head` base field (`row | gapFill | locked | manual`).
- [x] Engine protocol: a place request now streams `progress` + `zoneResult` per zone, then a `zoneReport` per zone (the oracle checks against every neighbour), then `done`. Heads therefore show before the oracle pass.
- [x] `features/sprinkler/place-run.ts`:
  - collects the scope (selected zones, else all of the page's);
  - an unmapped use gets an error card, and that zone is skipped;
  - manual and locked heads are passed as fixed inputs;
  - the zone's earlier engine heads are removed up front;
  - each zone's heads are applied as they arrive;
  - at the end, one undo step `compound[remove old, add new]` is recorded (`recordAppliedOp`);
  - Cancel stops at the next zone boundary, and the heads placed so far stay;
  - an engine error gives an ENGINE card for each unplaced zone;
  - the engine channel and the sinks (save, activity) are injectable.
- [x] `undo-store.recordAppliedOp`: records an op that is already applied as one step (undo inverts it; redo applies it again).
- [x] Migration `20261113090000_zone_layouts.sql`:
  - one row per zone per run (no update or delete grants);
  - RLS: owner/edit access may insert, and anyone who can read the markup set may read;
  - the time comes from the server, plus a rate limit;
  - activity constraints allow `sprinkler.placed` (`all_zones` / `selected_zones`).
- [x] `saveZoneLayouts` server action (Zod, ≤ 900 kB of JSON per field) and `lib/db/zone-layouts.ts`.
- [x] Panel:
  - Place heads button (shows "(n selected)" when zones are selected);
  - progress bar plus a polite status line, and Cancel;
  - error cards (zone, reason, suggestion, Show in drawing zooms to the engine's `where`, else the zone);
  - the "Place heads" checklist item is ticked once the page's zones have heads.
- [x] Tests:
  - `heads.test.ts` (3);
  - `place-run.test.ts` (7, the real engine in-process): one undo step / redo, selected-only, re-run that keeps a manual head, an infeasible zone plus an unmapped use, cancel, engine failure, no-op cases;
  - panel tests (3);
  - pgTAP `zone_layouts_rls.test.sql` (13);
  - the worker protocol tests updated.

## Dev Notes

- **D1, head symbol.** A head is an ellipse 300 mm across in real units, so it scales with the drawing. It is red with a light fill and is a device (`Sprinkler head`). Symbol choice and pipe-fitting icons come later.
- **D2, a re-run replaces the engine's heads.**
  - Heads of kind `manual` or `locked` stay and go to the placer as fixed inputs.
  - Heads the placer made (`row` / `gapFill`) are removed and placed again.
  - Marking a dragged head as `manual` is not built yet; a move tool for heads comes with 9.10.
- **D3, one undo step even though heads stream in.** Old heads are removed at the start, and each zone's heads are applied as they arrive. When the run ends, the whole change is recorded as one compound step. A cancelled run keeps what it placed, and that is also one step.
- **D4, saving and activity are fire and forget.**
  - `zone_layouts` is saved only once the markup set exists on the server (it has a drawing id).
  - A save failure never fails the run.
  - The activity event carries counts only: `pageCount 1`, `markupCount` = heads added.
- **D5, `zone_layouts.zone_id` has no foreign key.** Zones are markups (rows in `markups`), and a run is history. It must survive the zone being deleted or redrawn.
- **D6, out of scope here.**
  - A zone-options UI (pattern, tile grid, preferences): the engine reads `zone.options` already, but there is no editor yet.
  - Open edges shared between zones are not modelled; each zone is walled all round.
  - The built-in NZS4541_V1 rule set is used (the company rule set comes later).

## Dev Agent Record

### File List

- supabase/migrations/20261113090000_zone_layouts.sql, supabase/tests/zone_layouts_rls.test.sql (new)
- supabase/schema.sql, src/lib/db/types.gen.ts (regenerated)
- src/core/schema/markup.ts, src/core/activity/activity-event.ts, src/core/sprinkler/zone.ts (modified)
- src/core/sprinkler/heads.ts, heads.test.ts, zone-layout.ts (new)
- src/core/sprinkler/engine/protocol.ts, src/workers/engine.worker.ts, engine.worker.test.ts (modified)
- src/features/editor/undo-store.ts, index.ts (modified)
- src/features/sprinkler/place-run.ts, place-run.test.ts, run-sinks.ts (new); actions.ts, sprinkler-panel.tsx, sprinkler-panel.test.tsx (modified)
- src/lib/db/zone-layouts.ts (new)
