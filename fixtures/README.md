# Fixtures

- `pdf/` - small PDF drawings that are safe to commit, used by tests.
- `btx/` - small Bluebeam `.btx` tool-chest samples that are safe to commit.
- `zones/` - zone and sprinkler-layout JSON fixtures for the 4541 engine tests (format below).
- `private/` - the founder's real drawings and `.btx` files. Git-ignored, never committed.

## Viewer fixtures (Stories 3.1 and 3.3, committed in `pdf/`)

All synthetic. Regenerate with `node scripts/fixtures/make-viewer-fixtures.mjs` (needs the dev
dependencies) and `python scripts/fixtures/make-wasm-images.py` (Pillow with OpenJPEG and libtiff).

| File | What | Used by |
| --- | --- | --- |
| `vector-a3.pdf` | Copy of `export-sample.pdf`: A3 vector plan with Helvetica text | e2e open (chooser, drop) |
| `image-only.pdf` | A4 page with one raster image, no paths or text (a "scan") | image-only HintBar |
| `corrupt.pdf` | `%PDF-1.7` header followed by text that is not PDF syntax | "not a valid PDF" error |
| `password.pdf` | One page, AES-256, user password `plan-markup-test` | "password-protected" error |
| `wasm-images.pdf` | A JPX (JPXDecode) and a CCITT G4 image | wasm decoders under the worker CSP (ADR 0005) |
| `multi-page.pdf` | 4 pages: A3 landscape with a title block (sheet number `S-101`, no page label); A4 portrait labelled `FP-201`; A3 portrait with /Rotate 90 labelled `FP-202 - SPRINKLER LAYOUT`; A4 landscape labelled `4` | pager, page keys, sheet labels (Story 3.3) |
| `search.pdf` | 3 pages: A4 landscape with `CH +2700` twice, `SPRINKLER VALVE` split inside the word across two runs (two fonts), `LEVEL` + `17` as two runs, `D1` / `D10`; an image-only page; A4 portrait with /Rotate 90 with `CH +2700` and `SPRINKLER VALVE` | text search (Story 3.6): `ch +2700` gives 3 results on 2 pages |

| `snap.pdf` | Story 4.1, from `node scripts/fixtures/make-snap-fixture.mjs` (deterministic): page 1 A4 landscape with a stroked rectangle (100, 100)-(300, 250), two lines crossing at (500, 200), a circle (700, 200) r 50, a white-filled and a clip-only rectangle and the text "SNAP" (not snap targets), a form XObject's line (600, 400)-(650, 400); page 2 A4 portrait, /Rotate 90, MediaBox [-100 -50 495 792], a line and a rectangle | snap extraction and resolution unit tests, `viewer-snap` e2e |

| `scales.pdf` | Story 4.2, from `node scripts/fixtures/make-scales-fixture.mjs` (deterministic): A1 page "SCALE 1:100 @ A1"; the same on an A3 page; an A1 page with viewport labels 1:50, 1:100, 1:100; an A3 page with "As indicated", "FALLS 1:40", a date and time, "1:100 YEAR FLOOD"; an A1 page with the view title "PLAN VIEW 1 : 75 @ A1 1 : 200 @ A3" (two sheet statements that disagree, 4.2 review) | `viewer-scale-detect` e2e: detected, converted (1:200), "2 scales on page", "Scale not set", "Scales disagree" |

`password.pdf` is not deterministic (random salts), so the script rewrites it only when it is
missing or with `--force`.

## Render performance fixtures and reference hardware (A10, Story 2.3)

NFR1 / NFR2 are measured on the reference machine below with these fixtures (all under
`private/pdf/`, git-ignored). Counts come from `node scripts/spike-render/inspect-fixtures.mjs`
(pdf.js 6.4.299 operator list of page 1; "path segments" are the moveTo/lineTo/curveTo/closePath
records inside pdf.js's batched `constructPath` operators).

| Fixture | File | Size | Page | Operator list | Path segments | Images |
| --- | --- | --- | --- | --- | --- | --- |
| L17 | `A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf` | 2.1 MB | A1, 2384 x 1684 pt | 176,045 | ~398 k | 3 |
| L21 | `A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf` | 2.4 MB | A1, 2384 x 1684 pt | 185,676 | ~430 k | 3 |
| A0 | `synthetic-a0-50mb.pdf` | 50.1 MB | A0, 3370 x 2384 pt | 159,002 | ~9.66 M | 0 |

- The A0 file is generated, not shipped: `node scripts/spike-render/make-a0.mjs` (deterministic,
  ~10 s). It is a stress case: 118 Flate content streams (183 MB uncompressed), ~9.6 M path
  operators (m/l/c/re/h/S) from a jittered ceiling grid in short segments, double-line walls,
  hatching, Bezier circles, SHX-style exploded text and some Helvetica text.
- **Reference hardware:** Intel Core i5-1145G7 (4 cores / 8 threads, 2.6 GHz), 15.8 GB RAM,
  Intel Iris Xe graphics, Windows 11 Pro 10.0.22631. Browser: Playwright 1.64.1 bundled Chromium
  (build 1248; the exact version string is recorded in `docs/spikes/2-3-render-report.md`).
- Measure with Docker Desktop and other heavy apps closed; the report notes background load.

## `zones/*.json` (format `plan-markup.zone-fixture/1`)

One file per zone, named `<slug>.json`. These files are the single source of truth for the
placement spike (`spikes/4541-placement/test/run.mjs` and the demo build read them) and are meant
to seed the Epic 9 engine tests. They were written by `spikes/4541-placement/export-zones.mjs`;
`node spikes/4541-placement/export-zones.mjs --check` reports any file that no longer matches the
generator.

All coordinates are real millimetres, y axis up. A ring is a list of `[x, y]` pairs, open (the
last point is not repeated), any orientation.

```jsonc
{
  "format": "plan-markup.zone-fixture/1",
  "slug": "z6",                       // file name without .json
  "sample": {
    "id": "Z6",                       // sample (site) id; zones of one sample are placed together
    "name": "Z6 Hall with 3 columns",
    "group": "named",                 // NFR9 | named | shapes | infeasible (demo grouping)
    "index": 8,                       // order of the sample in the suite
    "zone": 0,                        // order of this zone inside the sample (placement order)
    "zones": 1                        // number of zones in the sample
  },
  "units": "mm",
  "hazards": ["OH1"],                 // hazard classes the suite runs; the first is zone.hazard
  "zone": {
    "zoneId": "Z6",
    "hazard": "OH1",                  // ELH | OH1 | OH2 | OH3
    "pattern": "rectangular",         // rectangular | staggered
    "outer": [[0, 0], [16800, 0], [16800, 9000], [0, 9000]],
    "holes": [                        // optional
      { "kind": "column", "ring": [[3900, 4200], [4500, 4200], [4500, 4800], [3900, 4800]] }
    ],
    "openEdges": [[[12000, 0], [12000, 9000]]],   // optional: outline edges with no wall (open plan)
    "grid": { "angleDeg": 0, "pitchX": 1200, "pitchY": 600, "originX": 0, "originY": 0, "mode": "preferred" },
    "keepOuts": [                     // optional, data only (see below)
      { "kind": "panel", "ring": [[5700, 4500], [6300, 4500], [6300, 5100], [5700, 5100]] },
      { "kind": "downlight", "circle": { "x": 1800, "y": 1800, "r": 300 } }
    ]
  },
  "expected": {                       // per hazard in `hazards` (and any hazard with a hand count)
    "OH1": { "hand": 15, "lowerBound": 13 }
  }
  // or, for an infeasible zone:  "expected": { "error": "NO_ADMISSIBLE_REGION" }
}
```

- **Hole kinds** (founder decision 4, 2026-10-17): `column` holes block spray and need `Wmin`
  clearance, but `Wmax` does not apply to their faces and they never cut bays; `shaft` holes
  (shafts, voids) are real walls. Readers must not infer the kind from the size; the spike's
  1 m extent heuristic applies only to untagged holes.
- **`hand`** is the design §5 hand-worked count (`null` where none exists). It is a reference,
  not a pass mark: the engine may beat it, and some hand counts predate the column rule (Z6).
- **`lowerBound`** is ⌈area / Amax⌉ with area = outer − holes (the suite checks it against the
  oracle's area).
- **`error`** is the typed error code an infeasible zone must return (`NO_ADMISSIBLE_REGION`,
  `INVALID_ZONE`), always with a location.
- **`grid.mode`** is `off`, `preferred` or `required`; tile stops are tile centres.
- **`keepOuts`** come from design §5 (R1 panel lights, R2 downlights). The spike ignores them;
  Epic 9 tests must check that no head lies inside a keep-out.

## `zones/layouts/*.json` (format `plan-markup.zone-layout/1`, Story 9.4)

Reference head layouts for the oracle tests (`src/core/sprinkler/oracle/check.test.ts`), one file
per sample and hazard: `<sample>.<hazard>.json`, all lower case. Written by
`node scripts/fixtures/make-zone-layouts.mjs` from the Story 2.2 spike placer; `--check` reports
any file that no longer matches. The production oracle never imports the spike or any placer: it
only reads these files in tests and must find zero errors on each, keep-outs included (the spike
placer ignored keep-outs, but none of its heads lands in one).

```jsonc
{
  "format": "plan-markup.zone-layout/1",
  "sample": "Z2",                     // sample id (several zones for open-plan samples)
  "hazard": "ELH",
  "ruleSet": { "id": "nzs4541", "version": "1" },
  "units": "mm",
  "zones": [
    { "slug": "z2", "zoneId": "Z2", "heads": [{ "id": "Z2:0:0:0", "x": 1500, "y": 2250 }] }
  ]
}
```
