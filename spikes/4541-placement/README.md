# Spike A13 #2: NZS 4541 irregular placement

A working prototype of the head auto-placement algorithm (design `docs/4541-placement-design.md` §3) and its
independent checker (§4), plus a visual demo. Framework-free ES modules, no dependencies.

```
src/rules.js     rule set nzs4541 v1 as data (+ validation)
src/geometry.js  placer-side geometry kernel
src/placer.js    frame search × bay decomposition × row sweep with exact 1-D stabbing DP
src/oracle.js    independent checker: imports nothing, own kernel, own 100 mm lattice (phase 37/61 mm)
src/zones.js     25 sample zones (real mm)
src/site.js      composition layer (places zones in order, neighbours across open edges, then checks)
test/run.mjs     samples + seeded random zones + rotations + oracle mutations + NFR6 timing
build.mjs        inlines everything into dist/demo.html (oracle and placer stay separate <script> blocks)
demo/            template.html + app.js for the demo page
```

## Run

```
node test/run.mjs     # exit code 1 if any feasible zone has an oracle ERROR
node build.mjs        # writes dist/demo.html
```

## Results (last run, Node 24, Windows)

`hand` = design §5 hand-worked count, `LB` = ⌈area / Amax⌉. Distances in m, areas in m², `ms` = placement time.

```
zone                           haz  pattern heads hand LB  A/hd m² maxCell maxSp m minSp m maxWall minWall err warn frame  dec  ms    
------------------------------ ---- ----- ----- ---- --- ------- ------- ------- ------- ------- ------- --- ---- ------ ---- ------
Z1 Rectangle 10 × 6 m          OH1  rect  6     6    5   10.00   10.20   3.00    3.00    1.67    1.50    0   0    90.0   -    70.8  
Z1 Rectangle 10 × 6 m          ELH  rect  6     6    3   10.00   10.20   3.00    3.00    1.67    1.50    0   0    90.0   -    19.4  
Z2 L-shape                     ELH  rect  5     6    4   15.60   17.76   4.00    2.95    2.25    1.45    0   0    0.0    -    179.7 
Z2 L-shape                     OH1  rect  9     8    7   8.67    9.60    2.50    2.40    2.00    1.20    0   0    0.0    cutH 136.2 
Z3 Right triangle 8 × 6 m      ELH  rect  3     3    2   8.00    9.28    4.02    2.45    2.00    0.60    0   0    90.0   -    10.8  
Z3 Right triangle 8 × 6 m      OH1  rect  4     5    2   6.00    7.45    3.06    2.65    2.00    0.40    0   0    90.0   -    6.9   
Z4 Diagonal wall               ELH  rect  6     5    4   12.00   17.21   4.35    2.00    2.20    0.89    0   0    90.0   -    38.6  
Z4 Diagonal wall               OH1  rect  8     8    6   9.00    10.80   3.05    3.00    1.99    0.51    0   0    0.0    -    33.2  
Z4r Diagonal wall, rotated 30° ELH  rect  5     5    4   14.40   17.86   4.60    3.75    2.24    0.06    0   0    0.0    -    61.3  
Z4r Diagonal wall, rotated 30° OH1  rect  8     8    7   9.00    10.63   3.05    3.00    1.99    0.51    0   0    30.0   -    54.5  
Z5 Corridor 20 × 1.6 m         OH1  rect  5     5    3   6.40    6.40    4.00    4.00    2.00    0.80    0   0    90.0   -    8.5   
Z5 Corridor 20 × 1.6 m         ELH  rect  5     5    2   6.40    6.72    3.85    3.85    2.30    0.80    0   0    90.0   -    10.5  
Z5 Corridor rotated 45°        OH1  rect  5     5    3   6.40    6.56    4.00    4.00    2.00    0.80    0   0    45.0   -    41.4  
Z5 L-corridor 1.6 m            ELH  rect  7     -    3   6.95    7.36    4.60    4.00    2.30    0.80    0   0    90.0   cutH 246.4 
Z6 Hall with 3 columns         OH1  rect  18    15   13  8.34    9.07    2.61    2.30    2.00    1.20    0   0    0.0    -    168.3 
Z7 Room around a 4 m shaft     OH1  rect  14    -    11  9.14    9.60    2.40    2.05    2.00    0.90    0   0    0.0    cutH 175.6 
Z8 Noisy L (stair-step trace)  ELH  rect  5     6    4   15.60   17.87   4.00    2.95    2.28    1.43    0   0    0.0    -    750.7 
U-shape                        ELH  rect  8     -    5   13.00   13.52   3.33    3.00    2.05    1.67    0   0    90.0   cutH 181.7 
T-shape                        OH1  rect  10    -    9   10.00   10.00   2.50    2.50    2.00    1.25    0   0    0.0    cutH 200.3 
Meeting room, 45° splay        ELH  rect  4     4    2   9.31    9.72    2.70    2.70    1.80    0.95    0   0    90.0   -    7.1   
Corridor 18 × 2.5 m            ELH  rect  4     -    3   11.25   11.25   4.50    4.50    2.25    1.25    0   0    90.0   -    7.6   
Small office 3 × 2.8 m (1 head ELH  rect  1     1    1   8.40    8.40    -       -       1.50    1.40    0   0    90.0   -    1.3   
Irregular 8-sided room         OH1  rect  9     -    7   8.89    10.47   2.90    2.70    1.85    0.52    0   0    90.0   -    73.4  
Office floor with 6 columns    ELH  rect  20    -    15  15.49   19.31   4.54    2.20    2.30    1.00    0   0    90.0   -    937.7 
OPEN/OFFICE                    ELH  rect  6     -    6   18.00   18.00   4.00    3.58    2.25    2.00    0   0    0.0    -    42.7  
OPEN/KITCHEN                   OH1  rect  6     -    5   9.00    9.00    3.00    3.00    1.50    1.50    0   0    0.0    -    28.8  
Store room, staggered pattern  OH2  stagg 13    -    11  9.69    10.54   3.47    2.33    1.75    1.17    0   0    0.0    -    143.9 
Tiled office, 1200 × 600 grid  ELH  rect  6     -    4   11.52   14.04   3.60    2.40    2.10    1.50    0   0    0.0    -    96.0  
   note: tile stops 6/6
Z9 Tile room (required)        OH1  rect  4     -    4   10.80   10.80   3.00    3.00    1.80    1.50    0   0    90.0   -    27.0  
   note: tile stops 4/4, extra heads vs unaligned: 0
R1 Perimeter office L (387 m²) ELH  rect  34    -    19  11.32   18.60   4.55    2.40    2.30    0.60    0   0    90.0   cutH 4855.4
   note: tile stops 18/34
Z10 Too narrow (6 m × 90 mm)   ELH  -     0     -    -   -       -       -       -       -       -       -   -    -      -    0.9     -> NO_ADMISSIBLE_REGION: No point in this zone is 50 mm or more from every wall (zone narrower than 2 × Wmin = 100 mm). No heads placed.
Invalid outline (bow-tie)      ELH  -     0     -    -   -       -       -       -       -       -       -   -    -      -    0.1     -> INVALID_ZONE: Zone outline crosses itself (or a hole crosses the outline) at the marked point.
```

Also: 54 seeded random zones (24 rectilinear incl. staggered, 24 convex with slivers down to ~10°, 6 rotated
samples) all pass the oracle, max 2.3 s, mean 2.5 heads above the area bound. All 5 oracle mutations are caught
(deleted head, moved head, duplicate at 1.5 m, 30 mm from wall, too few heads → AREA_ZONE warning). The 200 m²
timing cases place in 85 / 534 / 194 ms (NFR6 ≤ 1 s). Output is deterministic (run twice, byte-equal).

## Hand counts recomputed against v1

v1 changes (Smin 1.8, Wmin 50 mm) did not change any count. Where the engine differs from the design's hand value:

- **Z2 ELH 5** (hand 6): better. One full-height row pair works without a cut.
- **Z3 OH1 4** (hand 5): better.
- **Z2 OH1 9** (hand 8), **Z4 ELH 6** (hand 5): one above hand. Z4r (the same room rotated 30°) finds 5, because its
  page-orthogonal frame happens to be a better frame for Z4. So rotation invariance (P2) holds for the oracle
  verdict but not for the count.
- **Z6 OH1 18** (hand 15): columns still block sight, so the points on top of and under each column must be seen
  from a row on that side within Rc. The engine puts rows at 2.0 / 4.5 / 7.0 m (edge offsets at Wmax), and the
  middle row is broken by the columns. The hand value of 15 assumed columns do not block sight.
- **Z10**: the design's 6000 × 150 mm zone is feasible with Wmin = 50 mm, so the sample uses 6000 × 90 mm.

## Weak spots (honest list)

- **Columns** (founder decision 2026-10-17, option a): columns block spray and need Wmin, but carry no Wmax rule.
  The 6-column office now matches the empty-room count (20). Z6 is 18 against 15. A column is recognised as a hole
  of at most 1 m extent; larger holes (the Z7 shaft) are real walls with Wmax. Explicit hole tagging
  (column / shaft) would be better in the product.
- **R1 (387 m²)**: 34 heads against LB 19, only 18/34 on tile centres in `preferred` mode, 4.9 s
  (the design called ≤ 1 s a stretch target here). The columns and the L split are the cause, and the row-set
  search is too narrow for big multi-column floors.
- **Row-set variants are few** (uniform, edge rows at Wmax, w_p offsets, tile-snapped for m_min..m_min+2). Column-aware row
  positions would help Z6 / R1.
- **Staggered** honours the half-offset lattice strictly, with free end heads near walls. That cost one head
  over rectangular in the sample (13 vs 12).
- **Tile `preferred`** uses a fixed cost per off-stop head. Count is never traded, so alignment can make spacing
  uneven (the tiled office has gaps of 2.4 / 3.6 m).
- No keep-outs (downlights, panel lights) and no reduced Wmax flag in the samples. The placer accepts
  `reducedWallDist` but nothing exercises it.
- The local-cell area check (C5) uses lattice cells assigned to the nearest visible head, not a clipped Voronoi.
  It is approximate to about ±0.1 m². It is a warning only.

## Deviations from the design (and why)

1. **Trace tolerance in the visibility test (new).** A sample within 50 mm of a wall is tested for sight lines
   from a probe pushed 50 mm into the room (the placer uses 40 mm, so it stays the stricter of the two).
   Without it, a 30 mm stair-step pocket in a traced outline can only be seen from heads directly above it. That
   is impossible to satisfy and physically meaningless. Coverage distance is still measured from the real point.
2. **μ is split.** Exact analytic limits (Smax, Wmax, Smin, Wmin) use 0.5 mm, so textbook layouts like
   Z5 (4.000 m spacing, 2.000 m end offsets) remain possible. Sampled reaches use 75 mm (coverage, 100 mm
   lattice) and 30 mm (wall samples, 50 mm step). The design's flat μ = 10 mm would force Z5 OH1 to 6 heads.
3. **Frames.** Each histogram angle is also tried turned 90°, because rows run along the frame x axis.
4. **Bays.** cutH / cutV come from a trapezoid slab decomposition merged wherever no vertex interrupts the
   boundary. That equals ray cuts from reflex vertices. Noisy outlines (> 40 vertices) are simplified (RDP 40 mm)
   for cutting only. Samples, clearance and sight lines always use the original polygon.
5. **Row DP demands** come from sample points (100 mm lattice, 50 mm boundary, both vertices of every edge) rather
   than the analytic interior windows. Inside "clean" band rectangles (no wall in the band) the rect-cell window
   S_rect/2 is used, which is exact and keeps rectangles at the textbook optimum. A sample a row cannot reach is
   carried to the next row. Samples the next row cannot reach at all are pulled into the current row. A variant
   where a row defers samples in a wall's shadow is also tried.
6. **Seams**: no Smin/2 clearance band. Each candidate is instead excluded if a visible, already-placed head is
   closer than Smin (exact H3). The same applies across open edges between zones, which are placed in order.
7. **Columns** (holes up to 1 m extent): block sight, need Wmin, no Wmax (founder decision 2026-10-17). They
   never cause bay cuts. Larger holes are walls. Both modules apply the 1 m threshold independently.
8. **gapFill** is up to 3 per bay, applied only to the 3 most promising row-set variants of a bay.
9. **No op-count budget yet.** Search size is bounded by the variant counts instead.
10. **Bow-tie** is caught by the self-intersection check (no Clipper2 repair in the spike).

## Demo

`dist/demo.html` is one self-contained page (Inter from Google Fonts is the only external request). It contains:

- a sample list with pass / warn / fail chips;
- a plan drawn to scale with a scale bar, tile grid, columns, open edges (dashed) and a coverage overlay
  (circle or square);
- a report panel with rule figures, extremes, timings, and checker findings pinned on the plan;
- hazard / pattern / preference controls;
- head dragging with a live re-check (moved heads stay on re-run);
- "Draw zone" (100 mm snap).
