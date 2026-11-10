# Story 9.11: Zone report and rule-break markers

Status: done

## Story

As a sprinkler designer,
I want a per-zone report and markers where rules break,
so that I can fix problems quickly and explain the layout.

## Acceptance Criteria

1. Given a zone with heads, when the oracle result is available, the ZoneReport shows:
   - hazard, ruleset version, head count and area per head;
   - max spacing, and min and max wall distance;
   - the list of rule breaks.

   It never blocks any action (FR77, UX-DR24).
2. Rule breaks are pinned on the canvas with short labels ("Spacing 4.8 m > 4.6 m"):
   - errors as danger ✕ markers;
   - area warnings as ⚠.

   Clicking a marker or a row zooms to the break and selects the other (UX-DR26).
3. Each zone's status in the ZoneList shows ✓ / ⚠ n / ✕ n / infeasible, with icons and text. Changes are announced in the polite live region.

## Tasks / Subtasks

- [x] `core/sprinkler/report.ts` (framework-free):
  - `metres` and `flagLabel`: a short label per flag code, from the flag's value and limit.
  - `zoneStatus` returns infeasible / error n / warning n / pass, or null when there is no report.
  - `reportRows` gives the figures against their limits, each with `ok`.
  - `ruleBreaks` lists errors first, keeping each break's flag index (the marker id).
- [x] `features/sprinkler/check-store.ts`:
  - `zoneCheckStore`, moved here from live-check, now with `focus: { zoneId, index }`;
  - `setChecks` repaints the canvas;
  - it imports nothing from the editor, so the editor can paint from it;
  - live-check drops the focus when the focused zone gets a new report (its breaks are renumbered) or loses its heads.
- [x] `features/editor/rule-markers.ts`:
  - `paintRuleMarkers`, over everything in the static layer, at a fixed screen size:
    - an error is a red circle with a white ✕;
    - a warning is an amber triangle with a white "!";
    - each has a haloed label to its right;
    - the focused marker gets a selection ring.
  - `ruleMarkerAt` hits a marker by its symbol or its label (the one on top first).
  - `revealFlag` zooms to ±3 m around the break, selects its zone and sets the focus.
- [x] Select tool:
  - a press on a marker shows its break, and does nothing else;
  - the cursor over a marker is `pointer`.
- [x] Panel:
  - `StatusBadge`: ✓, ⚠ n, ✕ n or "Infeasible" (an engine error card, until a check of the zone's heads exists), with the first messages in its tooltip;
  - `ZoneReport` for the selected zone:
    - the figure rows (in red when over a limit);
    - "No rule breaks", or a list of buttons, each a label plus its message, with `aria-current` on the focused one, scrolled into view when its marker is clicked;
  - `StatusAnnouncer`: a polite live region that names the zones whose status changed once it has held for 600 ms. What was showing when the panel opened is not announced.
- [x] Tests:
  - `report.test.ts` (3);
  - `rule-markers.test.ts` (4): pins and order, hits and the focus ring, reveal, a Select click on a marker;
  - panel +2: report, break row click, announcement; Infeasible.

## Dev Notes

- **D1, which breaks are pinned.**
  - Every flag that has a place is pinned. That includes UNCOVERED, AREA_LOCAL and WALL_DIST runs, not only spacing.
  - A flag with no place (RULES_UNVERIFIED) is listed in the report only.
  - Warnings are drawn under errors.
- **D2, markers are always on while a zone has a report.** There is no separate toggle. The coverage toggle hides only the coverage.
- **D3, a new report for a zone clears its focus.** The flag indexes are not stable from one check to the next, so a kept focus could point at a different break.
- **D4, Infeasible.** It comes from the run's error cards (NO_ADMISSIBLE_REGION, UNCOVERABLE_PIECE, INVALID_ZONE). A zone that still gets a live report (it has heads) shows that report instead.
- **D5, announcements wait 600 ms** after a status stops changing, so a drag does not read out every step.
- **D6, colours** are fixed for the white sheet in every theme: error `#c8243a` (the coverage gap colour) and warning `#a15c00`.

## Dev Agent Record

### File List

- src/core/sprinkler/report.ts, report.test.ts (new)
- src/features/sprinkler/check-store.ts (new); live-check.ts, sprinkler-panel.tsx, sprinkler-panel.test.tsx (modified)
- src/features/editor/rule-markers.ts, rule-markers.test.ts (new); measure-tool.ts, select-tool.ts, index.ts (modified)
