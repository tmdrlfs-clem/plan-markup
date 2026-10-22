# Fixtures

- `pdf/` - small PDF drawings that are safe to commit, used by tests.
- `btx/` - small Bluebeam `.btx` tool-chest samples that are safe to commit.
- `zones/` - zone and sprinkler-layout JSON fixtures for the 4541 engine tests (format below).
- `private/` - the founder's real drawings and `.btx` files. Git-ignored, never committed.

## Viewer fixtures (Story 3.1, committed in `pdf/`)

All synthetic. Regenerate with `node scripts/fixtures/make-viewer-fixtures.mjs` (needs the dev
dependencies) and `python scripts/fixtures/make-wasm-images.py` (Pillow with OpenJPEG and libtiff).

| File | What | Used by |
| --- | --- | --- |
| `vector-a3.pdf` | Copy of `export-sample.pdf`: A3 vector plan with Helvetica text | e2e open (chooser, drop) |
| `image-only.pdf` | A4 page with one raster image, no paths or text (a "scan") | image-only HintBar |
| `corrupt.pdf` | `%PDF-1.7` header followed by text that is not PDF syntax | "not a valid PDF" error |
| `password.pdf` | One page, AES-256, user password `plan-markup-test` | "password-protected" error |
| `wasm-images.pdf` | A JPX (JPXDecode) and a CCITT G4 image | wasm decoders under the worker CSP (ADR 0005) |

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
