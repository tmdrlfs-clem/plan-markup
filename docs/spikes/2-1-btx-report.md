# Spike 2.1 — .btx parse and render

Story: `_bmad-output/implementation-artifacts/2-1-spike-btx-parse-and-render.md` (A13 risk spike 1 of 4).
Question: can the founder's 138 Revu tools be read and drawn at ≥ 95 % visual fidelity (NFR10), so that the
Tool Chest import (FR42) is feasible?

**Status (2026-10-20): parser and renderer done, all 138 items decode and render. The founder reviewed the
contact sheets and waived the Revu reference capture and the measured pass rate** (see "Founder decisions").
Decision below is "go".

## Method

1. `src/core/btx/parse.ts` (production code, framework-free, runs in `src/workers/btx.worker.ts`) reads the
   XML with a strict own reader (`xml.ts`), decodes hex + zlib with the platform `DecompressionStream`
   (`inflate.ts`), parses each `Raw`/`Data` value as a PDF object (`pdf-object.ts`) and resolves the
   `BBObjPtr_*` graph per item. Output: typed `BtxToolSet`, validated with Zod.
2. `src/core/btx/to-pdf.ts` builds a one-page in-memory PDF per item with `@cantoo/pdf-lib` 2.11.1: every
   resource becomes an indirect object, the annotation dictionaries go into `/Annots`. Members without `/AP`
   get an appearance stream from `appearance.ts` (our code, not pdf.js's fallback).
3. `scripts/spike-btx/render.mjs` renders the page with pdf.js 6.4.299 (legacy build in Node,
   `isEvalSupported: false`, annotations enabled) on `@napi-rs/canvas` at 4 px/pt (≈ 288 dpi).
4. `scripts/spike-btx/reference.mjs` reads Revu-saved placement PDFs, splits `/Annots` into placed units
   (a group = root + members with `/IRT` → root and `/RT /Group`), renders each unit alone (other
   annotations and page content removed, page cropped to the unit) at the same scale. A
   `reference/<set>/<nnn>.png` direct Revu export overrides the PDF-derived image.
5. `scripts/spike-btx/image.mjs` trims both images to their non-white box, scales the render to the
   reference size and runs pixelmatch 8.0.0 (threshold 0.1, anti-aliasing ignored). **Pass = diff ≤ 2 % of
   the reference's non-white pixels** (`PASS_DIFF_PERCENT`; the diff % is printed per item so borderline
   cases can be judged by eye).
6. `npm run spike:btx` runs everything on the three private sets and rewrites the "Results" block of this
   file. `npm run spike:btx -- --self-test` runs the same pipeline on `fixtures/btx/synthetic.btx` against a
   placement PDF we generate ourselves (groups linked like Revu does): 5/5 items pass at 0.00 %, which proves
   the intake, unit grouping, matching and diff path end to end. The same check is a unit test
   (`scripts/spike-btx/harness.test.mjs`).

The harness is not in CI (it needs the private files); the parser/appearance/PDF/worker unit tests and the
synthetic render test are.

## Untrusted-input limits (NFR31)

| Limit | Value | Error code |
|---|---|---|
| Input file | 32 MB | `file-too-large` |
| One hex value | 16 MB of hex | `hex-too-large` (odd length / non-hex: `hex-invalid`) |
| One inflated value | 8 MB, checked per chunk while inflating | `inflate-value-too-large` |
| Inflated total per file | 128 MB, running, checked per chunk | `inflate-total-too-large` |
| DOCTYPE, ENTITY, CDATA, PIs other than the XML declaration, undeclared entities | rejected | `xml-forbidden` |
| XML depth | 16 | `xml-too-deep` |
| PDF object nesting | 64 | `pdf-too-deep` |
| `BBObjPtr` graph | iterative walk with a visited set (cycles and 50 000-long chains tested) | missing ids reported per item |

All errors are `BtxError { code, message }`; messages name the limit or the structural problem, never file
content (tested). Real files use far less: largest inflated value ≈ 1.1 MB of hex / 547 KB inflated,
deepest XML 4, files 0.7–6.7 MB, parse time 0.1–0.8 s per file in Node.

## Findings about the format (beyond `docs/feature-inventory.md`)

- **Item shape.** Every member (root and `Child`) has `X`, `Y`, `Index`. `Name` is a random 16-letter id, so
  the label to show is the root's `/Subj`. Items can carry an extra `<Sequence>` element (count numbering:
  `Enabled`, `Style`, `Start`, `Increment`, `ResetMode`, `Renumber`); it is kept as a warning for now and
  belongs in the FR42 model.
- **Placement sign convention.** Each member's own `/Rect` origin sits at **(-X, -Y)** in the tool frame
  (root included). Verified on concentric ring + dot groups in the founder's files: they line up only with
  this sign, and cross/tick groups of two lines meet in the middle. The synthetic group encodes the same rule.
- **Count measurements are `/Subtype /Polygon`** (with `/IT /PolygonCount`, `/AP`, `/Vertices`), not `RL`;
  `RL` is the `/BBMeasure` subtype (ruler). They render from their own `/AP`.
- **Missing resources.** 21 of 138 items reference `BBObjPtr` ids that are not in the file (Revu dropped
  nested XObjects). For 19 the missing objects are nested forms and the rest still draws; we substitute an
  empty form so viewers do not fail. **2 items have no appearance at all** (`/AP /N` points at a missing
  object, zero resources): sprinkler-tools #65 and my-tools #14, both "Snapshot" stamps → nothing to import.
- **`/OC` is a string** (a Revu layer name such as `(sign)`), which pdf.js reports as malformed optional
  content. We drop `/OC` in the render PDF only when it is not a dictionary/reference; the model keeps it.
- **Images.** Stamp resources use FlateDecode (+ ASCII85), DCTDecode and CCITTFaxDecode images. pdf.js 6
  decodes CCITT/JBIG2/JPX in wasm: **`wasmUrl` must be passed to `getDocument`** (Node and browser), or such
  images silently render blank (found on sprinkler-tools #5, a scanned signature).
- **Fonts.** TrueType, Type1 and Type0/CIDFontType2 (embedded) in stamp forms; all drew correctly by eye.
- **Opacity.** One stamp (fire-alarm-tools #22, "Snapshot") has `/CA 0.1` and an ExtGState with 0.1 inside its
  form: it renders at near-white and the harness flags it "blank". This is faithful, not a bug, unless Revu
  applies only one of the two opacities (open question).
- **Revu-private keys** seen: `TmpScaleX/Y`, `TmpBorderIndicator`, `IT /StampSnapshot`, `Rotation` (Revu's,
  not `/Rotate`), `SetOpacityFromStampFile`, `MirrorHorizontal`, `TempBBox`, `TempRT`, `TempIRT`,
  `TempNameID`, `TempGroupNestingName`, `TempGroupNesting`, `GroupNesting`, `FillOpacity`, `SlopeType`,
  `PitchRun`, `PressureList`/`PressureLevels` (ink), `BBMeasure`, `CountStyle`, `NumCounts`, `BBCopyFromID`.
  They are kept in the typed model; none had to be removed for pdf.js except the string `/OC`.
- **Annotations without `/AP`** (generated by `appearance.ts`): sprinkler-tools 32 of 81 members (Circle 16,
  Line 8, PolyLine 3, Square/image 2, FreeText 2, Ink 1), fire-alarm-tools 13 of 56 (all image squares),
  my-tools 15 of 23 (Circle 7, Line 4, Ink 3, PolyLine 1): **60 members in 39 items**. No line endings
  (`/LE`) occur in the founder's files; the generator supports the standard ones anyway.
- **No SVG** anywhere (nothing to sanitise).

## Render observations (by eye, contact sheets in `fixtures/private/btx/out/`)

- **sprinkler-tools (66):** stamps (logos, title blocks, legend table, labelled devices FS/FH/FHR/FSI/HYD,
  braces) look complete, including embedded fonts and colour images. Generated circles, dashed circles,
  ring + dot groups, ticks/crosses (line groups), polylines and image squares look right. The Ink "pen"
  item draws as uniform-width strokes (Revu uses `PressureList`, so Revu's line will vary in width). Free
  text "1"/"UD" draws in Helvetica instead of Calibri. #65 is blank (no appearance in the file).
  #5 rendered blank until `wasmUrl` was set (fixed).
- **fire-alarm-tools (56):** all stamps and the 13 image squares (fire hose, extinguisher, IP horn photo,
  panels) render. #22 is near-invisible by design (`/CA 0.1`). Many symbols are tiny (6–10 pt), so the
  diff will be sensitive to anti-aliasing at that size; 4 px/pt keeps them ≥ 24 px.
- **my-tools (16):** overlaps with the first sprinkler items; all render except #14 (no appearance in file).
  Korean subjects are fine in the data (UTF-16BE); only the contact-sheet label font lacks Hangul.

## Reference capture (founder, about 15 minutes per set)

For each set: in Revu 21 create a blank page (letter or larger), open the set in the Tool Chest, and place
**every tool once, in Tool Chest order**, left to right, top to bottom, not overlapping. Save as
`fixtures/private/btx/reference/<set>.pdf` (`sprinkler-tools`, `fire-alarm-tools`, `my-tools`). Optional:
File › Export › Image (PNG, 300 dpi) per tool as `reference/<set>/<nnn>.png` to override the PDF-derived image.
Then run `npm run spike:btx`: this file gets the pass rate. The two items without an appearance will not
place in Revu either; a count mismatch is reported and matching falls back to subject + type.

## Results

<!-- harness:begin -->
_Generated by `npm run spike:btx` on 2026-10-20. Render: pdf.js 6.4.299 (legacy build, Node), @napi-rs/canvas, 4 px/pt, annotations enabled, `isEvalSupported: false`. Diff: pixelmatch threshold 0.1, anti-aliasing ignored, both images trimmed to their non-white box and the render scaled to the reference; pass = diff ≤ 2 % of the reference's non-white pixels._

### Summary

| Set | Items | Members | /AP in .btx | Generated AP | Missing refs | Blank renders | References | Pass rate |
|---|---|---|---|---|---|---|---|---|
| sprinkler-tools | 66 | 81 | 48 | 18 | 3 | 1 | missing | references missing |
| fire-alarm-tools | 56 | 56 | 43 | 13 | 16 | 1 | missing | references missing |
| my-tools | 16 | 23 | 8 | 8 | 2 | 1 | missing | references missing |

**Overall: references missing** (138 items rendered; no pass rate until the Revu reference PDFs exist, see "Reference capture").

### Per item

| Set | # | Subject | Type | Members | Has AP | Result | Diff | Reason / observations |
|---|---|---|---|---|---|---|---|---|
| sprinkler-tools | 0 | 스냅샷 | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 1 | Group | Circle | 2 | no (generated) | – | – |  |
| sprinkler-tools | 2 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 3 | PolyLine | PolyLine | 1 | no (generated) | – | – |  |
| sprinkler-tools | 4 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 5 | 스냅샷 | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 6 | Group | Line | 2 | no (generated) | – | – |  |
| sprinkler-tools | 7 | Group | Line+Circle | 3 | no (generated) | – | – |  |
| sprinkler-tools | 8 | 스냅샷 | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 9 | 스냅샷 | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| sprinkler-tools | 10 | Group | Circle | 2 | no (generated) | – | – |  |
| sprinkler-tools | 11 | PolyLine | PolyLine | 1 | no (generated) | – | – |  |
| sprinkler-tools | 12 | PolyLine | PolyLine | 1 | no (generated) | – | – |  |
| sprinkler-tools | 13 | Group | Line | 2 | no (generated) | – | – |  |
| sprinkler-tools | 14 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 15 | Group | Circle | 2 | no (generated) | – | – |  |
| sprinkler-tools | 16 | Group | Circle | 2 | no (generated) | – | – |  |
| sprinkler-tools | 17 | Line | Line+Circle | 3 | no (generated) | – | – |  |
| sprinkler-tools | 18 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 19 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 20 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 21 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 22 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 23 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 24 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 25 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 26 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 27 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 28 | Count Measurement | Polygon | 1 | yes | – | – |  |
| sprinkler-tools | 29 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 30 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 31 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 32 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 33 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 34 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 35 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 36 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 37 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 38 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 39 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 40 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 41 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 42 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 43 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 44 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 45 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 46 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 47 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 48 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 49 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 50 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 51 | Group | Circle | 2 | no (generated) | – | – |  |
| sprinkler-tools | 52 | 스냅샷 | Stamp | 1 | yes | – | – | 3 referenced resource(s) missing in .btx |
| sprinkler-tools | 53 | Image | Square | 1 | no (generated) | – | – |  |
| sprinkler-tools | 54 | Image | Square | 1 | no (generated) | – | – |  |
| sprinkler-tools | 55 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 56 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 57 | Count Measurement | Polygon | 1 | yes | – | – |  |
| sprinkler-tools | 58 | Count Measurement | Polygon | 1 | yes | – | – |  |
| sprinkler-tools | 59 | Group | Circle+FreeText | 3 | no (generated) | – | – |  |
| sprinkler-tools | 60 | Pen | Ink | 1 | no (generated) | – | – |  |
| sprinkler-tools | 61 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 62 | Group | Circle | 2 | no (generated) | – | – |  |
| sprinkler-tools | 63 | Text Box | FreeText+Stamp | 2 | partial | – | – |  |
| sprinkler-tools | 64 | Snapshot | Stamp | 1 | yes | – | – |  |
| sprinkler-tools | 65 | 스냅샷 | Stamp | 1 | yes | – | – | render is blank; 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 0 | Sprinkler (Existing) | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 1 | Sounder (New) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 2 | Smoke (New AA) | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 3 | Isolate Sounder | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 4 | Smoke (Domestic) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 5 | DBA | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 6 | Text Box | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 7 | C/S Heat Detectors | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 8 | Mag Door | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 9 | Horn (New) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 10 | Isolate & Reinstate | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 11 | Heat Detector New (Blue) | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 12 | Isolate & Relocate | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 13 | Smoke (New Conventional) | Stamp | 1 | yes | – | – | 2 referenced resource(s) missing in .btx |
| fire-alarm-tools | 14 | New Heat Detector (Yellow) | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 15 | New Encap Heat Detector | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 16 | MCP (New) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 17 | Heat (Existing) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 18 | MCP (Existing) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 19 | Smoke (Existing) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 20 | Aspirator Panel | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 21 | Multicriteria Detector | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 22 | Snapshot | Stamp | 1 | yes | – | – | render is blank |
| fire-alarm-tools | 23 | Sounder (Boxed) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 24 | Horn (Existing) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 25 | EOL - Linear Wire | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 26 | Power Supply | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 27 | Relay Module | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 28 | Magnetic Door Hold Open | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 29 | Hush | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 30 | IS Smoke Detector | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 31 | Apartment Module with Hush | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 32 | ASE | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 33 | Snapshot | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 34 | Power Supply | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 35 | Snapshot | Stamp | 1 | yes | – | – | 2 referenced resource(s) missing in .btx |
| fire-alarm-tools | 36 | Hush Module (Apt B) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 37 | Sounder (Exising) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 38 | Snapshot | Stamp | 1 | yes | – | – | 2 referenced resource(s) missing in .btx |
| fire-alarm-tools | 39 | New Heat Detector (C/S) | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 40 | Fire Hose | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 41 | Fire Extinguisher | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 42 | Conventional Heat Detector-C/S | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 43 | Linear Heat EOL | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 44 | IP Horn | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 45 | Blue Strobe Light | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 46 | Apartment Module with Hush | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 47 | AA MCP (New) | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 48 | Remote Display Unit | Square | 1 | no (generated) | – | – |  |
| fire-alarm-tools | 49 | Existing Sprinkler | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 50 | Mimic | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| fire-alarm-tools | 51 | Fire Alarm Panel | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 52 | Visual Alerting Strobe | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 53 | Aspirating Panel | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 54 | SUB FIRE ALARM PANEL - F220 | Stamp | 1 | yes | – | – |  |
| fire-alarm-tools | 55 | Fibre Optic Converter | Stamp | 1 | yes | – | – |  |
| my-tools | 0 | 스냅샷 | Stamp | 1 | yes | – | – |  |
| my-tools | 1 | 스냅샷 | Stamp | 1 | yes | – | – |  |
| my-tools | 2 | Ellipse | Circle | 2 | no (generated) | – | – |  |
| my-tools | 3 | Snapshot | Stamp | 1 | yes | – | – |  |
| my-tools | 4 | Snapshot | Stamp | 1 | yes | – | – |  |
| my-tools | 5 | Line | Line | 2 | no (generated) | – | – |  |
| my-tools | 6 | PolyLine | PolyLine | 1 | no (generated) | – | – |  |
| my-tools | 7 | Ellipse | Circle+Line | 3 | no (generated) | – | – |  |
| my-tools | 8 | Snapshot | Stamp | 1 | yes | – | – |  |
| my-tools | 9 | Ellipse | Circle | 2 | no (generated) | – | – |  |
| my-tools | 10 | Ellipse | Circle | 2 | no (generated) | – | – |  |
| my-tools | 11 | 스냅샷 | Stamp | 1 | yes | – | – |  |
| my-tools | 12 | 스냅샷 | Stamp | 1 | yes | – | – | 1 referenced resource(s) missing in .btx |
| my-tools | 13 | Pen | Ink | 2 | no (generated) | – | – |  |
| my-tools | 14 | Snapshot | Stamp | 1 | yes | – | – | render is blank; 1 referenced resource(s) missing in .btx |
| my-tools | 15 | Pen | Ink | 1 | no (generated) | – | – |  |

### Failing / flagged items

- sprinkler-tools #9 (스냅샷, Stamp): 1 referenced resource(s) missing in .btx
- sprinkler-tools #52 (스냅샷, Stamp): 3 referenced resource(s) missing in .btx
- sprinkler-tools #65 (스냅샷, Stamp): render is blank; 1 referenced resource(s) missing in .btx
- fire-alarm-tools #2 (Smoke (New AA), Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #11 (Heat Detector New (Blue), Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #13 (Smoke (New Conventional), Stamp): 2 referenced resource(s) missing in .btx
- fire-alarm-tools #14 (New Heat Detector (Yellow), Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #15 (New Encap Heat Detector, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #20 (Aspirator Panel, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #21 (Multicriteria Detector, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #22 (Snapshot, Stamp): render is blank
- fire-alarm-tools #30 (IS Smoke Detector, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #31 (Apartment Module with Hush, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #32 (ASE, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #33 (Snapshot, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #34 (Power Supply, Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #35 (Snapshot, Stamp): 2 referenced resource(s) missing in .btx
- fire-alarm-tools #38 (Snapshot, Stamp): 2 referenced resource(s) missing in .btx
- fire-alarm-tools #39 (New Heat Detector (C/S), Stamp): 1 referenced resource(s) missing in .btx
- fire-alarm-tools #50 (Mimic, Stamp): 1 referenced resource(s) missing in .btx
- my-tools #12 (스냅샷, Stamp): 1 referenced resource(s) missing in .btx
- my-tools #14 (Snapshot, Stamp): render is blank; 1 referenced resource(s) missing in .btx
<!-- harness:end -->

## Founder decisions (2026-10-20)

1. **No measured pass rate.** The founder accepted the fidelity by eye from the contact sheets and waived the
   Revu reference capture. The reference intake and pixel diff stay in `scripts/spike-btx/` for later use;
   NFR10 is judged by founder review for the spike. Open questions 1, 2 and 6 are therefore deferred to FR42.
2. **Ink width is user-selectable.** Revu's pressure data is dropped; imported ink draws at a uniform width
   that the user can change like any other stroke width (default = `/BS /W`). Answers open question 3.
3. **Bundle a free metric-compatible font.** FreeText that asks for Calibri renders with Carlito (SIL OFL,
   metric-compatible with Calibri); FR42 bundles it. Answers open question 4.

## Decision

**Go** (originally "go, with conditions"; the condition, the measured rate, was waived by the founder).
Format risk is retired: all 138 items parse within tight limits, every reference
resolves or is reported, and all items with drawable content render through one pdf.js pipeline. The
visual-fidelity number (≥ 95 %) is still open until the founder captures the Revu references; the
expected risk is concentrated in the 39 items whose appearance we generate (Revu's own drawing of circles,
lines, pressure ink and Calibri text may differ in stroke placement and line caps). If the measured rate is
below 95 %, the change is the fallback below, not a different parser.

## Recommended FR42 import design

- **Stamps with `/AP` (97 items, 95 with a drawable appearance) → image-stamp tools.** Import the appearance as-is: store the resolved
  object graph (form XObjects, fonts, images) as a self-contained PDF snippet (exactly what `to-pdf.ts`
  builds) and render it with pdf.js. Keep `/Subj` as the tool name, `/Rect` size as default size,
  `TmpScaleX/Y`, `Rotation`, `/C`, `/CA`. Stamps whose appearance is missing in the file are skipped with a
  message.
- **Circle, Square, Line, PolyLine, Polygon, Ink without `/AP` → vector tools.** Map to our own markup
  types with stroke colour `/C`, fill `/IC`, width `/BS /W`, dash `/BS /D`, opacity `/CA`/`FillOpacity`,
  inset `/RD`, geometry `/Rect`, `/L`, `/Vertices`, `/InkList` (pressure dropped; stroke width user-selectable, founder decision 2). These stay editable
  in our editor, which is the point of a tool chest.
- **Image squares (`/Image`) → image-stamp tools** with the image XObject and an optional border.
- **FreeText → text tool** (`/Contents`, `/DA` size and colour, `/DS` alignment/margin); Calibri
  substituted with the bundled Carlito (founder decision 3), other faces with the closest available one.
- **Groups (`Child`) → one grouped tool**, members placed at (-X, -Y), keeping `Index` order and
  `TempGroupNesting*` for nested groups.
- **Count measurements (Polygon + `BBMeasure`) → count tool** with the stamp-like `/AP` as its marker and
  `CountStyle`; `<Sequence>` numbering settings imported as metadata.
- **Fallback:** any item whose vector reconstruction fails the fidelity check (or a future type we do not
  model) is imported as an image stamp of our own rendered appearance, so nothing is lost.
- **Placeable in principle:** every item with a `/Rect` and an appearance (136 of 138); placement itself
  needs the editor (third A9 clause, out of scope here).

## Open questions

1. Reference capture: does Revu save placed groups as `/IRT` + `/RT /Group` (as the intake assumes)? If not,
   the subject + type fallback still matches units, but groups would count as several units.
2. Does Revu apply both the annotation `/CA` and the form's own ExtGState (fire-alarm-tools #22), or one of them?
3. ~~Pressure-sensitive ink~~ — answered: uniform, user-selectable width (founder decision 2).
4. ~~Calibri vs Helvetica~~ — answered: bundle Carlito (founder decision 3).
5. `MirrorHorizontal` on a fire-alarm stamp: is the mirror already baked into its `/AP` (assumed) or applied
   by Revu at draw time?
6. The 2 % threshold is a first guess; tiny symbols (6 pt) may need a per-size threshold once real diffs exist.
