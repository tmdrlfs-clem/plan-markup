# Fixtures

- `pdf/` - small PDF drawings that are safe to commit, used by tests.
- `btx/` - small Bluebeam `.btx` tool-chest samples that are safe to commit.
- `zones/` - zone and sprinkler-layout JSON fixtures for the 4541 engine tests (format below).
- `private/` - the founder's real drawings and `.btx` files. Git-ignored, never committed.

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
