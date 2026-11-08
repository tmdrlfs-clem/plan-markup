# Story 9.2: Create zones in the 4541 panel

Status: review

## Story

As a sprinkler designer,
I want to fill rooms or draw polygons as zones,
so that the engine knows where to place heads.

## Acceptance Criteria

1. **Uncalibrated page (UX-DR24):** the 4541 panel (`Alt+4`) shows only "Calibrate this page first" with a Calibrate button. The button opens the Calibrate dialog.
2. **Empty state:** on a calibrated page the panel shows:
   - the checklist Zones ▢ Uses ▢ Place heads ▢;
   - Fill zone (dynamic fill, `J`) and Polygon zone.
3. **New zone (FR70):** a new zone appears in the ZoneList. Its row shows:
   - its name ("Zone n");
   - its default use (the company default once companies exist, else Office → ELH);
   - a hazard chip and its area.

   The checklist ticks itself.
4. **Holes:** holes inside a zone are tagged `column` or `shaft` ("Shaft / void"). The default comes from the hole's size (under 1 m²: column). The user changes it in the panel, and the change can be undone.
5. **Storage:** a migration creates `zones` with drawing_id, page_id, polygon in PDF points, holes, hole tags, use and options. RLS comes from effective access, and zones sync through the same op path as markups.
6. **Selection:** zone selection syncs between the list and the canvas. Zones have a muted violet outline.
7. **Tip (UX-DR16):** the first use of the 4541 panel shows one dismissible inline tip.

## Tasks / Subtasks

- [x] Schema: markup type `zone` with `points`, optional `holes` and `zone` {name, use, holeTags?, options?} (`HOLE_TAGS`, `ZONE_USE_PATTERN` = the rules' use name).
- [x] Core `src/core/sprinkler/zone.ts`:
  - `newZone`, `nextZoneName`, `defaultUse` and `defaultHoleTag` (`COLUMN_MAX_M2` = 1);
  - `holeTagOf`, `withHoleTag`, `zoneAreaM2`, `zoneHazard` and `zoneChecklist`;
  - tests (5).
- [x] Zone mode `src/features/editor/zone-draw.ts`: `armZoneDraw("fill" | "area")` arms the tool. What the tool finishes becomes a zone ("Add zone", selected). Choosing another tool ends zone mode.
- [x] Canvas:
  - the fill is painted under the markups (12 %);
  - the outline, the name at the centroid and the selection box are painted on top;
  - hit test: inside, less the holes;
  - another markup at the same point wins over a zone (`MarkupIndex.hit`).
- [x] Exclusions: export and print (`exportMarkup` → null, run-export filters) and the Markups List. Measurements already list only measures.
- [x] Panel `src/features/sprinkler/sprinkler-panel.tsx` with the calibrate-first state, `FirstUseTip` `sprinkler-zones`, checklist, Fill zone / Polygon zone (aria-pressed), ZoneList rows (name, use, hazard chip, m²) and hole tag selects. Tests (4).
- [x] Migration `20261112090000_zones_view.sql`: the `public.zones` view (security_invoker, security_barrier) over markups of type zone, not deleted. pgTAP `zones_view.test.sql` (10).
- [x] `types.gen.ts`, `schema.sql` regenerated.
- [x] e2e `sprinkler-zones.spec.ts`: calibrate first → 1:100 → Polygon zone around the snap rectangle covers:
  - the row (Zone 1, Office, ELH, 37.x m²) and the checklist;
  - undo / redo and the shared selection;
  - the Markups List staying empty, and the tip.

## Dev Notes

### Deviation (D1): `zones` is a view, not a table

AC 5 asks for a `zones` table synced "through the same op path as markups". A separate table would need a second op path, a second LWW and second undo and offline queues. Instead:

- A zone *is* a markup of type `zone`, written by `apply_markup_ops`.
- `public.zones` is a `security_invoker` view that names its parts, so RLS is the markups' effective-access RLS.
- The engine (9.4+) and reports read the view.
- Placement results (`zone_layouts`) will be a real table with an FK to `markups.id`.

### Other decisions

- **Defaults:**
  - Name "Zone n" (one more than the highest "Zone k").
  - Use = `USE_HAZARD_V1.defaultUse` (Office). The company mapping arrives with companies (FR72, M3).
  - Holes under 1 m² are columns, others shafts. Without a calibration a hole is a shaft, but the panel only creates zones on calibrated pages.
- **Zone mode:**
  - The panel's buttons arm the existing Dynamic fill and Area tools. The tool rail's disabled "Sprinkler zone" button stays as is.
  - `J` alone arms a normal Dynamic fill, unless zone mode is already on.
- **The list:**
  - The ZoneList shows the current page's zones.
  - Use editing comes in 9.3. Head count and status come with 9.4+.

## Dev Agent Record

### File List

- src/core/schema/markup.ts; src/core/sprinkler/zone.ts, zone.test.ts (new)
- src/core/export/from-app.ts, src/core/markup/geometry.ts, markup-index.ts, properties.ts
- src/features/editor/zone-draw.ts (new), measure-tool.ts, markups-list-panel.tsx, index.ts; src/features/export/run-export.ts
- src/features/sprinkler/sprinkler-panel.tsx, sprinkler-panel.test.tsx, index.ts (new); src/features/workspace/workspace-shell.tsx
- supabase/migrations/20261112090000_zones_view.sql, supabase/tests/zones_view.test.sql (new); supabase/schema.sql; src/lib/db/types.gen.ts
- e2e/sprinkler-zones.spec.ts (new)
