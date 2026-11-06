# Story 7.5: Faithful `.btx` tool conversion

Status: review

## Story

As a drafter,
I want imported tools to look and behave like they did in Revu,
so that my drawings stay consistent.

## Acceptance Criteria

1. **Native conversion:** an item Revu stores as bare markups (Circle, Square, Line, PolyLine, Polygon, Ink, FreeText without `/AP`, alone or grouped) imports as our own markups (ellipse, rectangle, line/arrow, polyline, polygon, pen, text box/typewriter), each member at its -(X, Y) offset, with the geometry Story 2.1's generated appearances draw (centre line inset by `/RD`, else half the border width), stroke `/C`, fill `/IC`, width `/BS /W`, dash `/BS /D`, opacity `/CA`. They stay editable and are placed by Story 7.3 (A9).
2. **Images where Revu's drawing is the reference:** stamps, image squares, members with their own `/AP` and anything we cannot express import as the item's image (Story 7.4); a count measurement's image is typed as a device of the set (group = set name, label = item name, numbered when repeated), so placing it counts.
3. **Founder decisions (2026-10-20):** imported ink drops Revu pressure and draws at a uniform width (`/BS /W`, user-changeable); FreeText asking for Calibri renders with the bundled Carlito (SIL OFL 1.1, `public/fonts/carlito`, with `OFL.txt`); without Revu reference PNGs the fidelity check is the founder's review (contact sheet written locally to `fixtures/private/btx/out/`).
4. **Coverage:** all 138 founder items import or are reported (sprinkler 65/66, the 2 "Snapshot" items without an appearance are reported, as Story 2.1 found): 23 convert to markups, the rest are images; failures appear in the import report with reasons.
5. **Synthetic fixtures with unit tests** for each supported kind (Circle, fill-only dot, Square, image square, Line/arrow both ways, PolyLine, Polygon, Ink, FreeText Calibri/plain, group offsets, count, stamp, `/AP` member, unknown kind, bad geometry) and the synthetic .btx (stamp image + 4 converted).
6. `npm run typecheck`, `lint`, `test`, `build`, `check:*` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Model** — `markupStyleSchema` gains optional `dash` (pt, ≤ 8 values) and `font` (`"carlito"`); painter strokes dashes in page units; text draws in Carlito with the app's face behind it.
- [x] **Task 2: Converter** — `core/btx/convert.ts` (`convertItem`, `isCountItem`, `hexColor`, `IMPORT_PAGE`, `FILL_ONLY_WIDTH`); `core/btx/import.ts` `itemMarkups` (falls back to an image when the markups would not fit a tool: 200 markups / 90 % of 256 KB).
- [x] **Task 3: Pipeline** — worker reply items are `kind: "markups" | "image"` (+ `count`); only PNGs are transferred; `import-btx.ts` saves converted items without an image and types counts as devices (`deviceLabels`).
- [x] **Task 4: Font** — `features/editor/fonts.ts` (`loadCarlito` via FontFace with Google Fonts' latin / latin-ext ranges, a markup repaint once loaded; `fontFamilyOf`; `loadMarkupFonts` for tool previews).
- [x] **Task 5: Tests** — `convert.test.ts` (11 + private 1), `fonts.test.ts` (2), import/worker/main tests updated (+1 main); e2e: synthetic arrow placed is an Arrow; private sprinkler import writes the contact sheet.

## Dev Notes

- Defaults taken (D questions in the report):
  - a fill-only shape (Revu's dot) is stroked with a 0.01 pt hairline in its fill colour (our markups always stroke);
  - `FillOpacity` applies only when the shape has no stroke (our opacity is the whole markup's);
  - a FreeText with no border becomes a typewriter (no box, no padding); `/Q` alignment and `/DS` margin are not kept (left aligned, our 3 pt padding);
  - a line with an arrow head at one end becomes an Arrow; both ends or other endings: a plain line;
  - count items stay images typed as devices (group = set name) rather than our count measurement.
- Exported PDFs (Epic 11) do not yet carry `dash`/`font`; the export engine already supports dashes and will map them.
- The text editor overlay still types in the app's face; the committed text draws in Carlito.
- Clean-room: behaviour from official Revu help and the founder's own files (Story 2.1 spike); no Revu code or assets.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.5], FR42, NFR10, A9, docs/spikes/2-1-btx-report.md ("Recommended FR42 import design", "Founder decisions")

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5

### Completion Notes List

- Local: typecheck, lint clean; vitest 203 files / 2055 tests pass; build ok; check:* pass; e2e import-btx (2 incl. private), save-tool (3), tool-chest pass.
- Private sets: 23 of 138 items convert (sprinkler 14, my-tools 9); fire-alarm-tools is stamps and image squares only.

### File List

- src/core/btx/convert.ts (new), convert.test.ts (new), import.ts, import.test.ts
- src/core/schema/markup.ts
- src/workers/btx.worker.ts, btx.worker.test.ts
- src/features/editor/fonts.ts (new), fonts.test.ts (new), measure-tool.ts, properties.ts, index.ts
- src/features/tool-chest/import-btx.ts, import-btx.test.ts, tool-preview.tsx, tool-tiles.test.tsx, add-tool-dialog.test.tsx
- public/fonts/carlito/ (new: 2 woff2 + OFL.txt)
- e2e/import-btx.spec.ts
