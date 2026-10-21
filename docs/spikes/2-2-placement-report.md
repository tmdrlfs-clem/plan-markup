# Spike 2.2 — irregular-zone placement (close-out)

Story: `_bmad-output/implementation-artifacts/2-2-spike-close-out-irregular-zone-placement-fable.md`
(A13 risk spike #2). Question: does the placement algorithm of `docs/4541-placement-design.md` §3
(frame search × bay decomposition × row sweep with an exact 1-D stabbing DP), checked by the
independent oracle of §4, place valid NZS 4541 layouts in irregular zones fast enough for NFR6?

**Status (2026-10-22): yes for the 200 m² target and every sample zone; large multi-column floors
are valid but heavy and slow. Decision: go, with the Epic 9 changes listed below.**

Prototype: `spikes/4541-placement/` (plain JS, outside `src/`, not wired into the app). Rule figures:
`src/rules.js`, set `nzs4541` v1 (DRAFT figures, unchanged by this story: ELH Amax 21 m², Smax 4.6 m,
Wmax 2.3 m; OH1–3 Amax 12 m², Smax 4.0 m, Wmax 2.0 m; all Smin 1.8 m, Wmin 50 mm).

## Method

1. The 25 samples (26 zones) are the zone fixtures in `fixtures/zones/*.json` (format in
   `fixtures/README.md`), written by `spikes/4541-placement/export-zones.mjs`. The suite and the
   demo read only these files.
2. `node spikes/4541-placement/test/run.mjs` places every sample (and its extra hazard classes) with
   the placer, checks it with the oracle (which imports nothing), and fails on any oracle error on a
   feasible zone, on an infeasible zone without its located error code, or on a fixture lower bound
   that differs from the oracle's area. It also runs 54 seeded random / rotated zones, 5 oracle
   mutations, 6 column-rule checks, an in-process determinism check and the NFR6 timing cases.
3. Machine: Windows 11, Node 24.15.0, single thread (no worker). Timings vary by ±30 % between runs
   on this machine; the figures below are from two consecutive runs.

## Column rule (founder decision 4, 2026-10-17)

Holes now carry an explicit tag, `{ kind: 'column' | 'shaft', ring }`, in the fixtures and in both
modules. Placer and oracle each read the tag independently:

- `column`: blocks spray (sight lines), needs `Wmin` clearance, no `Wmax` on its faces, never cuts
  bays.
- `shaft` (shafts, voids): a real wall (sight, `Wmin`, `Wmax`) that cuts bays.
- An untagged ring falls back to the old heuristic (column if its largest extent is ≤ 1 m), in each
  module separately.

Checks in the suite (all pass):

| Check | Result |
|---|---|
| Z6 (3 columns) places ≤ 18 heads with zero oracle errors | 18 heads, 0 errors |
| Column-face `Wmax` mutation (heads right of column 1 deleted) is not flagged | 0 `WALL_DIST` on the column faces; the same layout with the holes tagged `shaft`: 6 |
| Head 30 mm from a column face | `WALL_CLEARANCE` error |
| Z7 shaft faces keep `Wmax` (heads near the shaft pushed 600 mm away) | 2 `WALL_DIST` on the shaft faces; same hole tagged `column`: 0 |
| Untagged 600 mm holes (Z6) / untagged 4 m hole (Z7) | same counts as tagged (18 / 14) |

**Z6 = 15 is not reached (18).** The design's hand count of 15 (§5) assumed that small holes do not
block sight (the old §3 table). Without the columns the engine finds exactly 15 (3 × 5). With
columns that block spray, a point just above a column's top face can be seen only by a head above
the face line, within Rc = 2.5 m (OH1), so some head must sit at y ≤ 7.3 m; the same holds below.
Points beside the columns on the column line are more than Rc from rows that keep within Wmax of the
outer walls, so a middle row is needed as well. The best row sets the placer finds cost 18. 15 looks
infeasible under decision 4, but this is an argument, not a proof (see questions).

## Results

`hand` = design §5 hand count, `LB` = ⌈area / Amax⌉, `ms` = placement time (run 2 of 2; run 1 in
brackets where it differs by more than 30 %). All feasible zones: 0 oracle errors, 0 warnings.

| Zone | Haz | Heads | Hand | LB | Max NN spacing m | Max wall dist m | Frame / bays | ms |
|---|---|---|---|---|---|---|---|---|
| Z1 Rectangle 10 × 6 m | OH1 | 6 | 6 | 5 | 3.00 | 1.67 | 90° / – | 56 |
| Z1 Rectangle 10 × 6 m | ELH | 6 | 6 | 3 | 3.00 | 1.67 | 90° / – | 31 |
| Z2 L-shape | ELH | 5 | 6 | 4 | 4.00 | 2.25 | 0° / – | 182 |
| Z2 L-shape | OH1 | 9 | 8 | 7 | 2.50 | 2.00 | 0° / cutH | 191 |
| Z3 Right triangle 8 × 6 m | ELH | 3 | 3 | 2 | 4.02 | 2.00 | 90° / – | 10 |
| Z3 Right triangle 8 × 6 m | OH1 | 4 | 5 | 2 | 3.06 | 2.00 | 90° / – | 12 |
| Z4 Diagonal wall | ELH | 6 | 5 | 4 | 4.35 | 2.20 | 90° / – | 25 |
| Z4 Diagonal wall | OH1 | 8 | 8 | 6 | 3.05 | 1.99 | 0° / – | 25 |
| Z4r Diagonal wall, rotated 30° | ELH | 5 | 5 | 4 | 4.60 | 2.24 | 0° / – | 49 |
| Z4r Diagonal wall, rotated 30° | OH1 | 8 | 8 | 7 | 3.05 | 1.99 | 30° / – | 71 |
| Z5 Corridor 20 × 1.6 m | OH1 | 5 | 5 | 3 | 4.00 | 2.00 | 90° / – | 14 |
| Z5 Corridor 20 × 1.6 m | ELH | 5 | 5 | 2 | 3.85 | 2.30 | 90° / – | 8 |
| Z5r Corridor rotated 45° | OH1 | 5 | 5 | 3 | 4.00 | 2.00 | 45° / – | 31 |
| Z5L L-corridor 1.6 m | ELH | 7 | – | 3 | 4.60 | 2.30 | 90° / cutH | 244 |
| Z6 Hall with 3 columns | OH1 | 18 | 15 | 13 | 2.61 | 2.00 | 0° / – | 494 (586) |
| Z7 Room around a 4 m shaft | OH1 | 14 | – | 11 | 2.40 | 2.00 | 0° / cutH | 209 |
| Z8 Noisy L (stair-step trace) | ELH | 5 | 6 | 4 | 4.00 | 2.28 | 0° / – | 750 |
| U-shape | ELH | 8 | – | 5 | 3.33 | 2.05 | 90° / cutH | 187 |
| T-shape | OH1 | 10 | – | 9 | 2.50 | 2.00 | 0° / cutH | 215 |
| R2 Meeting room, 45° splay | ELH | 4 | 4 | 2 | 2.70 | 1.80 | 90° / – | 7 |
| Corridor 18 × 2.5 m | ELH | 4 | – | 3 | 4.50 | 2.25 | 90° / – | 7 |
| Small office 3 × 2.8 m | ELH | 1 | 1 | 1 | – | 1.50 | 90° / – | 1 |
| Irregular 8-sided room | OH1 | 9 | – | 7 | 2.90 | 1.85 | 90° / – | 59 |
| Office floor with 6 columns (311 m²) | ELH | 20 | – | 15 | 4.54 | 2.30 | 90° / – | 1073 (963) |
| Open plan / office | ELH | 6 | – | 6 | 4.00 | 2.25 | 0° / – | 25 |
| Open plan / kitchen | OH1 | 6 | – | 5 | 3.00 | 1.50 | 0° / – | 21 |
| Store room, staggered | OH2 | 13 | – | 11 | 3.47 | 1.75 | 0° / – | 54 |
| Tiled office, 1200 × 600 preferred | ELH | 6 (6/6 on tile stops) | – | 4 | 3.60 | 2.10 | 0° / – | 43 |
| Z9 Tile room, required | OH1 | 4 (4/4, +0 vs unaligned) | – | 4 | 3.00 | 1.80 | 90° / – | 25 |
| R1 Perimeter office L (387 m²) | ELH | 29 (15/29 on tile stops) | – | 19 | 4.55 | 2.30 | 90° / cutH | 4139 (3810) |
| Z10 Too narrow (6 m × 90 mm) | ELH | `NO_ADMISSIBLE_REGION`, located | – | – | – | – | – | 0.4 |
| Bow-tie outline | ELH | `INVALID_ZONE`, located at the crossing | – | – | – | – | – | 0.1 |

Against the 17 hand counts: equal on 11, better on 3 (Z2 ELH 5 vs 6, Z3 OH1 4 vs 5, Z8 ELH 5 vs
6), worse on 3: Z2 OH1 9 vs 8 and Z4 ELH 6 vs 5 (Z4r, the same room rotated, finds 5: the
frame chosen for Z4 is not the best one; rotation invariance holds for the oracle verdict, not for
the count), and Z6 18 vs 15 (column rule, above).

Other suite results (both runs identical apart from timing):

- **200 m² NFR6 cases (≤ 1 s):** rectangle 20 × 10 OH1 18 heads in 41–49 ms, L ELH 16 heads in
  229–247 ms, 7-gon OH2 22 heads in 63–69 ms. Oracle check 34–53 ms each.
- **54 seeded random / rotated zones:** 0 failing, max 914–1213 ms, mean 2.46 heads above the area
  lower bound (max 7).
- **Oracle mutations:** all 5 caught (deleted head, moved head → `UNCOVERED`; duplicate at 1.5 m →
  `MIN_SPACING`; head 30 mm from a wall → `WALL_CLEARANCE`; too few heads → `AREA_ZONE` warning).
- **Determinism:** the suite's in-process check passes, and the head lists of all 26 zones were
  byte-equal across two separate processes.

## Changes made in this story

- Explicit hole tags (above) in placer, oracle, fixtures and demo.
- **Column-aware row variants** (placer): when a row of the uniform row set (m or m + 1 rows) runs
  through a column band (column y-extent ± Wmin), the row is moved 300 or 700 mm clear of the band,
  above or below, and the other rows are re-spread evenly or with the wall rows at Wmax; with a
  tile grid each variant is also tried snapped to tile-stop lines. **R1: 34 → 29 heads.** Z6 and the
  6-column office are unchanged (18, 20).
- **Exact pruning** of row-set variants: once a variant resolves every sample with n heads, the
  sweep of any later variant stops as soon as it needs more than n heads (it can never win, since
  bays rank unresolved samples first, then heads). Results are unchanged.
- `spikes/4541-placement/package.json` (`"type": "module"`) removes Node's
  `MODULE_TYPELESS_PACKAGE_JSON` warning.
- Tried and reverted (not worth it): more gap distances (100–1000 mm) and row counts up to m + 2 for
  the column variants (no better count, up to 2× runtime); "column pocket" gap-fill heads on lean row
  sets (R1 27 heads, but 8 s and 0 heads on tile stops).

## Known weak cases (cause → proposed Epic 9 fix)

1. **Large multi-column floors (R1: 29 heads vs LB 19, 3.4–4.1 s; was 34 heads in ≈ 2.5 s).**
   Cause: R1's perimeter columns stand 1.2 m off the walls. The 0.9 m strip between a column and
   its wall is in the column's shadow from any row on the room side, so a row model needs an extra
   row along the whole 30 m wall (or rows turned 90°) to see into four or five short pockets.
   Without the columns the same zone takes 20 heads (LB 19). Runtime: every bay with a column is
   not "fast", so each sample's sight line to each row is computed from the wall index for every
   row-set variant (`visibleRun` is ≈ 40 % of the time in a CPU profile), and the column variants double the
   variant count.
   Fix: (a) **column pockets as first-class candidates**: before the row sweep, find column-to-wall
   gaps narrower than 2 × Wmax and give each one local candidate heads (tile-snapped) that the DP of
   the nearest row may use, instead of the bounded gap-fill; (b) **bay decomposition at column
   lines** for floors with several columns, so each bay picks its own frame and row set; (c)
   **visibility memo per (sample, row y)** within a frame, typed arrays for samples, and the planned
   op-count budget with a best-so-far answer (design §3.8), run in the engine worker. Target: R1
   ≤ 23 heads, ≤ 1 s.
2. **Staggered costs one head (store room 13 vs 12 rectangular).** Cause: the odd row sits on the
   half-offset lattice of the first row, so in a 14 m room its midpoints leave 3.5 m to each end
   wall and it needs two free end heads (n + 1 heads). With n heads in both rows the end walls would
   need (n − 1.5) × S ≥ L − 2 Wmax, i.e. S ≥ 4.0 m here, which is Smax itself. So the extra head is
   inherent to staggering this room at these figures, not a search failure.
   Fix: let the stagger pair choose its spacing S (and phase) so that (n − 1.5) S ≥ L − 2 Wmax when
   possible, else accept n + 1 and report "staggered: +1 head vs rectangular" in the zone report,
   the way `required` tile mode reports its extra heads.
3. **Tile-alignment spacing skew (tiled office: gaps 2.4 / 3.6 m instead of 3.2 / 3.2 m; R1 only
   15 / 29 heads on tile stops, design target ≥ 90 %).** Cause: `preferred` mode adds a fixed cost
   per off-stop head and never trades count; equal gaps are only a secondary squared-deviation
   term that the stop cost dominates, so an all-on-stop set with uneven gaps wins. On R1 the
   column-aware rows are often not on tile-stop lines, and count wins over alignment.
   Fix: in the DP cost, weight gap evenness above a single stop miss and prefer the most even
   stop set (for example 0.6 / 4.2 / 7.8 m, gaps 3.6 / 3.6 m, in the 9.6 m tiled office), and add the
   column-pocket candidates on tile stops. Show "on tile stops x / n" in the report and let the
   founder decide whether alignment may cost a head (question 2).
4. **Keep-outs not implemented.** The R1 panel lights and R2 downlights from design §5 are in the
   fixtures as data, but the spike's placer and oracle ignore them. Fix (Epic 9): keep-outs become
   an outset (Clipper2, ADR 0004) subtracted from the admissible candidate set in `prep`, and an
   oracle check that no head lies inside a keep-out plus clearance.
5. **Frame choice is greedy per zone** (Z4 finds 6 where its rotated copy finds 5). Fix: also try
   the frame of each long edge's perpendicular (cheap), and let bays choose frames independently
   when cuts exist.
6. **Local cell area (C5) is approximate** (lattice cells assigned to the nearest visible head,
   ±0.1 m²). It is a warning only. Fix: clipped Voronoi cells in the oracle, as designed.

## Deviations from `docs/4541-placement-design.md`

1. **Hole tags replace the small-hole threshold.** Design §3 table ("Small holes do not block
   visibility") and the §2 "small-hole threshold" input are superseded by decision 4; the spike
   keeps the 1 m threshold only for untagged rings.
2. **Z6 expected count** (§5): 15 assumed non-blocking columns; under decision 4 the engine places
   18 and the suite guards ≤ 18 instead of = 15.
3. **No Clipper2 in the spike:** a bow-tie is rejected with `INVALID_ZONE` at the crossing instead
   of repaired by a union (§3.6); the admissible region is probed, not offset. ADR 0004 pins
   `clipper2-ts` for Epic 9.
4. **R1 targets** (§5): oracle passes, but 15 / 29 on tile stops (target ≥ 90 %) and 3.4–4.1 s
   (stretch target ≤ 1 s). Count vs unaligned: 29 vs 29 (target ≤ +15 %: met).
5. **Column-aware row variants and exact pruning** are additions not in §3.
6. Unchanged from the first spike round (details in `spikes/4541-placement/README.md`): trace
   tolerance for sight lines (new), split μ, frames also turned 90°, bays from merged trapezoid
   slabs, row demands from sample points, no Smin/2 seam band, gap-fill limits, no op-count budget.

## Geometry kernel

`clipper2-ts` 2.0.1-18 (BSL-1.0, pure TS, ≈ 34 KB gzip, runs in a worker, integer mm,
deterministic) for booleans, offsets and repair in `prep`; the placer keeps its own sampling and
visibility kernel; the oracle keeps its own kernel. See `docs/decisions/0004-geometry-kernel.md`.

## Decision

**Go.** Epic 9 implements the §3 algorithm as prototyped, with: hole tags in the zone model,
the column-aware row variants and pruning from this story, the column-pocket candidates and
column-line bays (weak case 1), Clipper2 prep with keep-outs (4), a stagger-spacing choice (2), a
tile-evenness cost (3), and the zone fixtures as the shared test corpus. The 200 m² target is met
with a wide margin; large multi-column floors need weak-case fix 1 before R1 can meet ≤ 1 s.

## Questions for the founder

_Deferred by the founder on 2026-10-22: answer before Epic 9 stories 9.4–9.7 start. Until then the suite keeps Z6 ≤ 18 and the engine treats columns as blocking spray (decision 4)._

1. **Z6 with columns that block spray:** 18 heads (15 without columns). Is it right that coverage
   just above and below each column face must come from a head that can see it, or does 4541
   practice let a small column's shadow be ignored (which would give 15)?
2. **Tile alignment vs count:** on R1 a fully tile-aligned layout costs more heads. May
   `preferred` mode spend heads for alignment (and how many), or is count always first?
3. **Columns close to a wall:** R1's columns are 0.9 m from the perimeter wall. Should a column
   that close to a wall be drawn as part of the wall (a pier, no pocket to cover), or must the
   pocket behind it be covered like any other floor area?
4. **Staggered pattern:** is "+1 head vs rectangular, reported" acceptable, or should staggered
   be refused when it costs heads?
