# Export mapping (A5) and round-trip checklist

Story 2.4 spike: do exported markups open, and stay editable, in Revu and Acrobat (FR60, FR61,
NFR41)? This page has the files to check, how each markup type is encoded, the manual checklist
and the provisional A5 table. The Chrome column was filled by the dev agent from screenshots;
the Revu and Acrobat columns (`?`) were for the founder.

**Founder result (2026-10-22):** all four files opened in Revu 21 and Acrobat and the founder
reported no problems ("okay"). No per-cell results were recorded, so the `?` cells below stay
open; Epic 8 (Stories 8.1/8.2) re-runs this checklist cell by cell before release (NFR41).

## How to run

```sh
npm run spike:export                      # PDFs + pdf.js renders + flatten diff + Chrome screenshots
npm run spike:export -- --no-chrome       # skip the browser
npm run spike:export -- --browser=chrome  # installed Google Chrome instead of Playwright's Chromium
npm run spike:export:sample               # regenerate fixtures/pdf/export-sample.pdf (deterministic)
```

Inputs: `fixtures/pdf/export-sample.pdf` (committed, 5.8 KB, synthetic A3 landscape floor plan at
1:100 with a 1200 x 600 ceiling grid, walls, rooms, room names and 35 numbered cells) and the
markup set in `src/core/export/sample-set.ts` (calibration 1:100, metres, 2 decimals).
Outputs (git-ignored, under `fixtures/private/export/`):

| File | What it tests |
| --- | --- |
| `native.pdf` | (a) native annotations: the standard ISO 32000 subtype per type, our `/AP /N`, `/Measure`, OCG layers, `/IRT` groups. ISO keys only (plus our `/PM_` keys). |
| `native-revu.pdf` | (a') same as `native.pdf` plus the Revu measurement keys observed in the founder's own Revu files (see "Revu keys"). Decides whether Revu needs them to treat counts and measurements as measurements. |
| `appearance-only.pdf` | (b) every markup as a `/Stamp` that carries only `/AP` plus `/Subj`, `/T`, `/NM`, dates, layer and group (no geometry or measurement keys). Hyperlinks stay `/Link`. |
| `flattened.pdf` | (c) every appearance drawn into the page content and the annotations removed; layered content stays on its layer (`/OC … BDC`); the hyperlink stays a clickable borderless `/Link`. |
| `png/*.png` | pdf.js renders (annotations enabled, 1.5 px/pt) and `flattened-vs-native-diff.png`. |
| `chrome/*.png` | Chrome PDF viewer screenshots (headed Chromium). |
| `summary.json` | sizes, annotation counts, diff numbers, browser version. |

**Flatten diff (AC 4):** flattened vs native rendered with pdf.js at 1.5 px/pt, pixelmatch colour
threshold 0.1, anti-aliasing ignored; pass when differing pixels ≤ 0.5 % of the native render's
non-white pixels (`FLATTEN_MAX_DIFF_PERCENT` in `scripts/spike-export/diff.mjs`). Result: **0
pixels** differ (appearance-only vs native: 0 as well). `scripts/spike-export/harness.test.mjs`
runs the same check in CI and proves the diff fails when one markup is missing.

## Cell map and encoding

The cell number is printed on the page (top-left of each cell). All annotations carry `/NM`
(stable id), `/Subj`, `/T` (author "Plan Markup spike"), `/M`, `/CreationDate`, `/F 4`
(print), `/Rect` and an `/AP /N` form whose `/BBox` is the `/Rect` (identity `/Matrix`).
Shapes add `/C`, `/IC`, `/CA`, `/BS`.

| # | Type | Native encoding | Notes |
| --- | --- | --- | --- |
| 01 | line | `Line` `/L`, `/LE [/None /None]` | |
| 02 | arrow | `Line` `/LE [/None /ClosedArrow]`, `/IC` | |
| 03 | polyline | `PolyLine` `/Vertices` | |
| 04 | polygon | `Polygon` `/Vertices`, `/IC` | |
| 05 | rectangle | `Square` `/RD`, dashed `/BS /S /D` | |
| 06 | ellipse | `Circle` `/RD`, `/CA 0.8` | opacity also in the `/AP` ExtGState |
| 07 | arc | `PolyLine` through points every 10° | no arc subtype in ISO 32000; `/AP` is a true arc |
| 08 | cloud | `Polygon` `/IT /PolygonCloud`, `/BE << /S /C /I 1 >>` | |
| 09 | cloud+ | `Polygon` cloud (group root) + `FreeText` `/IT /FreeTextCallout` (member, `/IRT` + `/RT /Group`) | two annotations, one group |
| 10 | callout | `FreeText` `/IT /FreeTextCallout`, `/CL` (6 numbers), `/LE /OpenArrow`, `/RD`, `/DA`, `/DS` | `/C` = background colour |
| 11 | text box | `FreeText` `/IT /FreeText` | |
| 12 | typewriter | `FreeText` `/IT /FreeTextTypeWriter`, no border | |
| 13 | note | `Text` `/Name /Comment`, `/Open false` | no `/Popup` written |
| 14 | highlight | `Highlight` `/QuadPoints` (UL, UR, LL, LR) | `/AP` uses `/BM /Multiply` |
| 15 | pen | `Ink` `/InkList` (2 strokes) | |
| 16 | underline | `Underline` `/QuadPoints` | |
| 17 | strikethrough | `StrikeOut` `/QuadPoints` | |
| 18 | stamp (vector) | `Stamp` `/Name /Approved`, vector `/AP` | |
| 19 | image stamp | `Stamp` `/Name /PM_Image`, `/AP` draws a 48 x 48 RGB image XObject | |
| 20 | dimension | `Line` `/IT /LineDimension`, `/LL 30`, `/LLE 4`, `/Cap true`, `/CP /Top`, `/Measure` | value in `/Contents` |
| 21 | hyperlink | `Link` `/A << /S /URI >>`, `/Border [0 0 0]`, `/H /I`, dashed-box `/AP` | |
| 22 | flag | `Stamp` `/Name /PM_Flag` | layer "Fire protection" |
| 23 | length | `Line` `/IT /LineDimension`, `/LE [/Butt /Butt]`, `/Measure` | |
| 24 | polylength | `PolyLine` `/IT /PolyLineDimension`, `/Measure` | |
| 25 | area | `Polygon` `/IT /PolygonDimension`, `/Measure` | fill opacity 0.35 only in `/AP` |
| 26 | perimeter | `PolyLine` `/IT /PolyLineDimension`, closed (first vertex repeated), `/Measure` | |
| 27 | count | `Polygon` whose `/Vertices` are the 5 counted points | no ISO count intent |
| 28 | angle | `PolyLine` 3 vertices (ray end, vertex, ray end) | no ISO angle intent; value in `/Contents` |
| 29 | radius | `Circle` `/RD`, `/Measure` | no ISO radius intent; value in `/Contents` |
| 30 | diameter | `Circle` `/RD`, `/Measure` | as radius |
| 31 | dynamic fill | `Polygon` `/IT /PolygonDimension`, `/Measure` (A11: vector polygon) | |
| 32 | white-out | `Square` white `/IC`, `/BS /W 0` | **visual cover only**: the text underneath stays in the file (true removal deferred) |
| 33 | device stamp | `Stamp` `/Name /PM_Device` + `/PM_Device << /Kind /Sprinkler /Model (…) /KFactor 80 /TemperatureC 68 /Orientation /Pendent >>` | layer "Fire protection" |
| 34 | group of three | rectangle (root) + ellipse + text box; members `/IRT` → root, `/RT /Group` | the form Revu and Acrobat use |
| 35 | two layers | rectangle on "Measurements", ellipse on "Fire protection" | OCGs in catalog `/OCProperties` (`/OCGs`, `/D /Order /ON /OFF`); annotations `/OC` → OCG |

Layers: all measurement types (20, 23–26, 28–31) are on "Measurements"; 22, 27, 33 on
"Fire protection". Measure dictionary (ISO 32000 12.9): `/Type /Measure /Subtype /RL /R (1:100)
/X [<< /U (m) /C 0.0352778 /F /D /D 100 >>] /D [<< /U (m) /C 1 … >>] /A [<< /U (sq m) /C 1 … >>]`.

### Private and Revu keys

| Key | Where | Why |
| --- | --- | --- |
| `/PM_Device` (dict) | device stamp | our device metadata (kind, model, K-factor, temperature, orientation). Prefix `PM_` = Plan Markup private; other viewers ignore it. |
| `/Name /PM_Image`, `/PM_Flag`, `/PM_Device` | stamps | stamp icon names (ISO allows any name; the `/AP` is what is drawn). |
| `/BBMeasure` | `native-revu.pdf`, every measurement type | Revu's measure dictionary key, observed on Revu count items in the founder's `.btx` files (structure only: `/Type /Measure /Subtype /RL /R /X /D /A` plus Revu's own `/T`, `/V`). We write our ISO measure dictionary under it. |
| `/BBMeasure /TargetUnitConversion 0.000352778` | same | observed constant; equals one point in metres. Meaning unconfirmed. |
| `/IT /PolygonCount`, `/NumCounts`, `/MeasurementTypes 128`, `/CountStyle /Checkmark` | `native-revu.pdf`, count | how Revu encodes a count (observed). In Revu's own items `/Vertices` held 8–12 numbers for `/NumCounts 1`, so Revu may store the marker outline rather than the points: the founder's check decides. |
| `/FillOpacity 0.35` | `native-revu.pdf`, area and dynamic fill | Revu's fill opacity key (seen in the Story 2.1 key survey). |

Only key names and value kinds were observed (Story 2.1 parser, `fixtures/private/btx/`); no client
content was copied. No observation exists for Revu's length, area, angle, radius or diameter
measurements (the founder's tool chests only hold counts).

## Checklist

Legend: ✓ = yes, ✗ = no (add a note), – = not applicable, `?` = to check.
**vis** = visible and looks like the Chrome screenshot; **edit** = can select, move, resize and
change colour (for text: edit the text); **meas** = shows the measurement value and unit (and
recomputes it when the shape is edited); **subj** = Subject and Author shown in the markup list /
properties; **layer** = listed under its layer in the layer panel and hidden with it; **group** =
selecting one member selects the group, it moves as one.

### 1. Files open (all four files)

| File | Chrome opens, no error | Revu 21 opens, no repair prompt | Acrobat opens, no repair prompt | Revu: save + reopen OK | Acrobat: save + reopen OK |
| --- | --- | --- | --- | --- | --- |
| native.pdf | ✓ | ? | ? | ? | ? |
| native-revu.pdf | ✓ | ? | ? | ? | ? |
| appearance-only.pdf | ✓ | ? | ? | ? | ? |
| flattened.pdf | ✓ | ? | ? | ? | ? |

### 2. native.pdf, per type

Chrome shows every markup (screenshot `fixtures/private/export/chrome/native.png`); its viewer
cannot edit existing annotations and has no layer panel, so only "vis" applies there.

| # | Type | Chrome vis | Revu vis | Revu edit | Revu meas | Revu subj | Revu layer | Revu group | Acrobat vis | Acrobat edit | Acrobat meas | Acrobat subj | Acrobat layer | Acrobat group |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | line | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 02 | arrow | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 03 | polyline | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 04 | polygon | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 05 | rectangle | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 06 | ellipse | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 07 | arc | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 08 | cloud | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 09 | cloud+ | ✓ | ? | ? | – | ? | – | ? | ? | ? | – | ? | – | ? |
| 10 | callout | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 11 | text box | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 12 | typewriter | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 13 | note | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 14 | highlight | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 15 | pen | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 16 | underline | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 17 | strikethrough | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 18 | stamp (vector) | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 19 | image stamp | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 20 | dimension | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 21 | hyperlink (click opens example.com) | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 22 | flag | ✓ | ? | ? | – | ? | ? | – | ? | ? | – | ? | ? | – |
| 23 | length | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 24 | polylength | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 25 | area | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 26 | perimeter | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 27 | count | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 28 | angle | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 29 | radius | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 30 | diameter | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 31 | dynamic fill | ✓ | ? | ? | ? | ? | ? | – | ? | ? | ? | ? | ? | – |
| 32 | white-out | ✓ | ? | ? | – | ? | – | – | ? | ? | – | ? | – | – |
| 33 | device stamp | ✓ | ? | ? | – | ? | ? | – | ? | ? | – | ? | ? | – |
| 34 | group of three | ✓ | ? | ? | – | ? | – | ? | ? | ? | – | ? | – | ? |
| 35 | two layers | ✓ | ? | ? | – | ? | ? | – | ? | ? | – | ? | ? | – |

### 3. Variants

| File / rows | Check | Chrome | Revu | Acrobat |
| --- | --- | --- | --- | --- |
| native-revu.pdf, 27 count | shown as a count (count tool / markups list shows 5) | ✓ vis | ? | ? |
| native-revu.pdf, 20, 23–26, 28–31 | measurement value + unit kept, recomputed after a vertex edit | ✓ vis | ? | ? |
| native-revu.pdf, 25, 31 | fill opacity kept after editing | ✓ vis | ? | ? |
| appearance-only.pdf, all | every markup visible and looks right | ✓ | ? | ? |
| appearance-only.pdf, all | can move / resize as a picture; subject + author kept | – | ? | ? |
| appearance-only.pdf, 22–35 | layers and groups still work | – | ? | ? |
| flattened.pdf, all | looks like native.pdf; no markups left in the markup list (except the hyperlink) | ✓ | ? | ? |
| flattened.pdf, 20–35 | layer panel still toggles the flattened measurements and fire-protection items | – (no layer panel) | ? | ? |
| flattened.pdf, 21 | hyperlink still clickable | – (Link present, not clicked) | ? | ? |
| flattened.pdf, 32 | white-out covers "TEMP NOTE" (text is still selectable underneath: expected) | ✓ | ? | ? |

## A5 table (final for the spike)

"Native" = standard annotation, editable elsewhere; "appearance-only" = `/Stamp` with `/AP`
only (visible, movable, not editable as its type); "forced flatten" = always drawn into the page.
Accepted after the founder's overall OK in Revu and Acrobat; reasoning is the ISO 32000 fit and the
Chrome/pdf.js result (all types visible, flatten identical at 0 px). Revu keys: write the
observed count form (`/IT /PolygonCount` + count keys) and `/FillOpacity`; do **not** add guessed
`/BBMeasure` keys to other measurement types until a per-cell Revu check shows they help.
Fallbacks marked below are re-checked cell by cell in Epic 8.

| Type | Mode | Reasoning / fallback |
| --- | --- | --- |
| line, arrow, polyline, polygon, rectangle, ellipse | native | standard subtypes with direct geometry keys. |
| arc | native (PolyLine) | no ISO arc; editable as a polyline elsewhere, arc semantics kept only in our model. Fallback: appearance-only if a PolyLine edit is worse than no edit. |
| cloud | native | `/IT /PolygonCloud` + `/BE /C` is the standard cloud. |
| cloud+ | native (cloud + callout, grouped) | two standard annotations linked as a group; fallback appearance-only if the group breaks. |
| callout, text box, typewriter | native | standard FreeText intents; text stays editable. |
| note | native | standard Text annotation. |
| highlight, underline, strikethrough | native | standard text markup with QuadPoints. |
| pen | native | standard Ink. |
| stamp (vector), image stamp, flag | native (Stamp with `/AP`) | a Stamp is defined by its appearance. |
| hyperlink | native (Link) | kept as a Link in every mode, also when flattened. |
| dimension, length, polylength, perimeter, area | native + `/Measure` | ISO 32000 dimension intents with a rectilinear measure. Revu keys (`/BBMeasure`) only if `native-revu.pdf` keeps values where `native.pdf` does not. |
| dynamic fill (A11) | native (Polygon area) | a vector polygon with `/Measure`; fill opacity lives in `/AP` (+ `/FillOpacity` for Revu). |
| count | native (Polygon of points) | no ISO count; Revu's `/IT /PolygonCount` form is the candidate. Fallback: appearance-only. |
| angle, radius, diameter | native (PolyLine / Circle) + value in `/Contents` | no ISO intent; other viewers keep the shape and the text, not a live value. Fallback: appearance-only. |
| device stamp | native (Stamp + `/PM_Device`) | metadata travels with the file; other viewers ignore the private key. |
| white-out | **forced flatten** for issued exports | as an annotation it is a movable white box over content that is still there; flattening at least fixes it in place. True removal (redaction) is deferred. |
| groups | native (`/IRT` + `/RT /Group`) | the form Revu and Acrobat use; members also flatten individually. |
| layers | native (OCG via `/OC`) | standard optional content; flattened content stays on its layer. |

## Known gaps

- No `/Popup` annotations are written (Acrobat may create them on first edit).
- FreeText `/DA` names `/Helv` without a document `/AcroForm /DR`; viewers that regenerate the
  appearance after an edit fall back to their default font. Our `/AP` is used until then.
- Text in appearances uses standard-14 Helvetica with WinAnsi encoding (non-Latin-1 shows "?").
- Count, angle, radius and diameter values are not recomputed by other viewers (no ISO intent).
- White-out is a visual cover only; the covered text remains extractable.
- Revu keys are only observed for counts; their effect on other measurement types is unknown.
