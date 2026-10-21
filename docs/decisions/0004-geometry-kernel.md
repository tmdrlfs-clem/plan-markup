# 0004: Geometry kernel for the 4541 engine (Epic 9)

Date: 2026-10-22
Status: accepted (pin recommendation; installed by Epic 9)

## Context

The design (`docs/4541-placement-design.md` §3.6) uses Clipper2 for zone preparation: repair of
self-intersecting outlines, polygon booleans (outer minus holes, zone unions), inward offsets
(admissible region, keep-out clearance in Epic 9) and point-in-polygon, all in integer mm. The
architecture deferred the choice of the JS binding to the placement spike (architecture.md,
"Clipper2 JS binding: choose and pin at the placement spike"). The engine runs in a Web Worker
(NFR6), and the app ships a strict nonce CSP (ADR 0003).

The spike (`spikes/4541-placement/src/geometry.js`) has its own small kernel: signed area,
orientation, point-in-ring, segment distance, rotation, cleaning, RDP simplification, a convexity
test, self-intersection detection, row/ring interval cuts and a segment grid index (clearance and
sight lines). It has **no** polygon booleans, no offsetting and no self-intersection repair: the
spike rejects a bow-tie with `INVALID_ZONE` instead of repairing it, and tests the admissible
region by probing instead of offsetting.

## Options evaluated (2026-10-22)

Each candidate was installed in a scratch folder (not in this repo) and run inside a Node
`worker_threads` worker on the R1 sample (L-shape with six 600 mm columns): difference
(outer − holes), inward offset by Wmin (50 mm, miter), bow-tie union repair, point-in-polygon
and simplification, twice for determinism, then 200 times for timing.

| Package | Version | Licence | Kind | Size (min + gzip) | Last release | Downloads / month | Result |
|---|---|---|---|---|---|---|---|
| `clipper2-ts` | 2.0.1-18 | BSL-1.0 | pure TypeScript port of Clipper2 2.0.1, ESM, `sideEffects: false`, no runtime deps | ≈ 34 KB (`dist/clipper2.min.mjs` 125 KB raw), tree-shakeable | 2026-07-04 | ≈ 325 k | all operations correct; integer coordinates in and out; deterministic (byte-equal runs); 0.2 ms per run; loads in 7 ms in a worker |
| `clipper2-wasm` | 0.4.0 | BSL-1.0 | Emscripten build of the C++ library | ≈ 14 KB JS + 82 KB wasm | 2026-05-18 | ≈ 61 k | works in a worker after async init (≈ 31 ms); embind objects need manual `delete()`; needs `'wasm-unsafe-eval'` in the CSP |
| `clipper2-js` | 1.2.4 | BSL-1.0 | older TS port (Clipper2 1.x) | ≈ 19 KB after minifying (34 KB gzip unminified) | 2024-01-01 | ≈ 33 k | unmaintained since 2024; superseded by `clipper2-ts` (same lineage) |
| `clipper-lib` | 6.4.2 | BSL-1.0 | Clipper **1** (6.4) JS | ≈ 25 KB | 2022 | ≈ 375 k | widely used but Clipper1 (older API, slower, no Clipper2 fixes), unmaintained; no reason to start on it |
| spike kernel | — | ours | plain JS | ≈ 3 KB | — | — | no booleans / offset / repair (see above) |

Measured on R1: region area 384.84 m² (387 m² outer − 6 × 0.36 m² columns), Wmin-inset area
378.87 m², bow-tie repaired into two 6 m² triangles, point-in-polygon `IsInside` / `IsOn` as
expected, all result coordinates integers.

## Decision

- **Pin `clipper2-ts` at exactly `2.0.1-18`** for Epic 9 (`src/core/geometry/clipper2` adapter,
  architecture.md). The version string is a semver pre-release of the port; it is the package's
  `latest` tag and passes `check:pinned` (exact versions only). Installing it is Epic 9's job;
  this story does not change `package.json`.
- Why: pure JS (no async init, no `'wasm-unsafe-eval'` CSP exception, no manual memory
  management), runs unchanged in a Web Worker and under Vitest, integer `Point64` coordinates
  (mm) and deterministic output, the most-used and actively maintained Clipper2 port, and small
  enough to load with the engine worker chunk. Speed is not a deciding factor: prep runs once per
  placement and costs well under 1 ms per zone, while placement takes 10–1000 ms.
- **Keep the spike's sampling / visibility code** (segment grid index, row intervals, rotation,
  RDP for bay cutting) as the placer's own kernel in `src/core/sprinkler/place/*`: Clipper2 has no
  sight-line or clearance queries. Clipper2 replaces only booleans, offsets, repair and
  point-in-polygon in `prep/*`.
- **The oracle keeps its own kernel** and must not import Clipper2 or the placer kernel
  (design §4, ESLint `PLACER_BAN`; Epic 9 extends the ban to `clipper2-ts`). The oracle needs
  only point-in-ring, segment distance, sight lines and areas, which it already has.
- Adapter rules for Epic 9: convert PDF user space → integer mm once in `prep`; use
  `FillRule.NonZero`; miter joins with limit 2 for insets of rectilinear walls (round joins for
  keep-out clearance discs); never let `clipper2-ts` types leak past the adapter.

## Consequences

- Bow-tie and other self-intersecting traces can be repaired by a union (design §3.6) instead of
  rejected; a still-invalid result keeps `INVALID_ZONE` with a location.
- Keep-outs (downlights, panel lights) become an inset/outset + difference in `prep` (Epic 9).
- Licence: BSL-1.0 is permissive. Its notice exemption covers only machine-executable object
  code, and a minified JS bundle is not clearly that, so list the licence text in the
  third-party notices with the other dependencies.

## Revisit

If `clipper2-ts` stops being maintained or a correctness bug appears, `clipper2-wasm` is the
fallback behind the same adapter (accept the CSP `'wasm-unsafe-eval'` exception and async init).
