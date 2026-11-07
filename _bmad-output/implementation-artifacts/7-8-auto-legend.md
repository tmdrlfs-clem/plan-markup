# Story 7.8: Auto legend

Status: done

## Story

As a drafter,
I want a legend that lists the devices I placed with counts,
so that I do not count symbols by hand.

## Acceptance Criteria

1. **Place (FR38):** with a drawing open, the rail's Legend (TableProperties, no key) arms the tool (HintBar "Legend: click where it goes…", a half-strength ghost under the pointer); a click places a legend centred there, upright on screen, at its natural size for the devices on the page then; title "LEGEND", scope this page; one undo step "Add legend"; then Select has it.
2. **Shows (UX-DR27):** a box (white fill, the markup's colour and width) with a title row ("QTY" on the right), one row per device type (its first placement drawn as the symbol, its label, its count), in group then label order, and a total row; "No devices placed" when there are none. A label two groups share reads "group · label". The layout scales to fit the box (resize to enlarge) and is clipped to it. Markups List and layer 2 label it "LEGEND — 3 devices".
3. **Live:** the rows are computed from the markups whenever they paint (never stored), so counts follow devices added, deleted, undone or retyped, from this user or a synced one.
4. **Edit in Properties:** for one selected legend, Title (committed on Enter or leaving, Esc reverts; empty or over 60 characters refused with a toast saying why) and Counts (This page / Whole document); one undo step "Edit legend".
5. **Behaves like a markup:** select, move, resize, rotate (no vertex handles), copy/paste, group, lock, layers, subject, delete, undo; saved and synced like others (type `legend`, its title and scope in `props`).
6. **A12:** the legend logic is refactored from the prototype's (rows from the placements, sorted by group, symbol / description / QTY columns, total row) into `src/core/markup/legend.ts` with unit tests.
7. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Model** — `legendMarkupSchema` (`points` four corners, `legend {title 1..60, scope page|document}`) in the union; `core/markup/legend.ts` (`legendRows`, `legendScopeMarkups`, `legendTotal`, `legendLabel`, `legendLayout`, `estimateText`, `legendMarkupAt`, `fitSymbol`, `DEFAULT_LEGEND_STYLE`).
- [x] **Task 2: Editor** — viewer tool `legend`; `features/editor/legend-tool.ts` (`placeLegend`, `legendAt`, `ADD_LEGEND`); painter `paintLegend` (rules, texts, symbols painted through a fitted sub-view) + ghost; hit test (box), no vertex handles; Properties `legend` field (`LegendFields`) and `withChange`; Markups List icon; rail button and hint.
- [x] **Task 3: Tests** — `legend.test.ts` (7), `legend-tool.test.ts` (2), shell rail count; e2e `legend.spec.ts` (device tool placed twice, legend placed, renamed, a placement and its undo counted live, after a reload).

## Dev Notes

- Defaults taken (D questions in the report):
  - a new legend counts this page (scope switchable to the whole document in Properties);
  - its box keeps its size: when rows are added the content shrinks to fit (resize to enlarge); no automatic growing (it would write edits whenever another user's devices change);
  - the symbol is the device type's first placement (by creation time), drawn as it is on the page;
  - no font size field (the text is sized to the box); title "LEGEND", "QTY", "Total";
  - its own rail button, no key.
- PDF export (Epic 11) will flatten it like the other markups.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.8], FR38, UX-DR27, A12 / AR26 (prototype `ui/10-render.js` legendData / drawLegendOn)

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 209 files / 2077 tests pass; build ok; check:* pass; e2e legend, revision-stamp, save-tool, properties-panel, workspace-shell, markups-list pass (15).
- Screenshot checked: title/QTY row, the Riser symbol, its count and the total.
- CI green on 0679ccc (unit, guards, Playwright e2e, gitleaks).

### File List

- src/core/schema/markup.ts; src/core/markup/legend.ts (new), legend.test.ts (new), properties.ts, geometry.ts
- src/features/editor/legend-tool.ts (new), legend-tool.test.ts (new), measure-tool.ts, properties.ts, properties-panel.tsx, handles.ts, markups-list-panel.tsx, undo-store.ts
- src/features/viewer/viewer-store.ts; src/features/workspace/tool-rail.tsx, workspace-shell.test.tsx
- e2e/legend.spec.ts (new)
