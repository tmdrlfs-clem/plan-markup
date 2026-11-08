# Story 9.3: Assign a use and hazard class

Status: done

## Story

As a sprinkler designer,
I want to pick each zone's use and see its hazard and figures,
so that the right rules apply.

## Acceptance Criteria

1. **Use dropdown (FR71):** each ZoneList row has a use dropdown. Changing the use updates the hazard chip at once, and the change can be undone.
2. **Figures:** the selected zone shows the figures from the ruleset, so I can check them against the standard:
   - its hazard class;
   - Amax, Smax, Smin, Wmax and Wmin, with their units;
   - the ruleset version ("NZS 4541 v1").
3. **Mapping (FR72):** the company's mapping applies when present, else the platform default (`use_hazard_map`, company_id null), else the built-in JSON. The panel names the source, its version and whether it is a draft.
4. **Unmapped use:** a use the mapping lacks shows "?". The figures say to choose a use, and the checklist's Uses stays unticked.

## Tasks / Subtasks

- [x] Core `src/core/sprinkler/use-map.ts`, with tests (3):
  - `resolveUseMap(rows, companyId)` picks company rows, then platform rows, then the built-in map. Rows that don't parse fall through.
  - `useOptions`, `figuresOf` and `figureRows`.
- [x] `src/lib/db/rules.ts` `readUseHazardRows` (RLS read, ≤ 1000 rows).
- [x] Server action `getUseHazardMap`. Tests (2).
- [x] `use-map-store.ts`: the built-in map until the server's is read, once per session (a failure keeps the built-in one). New zones take its default use (`zone-draw` → `newZone(…, map)`).
- [x] Panel:
  - each row holds the zone button (name, area), a use `Select` ("Use (hazard)", or "(not mapped)") and the hazard chip (warning style for "?");
  - `ZoneFiguresPanel` for the selected zone shows the figures and the mapping source;
  - "Change use" is undoable.
  - Tests (6, two of them new).
- [x] e2e `sprinkler-zones.spec.ts` extended:
  - the figures come from the platform mapping read from the DB;
  - Office → Storage gives OH2 with 12 m² and 4 m;
  - undo.

## Dev Notes

- No company exists until M3 (FR72 admin), so `getUseHazardMap` resolves with company `null`, which means the platform rows. The resolver already handles company rows, and only the call site changes when companies arrive.
- The rule figures come from the built-in `NZS4541_V1`. `check:rules` keeps it equal to the `rule_figures` seed. Per-company rulesets are not in scope.
- A zone stores its use, not its hazard. The hazard always follows the current mapping, so a mapping change re-classes existing zones. Layouts (9.5+) will record the ruleset and mapping versions they used.
- No migration: `use_hazard_map` and its RLS come from 9.1.

## Dev Agent Record

### File List

- src/core/sprinkler/use-map.ts, use-map.test.ts (new)
- src/lib/db/rules.ts (new)
- src/features/sprinkler/actions.ts, actions.test.ts, use-map-store.ts (new); sprinkler-panel.tsx, sprinkler-panel.test.tsx
- src/features/editor/zone-draw.ts; src/features/workspace/workspace-shell.test.tsx
- e2e/sprinkler-zones.spec.ts
