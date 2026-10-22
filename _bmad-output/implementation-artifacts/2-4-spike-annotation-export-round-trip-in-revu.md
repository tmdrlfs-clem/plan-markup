# Story 2.4: Spike — annotation export round-trip in Revu

Status: done

## Story

As the founder,
I want exported markups to open and stay editable in Revu and Acrobat,
so that FR60 and NFR41 are achievable with `@cantoo/pdf-lib`.

## Acceptance Criteria

1. **Given** a synthetic sample PDF (committed generator, no client content: an A3 page with a simple vector floor plan — walls, a ceiling grid, a few rooms) and one markup of each MVP type — line, arrow, polyline, polygon, rectangle, ellipse, arc, cloud, cloud+ (cloud with leader + text), callout, text box, typewriter text, note, highlight, pen (ink), underline/strikethrough on a text run, stamp (vector), image stamp, dimension, hyperlink, flag, calibrated length, polylength, area, perimeter, count, angle, radius, diameter, dynamic-fill area (as a vector polygon, A11), white-out, device stamp (a sprinkler symbol carrying device metadata), a group of three markups, and markups on two layers (OCG) — **when** a prototype in `src/core/export/` writes them, **then** it produces three files: (a) native annotations with appearance streams, (b) appearance-only annotations (no editable semantics, e.g. Stamp/Square with `/AP` only), (c) flattened page content.
2. All three files open without errors or repair prompts in Revu 21, Acrobat (Reader is fine) and Chrome's PDF viewer — the Chrome part is checked by the dev agent (headed Chromium screenshot), Revu and Acrobat by the founder with the checklist.
3. `docs/export-mapping.md` holds the manual checklist (per type × viewer: visible / looks right / editable (move, resize, change colour) / keeps measurement value and unit / keeps subject & author / layer visible in the layer panel / group behaves as one) with columns ready for the founder, and the A5 table (type → native / appearance-only / forced flatten) filled in from the results.
4. The flattened export of the same set matches the native export rendered with its appearance streams (pdf.js, annotations enabled) within a pixel-diff threshold, checked by a unit or harness test.
5. Unit tests cover the writer for each type on the synthetic page (dictionary keys, `/AP` present and valid, `/Rect` contains the geometry, `/Measure` present for calibrated types, OCG wiring, group linkage). `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; CI green.

## Tasks / Subtasks

- [x] **Task 1: Sample drawing + markup set**: `scripts/spike-export/make-sample.mjs` → `fixtures/pdf/export-sample.pdf` (committed, small). A typed in-memory markup set in PDF user space (`src/core/export/sample-set.ts`) with a calibration (e.g. 1:100, mm) so measurements have values.
- [x] **Task 2: Native annotation writer** (`src/core/export/annotations.ts`, framework-free, `@cantoo/pdf-lib` 2.11.1 low-level `context` API): map each type to the standard PDF subtype — Line (`/LE` arrow endings, `/IT /LineDimension` for dimensions with `/LL`/`/LLE`), PolyLine, Polygon (`/IT /PolygonCloud` + `/BE /S /C` for clouds), Square, Circle, Ink, FreeText (`/IT /FreeTextCallout` with `/CL` for callouts and cloud+ leader, `/FreeTextTypeWriter` for typewriter), Text (note), Highlight/Underline/StrikeOut (`/QuadPoints`), Stamp (vector `/AP`; image stamp via image XObject in `/AP`), Link (`/URI`), flag as a Stamp. Always write `/AP /N` ourselves (viewers differ in regenerating appearances), plus `/Subj`, `/T` (author), `/M`, `/CreationDate`, `/NM` (stable id), `/C`, `/IC`, `/CA`, `/BS`.
- [x] **Task 3: Measurements**: calibrated types carry an ISO 32000 `/Measure` dictionary (`/Subtype /RL`, `/R` ratio text, `/X`/`/D`/`/A` number formats) and `/IT` (`/LineDimension`, `/PolyLineDimension`, `/PolygonDimension`), `/Contents` with the value text. Angle/radius/diameter/count have no standard intent — choose the closest standard form and record it. For Revu interoperability you may **observe** how Revu itself encodes measurements by decoding the founder's `.btx` measurement items with the Story 2.1 parser (structure only, e.g. which keys Revu uses for counts); never copy client content, and record any Revu-specific key you add and why. Produce variant files if two encodings compete (e.g. standard-only vs standard + Revu keys) so the founder's check decides.
- [x] **Task 4: White-out, dynamic fill, device stamp, groups, layers**: white-out = Square with white fill (native file) — note that it is only a visual cover (true removal deferred); dynamic fill = Polygon with `/Measure` area; device stamp = Stamp with our metadata in a private key prefixed `/PM_` (document it); groups via `/IRT` + `/RT /Group` (the form Revu and Acrobat use); layers via `/OC` → OCG in the catalog `/OCProperties` (`/OCGs`, `/D /Order`, `/ON`).
- [x] **Task 5: Appearance-only + flatten writers**: (b) same geometry as annotations with only `/AP` and no type semantics; (c) flatten = draw each annotation's appearance form XObject into the page content stream at its `/Rect` (with the `/Matrix`/`/BBox` mapping per ISO 32000 12.5.5), remove the annotations, honour OCG visibility (hidden layers not flattened) — this is the prototype of FR58/FR61.
- [x] **Task 6: Harness**: `npm run spike:export` writes `fixtures/private/export/{native,appearance-only,flattened}.pdf` (+ variant files) — synthetic content, but kept out of git so iterations do not churn the repo; prints the paths. It also renders each file with pdf.js (Node, `@napi-rs/canvas`, annotations enabled) to PNGs and diffs flattened vs native (AC 4, threshold constant documented), and opens each file in headed Chromium (Playwright) for a screenshot of Chrome's PDF viewer — look at the screenshots yourself and record the Chrome column of the checklist.
- [x] **Task 7: Checklist + A5 table**: write `docs/export-mapping.md`: how to run, file list, the checklist table (rows = types and variants, columns = Revu / Acrobat × visible / editable / measurement kept / subject+author / layer / group), Chrome column filled, Revu and Acrobat columns left `?` for the founder, and a provisional A5 table with the reasoning; after the founder reports results the table is finalised (a follow-up commit, not this agent's job).
- [x] **Task 8: Tests** (AC 5) co-located, node env.

## Dev Notes

- Keep code: `src/core/export/*` becomes Epic 8's export engine (production quality, framework-free, runs in `export.worker` later). Throwaway: `scripts/spike-export/*`.
- Reuse Story 2.1 pieces where they fit (`src/core/btx/appearance.ts` builds `/AP` forms for Square/Circle/Line/PolyLine/Ink/FreeText; `to-pdf.ts` shows the low-level pdf-lib object API) — extract shared helpers into `src/core/pdf/` rather than importing `btx` from `export`.
- pdf.js 6 in Node: `pdfjs-dist/legacy/build/pdf.mjs`, `isEvalSupported: false`, `wasmUrl` set (Story 2.1 finding). `@napi-rs/canvas` 1.0.11 and `pixelmatch` 8.0.0 are already pinned devDependencies.
- Clean-room: only public PDF specification (ISO 32000-1/-2) and observation of files the founder owns; no Revu binaries, no copying from Revu documentation text.
- Facts carried: code/comments/docs/commits in English; `src/core` framework-free (lint); tests co-located; exact pins; commit per step with author seunggil; push so CI verifies.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- [Source: _bmad-output/planning-artifacts/prd.md] FR36, FR58–61, NFR41, A5, A11
- [Source: _bmad-output/planning-artifacts/architecture.md] lines 62, 67, 198, 227, 340, 391
- [Source: docs/feature-inventory.md] §3 markup tools, §4 measurement
- [Source: docs/spikes/2-1-btx-report.md], [Source: src/core/btx/appearance.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 5.5 (claude-opus-5-5)

### Debug Log References

- Revu key survey (structure only, Story 2.1 parser on `fixtures/private/btx/*.btx`): only count
  measurements exist in the founder's tool chests: `Polygon` + `/IT /PolygonCount`, `/BBMeasure`
  (`/Type /Measure /Subtype /RL /R /X /D /A /T /V /TargetUnitConversion`), `/NumCounts`,
  `/MeasurementTypes 128`, `/CountStyle /Checkmark`, `/Version 1`; `/Vertices` held 8-12 numbers
  for `/NumCounts 1`. No client content copied.
- `npm run spike:export`: native 38 KB / native-revu 41 KB / appearance-only 31 KB / flattened
  39.5 KB, 39 annotations each (35 cells; cloud+ = 2, group = 3, layer test = 2); flatten
  39 drawn / 0 dropped / 1 kept (link). Flattened vs native: 0 px differ (threshold 0.5 % of ink);
  appearance-only vs native: 0 px.
- Chrome PDF viewer (Playwright 1.64.1 bundled Chromium, headed): all four files open, all 35
  cells visible and matching the pdf.js renders; no page errors.
- Local gates: typecheck, lint, 1001 tests (92 files), build, check:pinned all pass.
- CI run 39708496856 (commit 59705a8): success (checks incl. the export harness diff test on
  Linux, e2e, gitleaks); Database run 39708496971: success.

### Completion Notes List

- 2026-10-22: founder opened all four files in Revu 21 and Acrobat and reported no problems (no per-cell results). A5 table accepted; per-cell checklist re-run deferred to Epic 8 (8.1/8.2). Closed without a separate code review (spike; `src/core/export` is reviewed when Epic 8 builds on it).

- `src/core/pdf/` (new, shared): content-stream helpers moved out of `src/core/btx/appearance.ts`
  (re-exported there, btx tests unchanged), Helvetica AFM widths, a plain PDF value model with
  pdf-lib conversion, and a form XObject writer (Flate content, shared fonts/images).
- `src/core/export/` (keep, Epic 8 engine): `model.ts` (markup model, 33 types), `measure.ts`
  (values + ISO 32000 `/Measure`), `appearance.ts` (our `/AP /N` for every type: clouds, arcs,
  callouts, dimensions with leaders, captions, icons), `annotations.ts` (native and
  appearance-only writers, OCG layers, `/IRT` + `/RT /Group` groups, `/PM_Device`, optional Revu
  keys), `flatten.ts` (ISO 32000-1 12.5.5 matrix, OCG visibility incl. OCMD, hidden flags, links
  kept, layered content wrapped in `/OC BDC`), `export.ts` (entry point), `sample-set.ts`
  (synthetic layout + markup set).
- `scripts/spike-export/` (throwaway): sample generator (`--check` mode), harness, page diff.
- `docs/export-mapping.md`: how to run, files, encoding per type, private/Revu keys, checklist
  (Chrome filled, Revu/Acrobat `?`), provisional A5 table, known gaps.
- Decisions: arc = PolyLine through arc points; count = Polygon of the counted points (Revu form in
  the variant); angle = 3-vertex PolyLine; radius/diameter = Circle + `/Measure` + value in
  `/Contents`; white-out provisional A5 = forced flatten (visual cover only); FreeText `/C` is the
  background colour, border colour in `/DA` (`RG`).
- Not done here (founder): Revu 21 and Acrobat columns of the checklist; finalising the A5 table.

### File List

- `src/core/pdf/content.ts` (new)
- `src/core/pdf/helvetica.ts` (new)
- `src/core/pdf/value.ts` (new)
- `src/core/pdf/form.ts` (new)
- `src/core/pdf/pdf.test.ts` (new)
- `src/core/btx/appearance.ts` (modified: helpers moved to `src/core/pdf/content.ts`)
- `src/core/export/model.ts` (new)
- `src/core/export/measure.ts` (new)
- `src/core/export/appearance.ts` (new)
- `src/core/export/annotations.ts` (new)
- `src/core/export/flatten.ts` (new)
- `src/core/export/export.ts` (new)
- `src/core/export/sample-set.ts` (new)
- `src/core/export/annotations.test.ts` (new)
- `src/core/export/flatten.test.ts` (new)
- `src/core/export/measure.test.ts` (new)
- `scripts/spike-export/make-sample.mjs` (new)
- `scripts/spike-export/run.mjs` (new)
- `scripts/spike-export/diff.mjs` (new)
- `scripts/spike-export/harness.test.mjs` (new)
- `fixtures/pdf/export-sample.pdf` (new, generated)
- `docs/export-mapping.md` (new)
- `package.json` (modified: `spike:export`, `spike:export:sample`)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log

- 2026-10-22: Story 2.4 implemented: shared `src/core/pdf` helpers, export engine prototype
  (native / appearance-only / flatten), synthetic A3 sample, harness with pdf.js diff (0 px) and
  Chrome screenshots, `docs/export-mapping.md` with checklist and provisional A5 table. Status →
  review (founder's Revu/Acrobat check pending).
