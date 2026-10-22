# Story 2.4: Spike — annotation export round-trip in Revu

Status: in-progress

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

- [ ] **Task 1: Sample drawing + markup set**: `scripts/spike-export/make-sample.mjs` → `fixtures/pdf/export-sample.pdf` (committed, small). A typed in-memory markup set in PDF user space (`src/core/export/sample-set.ts`) with a calibration (e.g. 1:100, mm) so measurements have values.
- [ ] **Task 2: Native annotation writer** (`src/core/export/annotations.ts`, framework-free, `@cantoo/pdf-lib` 2.11.1 low-level `context` API): map each type to the standard PDF subtype — Line (`/LE` arrow endings, `/IT /LineDimension` for dimensions with `/LL`/`/LLE`), PolyLine, Polygon (`/IT /PolygonCloud` + `/BE /S /C` for clouds), Square, Circle, Ink, FreeText (`/IT /FreeTextCallout` with `/CL` for callouts and cloud+ leader, `/FreeTextTypeWriter` for typewriter), Text (note), Highlight/Underline/StrikeOut (`/QuadPoints`), Stamp (vector `/AP`; image stamp via image XObject in `/AP`), Link (`/URI`), flag as a Stamp. Always write `/AP /N` ourselves (viewers differ in regenerating appearances), plus `/Subj`, `/T` (author), `/M`, `/CreationDate`, `/NM` (stable id), `/C`, `/IC`, `/CA`, `/BS`.
- [ ] **Task 3: Measurements**: calibrated types carry an ISO 32000 `/Measure` dictionary (`/Subtype /RL`, `/R` ratio text, `/X`/`/D`/`/A` number formats) and `/IT` (`/LineDimension`, `/PolyLineDimension`, `/PolygonDimension`), `/Contents` with the value text. Angle/radius/diameter/count have no standard intent — choose the closest standard form and record it. For Revu interoperability you may **observe** how Revu itself encodes measurements by decoding the founder's `.btx` measurement items with the Story 2.1 parser (structure only, e.g. which keys Revu uses for counts); never copy client content, and record any Revu-specific key you add and why. Produce variant files if two encodings compete (e.g. standard-only vs standard + Revu keys) so the founder's check decides.
- [ ] **Task 4: White-out, dynamic fill, device stamp, groups, layers**: white-out = Square with white fill (native file) — note that it is only a visual cover (true removal deferred); dynamic fill = Polygon with `/Measure` area; device stamp = Stamp with our metadata in a private key prefixed `/PM_` (document it); groups via `/IRT` + `/RT /Group` (the form Revu and Acrobat use); layers via `/OC` → OCG in the catalog `/OCProperties` (`/OCGs`, `/D /Order`, `/ON`).
- [ ] **Task 5: Appearance-only + flatten writers**: (b) same geometry as annotations with only `/AP` and no type semantics; (c) flatten = draw each annotation's appearance form XObject into the page content stream at its `/Rect` (with the `/Matrix`/`/BBox` mapping per ISO 32000 12.5.5), remove the annotations, honour OCG visibility (hidden layers not flattened) — this is the prototype of FR58/FR61.
- [ ] **Task 6: Harness**: `npm run spike:export` writes `fixtures/private/export/{native,appearance-only,flattened}.pdf` (+ variant files) — synthetic content, but kept out of git so iterations do not churn the repo; prints the paths. It also renders each file with pdf.js (Node, `@napi-rs/canvas`, annotations enabled) to PNGs and diffs flattened vs native (AC 4, threshold constant documented), and opens each file in headed Chromium (Playwright) for a screenshot of Chrome's PDF viewer — look at the screenshots yourself and record the Chrome column of the checklist.
- [ ] **Task 7: Checklist + A5 table**: write `docs/export-mapping.md`: how to run, file list, the checklist table (rows = types and variants, columns = Revu / Acrobat × visible / editable / measurement kept / subject+author / layer / group), Chrome column filled, Revu and Acrobat columns left `?` for the founder, and a provisional A5 table with the reasoning; after the founder reports results the table is finalised (a follow-up commit, not this agent's job).
- [ ] **Task 8: Tests** (AC 5) co-located, node env.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
