# Prior Art: Sprinkler Shop Drawing Drafter (user's own earlier attempt)

Location: `C:\bluebeam\tool` (user-authored; free to reuse). Single-HTML,
client-side app, pdf.js 3.11.174 + pdf-lib 1.17.1, no upload. `src/core` = pure
logic with node:test suite via vm sandbox; `src/ui` = DOM/canvas.

User verdict (2026-10-16): **NZS 4541 auto head placement did not work → drop.
Everything else is worth porting. Dynamic fill works well.**

## Port (high value)

| Module | What it does | Port notes |
|---|---|---|
| `core/60-fill.js` | **Dynamic fill**: luminance mask of rendered page → live chamfer-distance flood from cursor (hold/drag), paint/erase brush, stroke undo, gap closing, hole fill, diagonal closing, boundary trace, RDP simplify → polygon + area. Measure lines burn in as barriers. Leak detection (>80% page). | Core of our Area/Dynamic Fill measurement. Keep algorithms; replace globals (`state`, `page()`, `toast`, `draw`) with injected deps. Move to Web Worker for big pages. |
| `core/20-scale.js` | Scale auto-detect from page text (`1:50`, `1:50 @ A1`, `SCALE 1/100 AT A3`), A-series reissue conversion by exact √2 steps, dedupe of equivalent ratios, source shown. | Feeds our Calibrate dialog as "Detected" preset. Always suggest verify with known dimension (F4). |
| `core/30-vectors.js` | Extract PDF vector segments (≤400k) + closed shapes, spatial grid index, **snap**: endpoint / midpoint / intersection / on-line. | Snapping for all markup + measure tools. |
| `core/40-geometry.js` | area (shoelace), centroid, perimeter, point-in-poly, dist to seg/poly, convex hull, min-area rect. | Direct reuse. |
| `ui/10-render.js` | Base raster at fixed width + **sharp detail re-render of visible region at high zoom** (≤36 MP); measurement drawing; ortho (Shift) snap; legend layout; one symbol renderer shared by screen/legend/PDF. | Rendering strategy matches Winston's tiling advice. Rule: measurements use base coords, never the detail render. |
| `ui/50-exports.js` | PDF export via pdf-lib (draws onto original pages, converts viewport→PDF points), CSV exports (rooms/heads/measures/devices), PNG, JSON. | Basis of our Export/Flatten. |
| `ui/60-files.js` | Save/load work as JSON (PDF bytes base64), drag-drop open, page nav. | Pattern for markup-set serialization. |
| `core/10-state.js` | Device library = legend rows (group, label, long description, symbol shape/letter/colour). Undo snapshots. Coords stored in render px, mm only on display. | Device library ≈ our Tool Chest item model + **auto legend** (already implemented here). |

## Drop

- `core/50-layout.js` auto head layout (grid/nudge/repair/prune/pull, tile detection) — user: didn't work in practice.
- `core/70-checks.js` rule checks + `DEFAULT_RULES` placeholders — NZS 4541 out of MVP.
- Ceiling tile / obstruction / hazard-class room model.

## Lessons carried over (from its CLAUDE.md)

- Logic in pure modules with tests that run the shipped code; every bug gets a named test.
- Vectors load after first render — anything derived must re-run when they arrive.
- Some PDFs embed architecture as an image (no vectors) → snapping/fill must degrade gracefully.
- Store coordinates in one canonical space; convert to mm only for display.
- Say where a scale came from; printed ratio is only right at original sheet size.
