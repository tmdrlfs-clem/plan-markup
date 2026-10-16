# 4541 Engine: Sprinkler Head Auto-Placement Design

Status: DRAFT, founder answers applied 2026-10-16. Design only, no production code.

> **Founder decisions (2026-10-16)** — these override anything below that disagrees:
> 1. `Wmax`: ELH **2.3 m**, OH1–3 **2.0 m** (founder-confirmed). `Wmin` = **50 mm** (all classes). `Smin` = **1.8 m** (all classes).
> 2. Area per head over `Amax` (zone or local cell) is a **warning**, never an error — in the app report and in tests (tests assert the warning is raised, not that placement fails).
> 3. **Staggered layouts are allowed as a user option** per zone (`pattern: 'rectangular' | 'staggered'`, default rectangular). See §3.10.
> 4. **Columns block spray and need clearance, but are not walls for `Wmax`** (revised 2026-10-17 after the placement spike): every column is a hole in the zone; visibility (spray shadow) and `Wmin` clearance apply to column faces; the maximum wall distance `Wmax` does **not** apply to column faces (only to real walls and zone edges). Coverage behind a column must still be reached by some head. No size threshold. Holes are tagged explicitly as `column` or `shaft/void` in the product (the spike uses a ≤1 m extent heuristic); shafts/voids remain real walls with `Wmax`. (The spike's first version applied `Wmax` to columns and needed 20 heads in Z6 vs 15.)
> 5. Ceiling-grid stop default = **tile centre** (mode `preferred` by default). Thirds remain a later option.
> 6. Zones that touch without a wall are **checked across the shared edge** (coverage, min spacing, max spacing).
> 7. `Amax` ELH 21 / OH 12 m² and `Smax` ELH 4.6 / OH 4.0 m — **founder-confirmed**. All placement figures are now verified (`nzs4541` v1, `verified: true`).
Scope: FR70–FR79, NFR6 (performance), NFR9 (verifiability), assumptions A7/A8.
Inputs read: PRD, architecture (steps 1–3), `docs/prior-art-sprinkler-drafter.md`,
prototype `C:\bluebeam\tool\src\core\{40-geometry,50-layout,70-checks}.js` and its
tests, and the two sample RCPs (L17, L21).

> **Reference corrections for the PRD.** (1) The 4541 performance budget is **NFR6**
> (single zone ≤200 m² in ≤1 s; 600 m² floor of ≤15 zones in ≤5 s). NFR3 is the 50 ms markup
> feedback budget. (2) A8 says "reuse the prototype `audit()` as the oracle". This design
> **advises against that** (§0, F1). The oracle must be independent. A8 should change to
> "independent oracle per §4 of this document".

---

## 0. Lessons from the prototype (what went wrong, concretely)

The prototype tests (`layout.test.mjs`) cover 8 shapes × 2 hazards and they pass. The founder
still says auto-layout "didn't work in practice". Reading the code explains why both can be true:

| # | Failure in the prototype | Where | Consequence |
|---|---|---|---|
| F1 | **The oracle is the engine.** `audit()` calls `roomSamples`, `uncoveredSamples`, `covModel`, `roomFrame(...).ang`: the same sample lattice, coverage predicate and grid angle that placement uses. | `layout.test.mjs` `audit()` | A bug shared by the engine and the checker can never show up. Tests stay green while the field result is wrong. |
| F2 | **The pipeline is a chain of heuristics that undo each other:** grid → nudge → greedy repair → prune → pull → tile snap. Each stage can break what the previous one achieved, and each has a silent `guard` bail-out (`<40`, `<200`, `<300`). | `autoHeads`, `repairCoverage`, `pullHeads` | When a guard trips there is no error, only missing coverage. Results are hard to predict. |
| F3 | **Greedy repair drops heads at uncovered sample points** (`tier:3`), off the grid. Prune then removes grid heads instead. | `repairCoverage`, `pruneHeads` | Heads end up scattered and not installable on straight branch lines. A designer moves them all by hand. |
| F4 | **One grid from one frame for the whole room.** Grid points outside the polygon are walked back inside along the axes for up to `maxWallDist`. | `autoHeads.nudge` | L-shapes, wedges and legs get heads clumped against walls, which then fail min spacing, which the repair cannot fix (min-spacing blocks every candidate). |
| F5 | **The coverage model depends on the engine's chosen angle** (square model in `ang`). The circle model uses `Smax/2·√2` whatever the area limit. Wall distance is checked through the coverage model, not as perpendicular distance. Area per head is room-level only. | `headCovers`, `analyse` | The rules are conflated. A layout can "pass" with a local cell far above the area limit. |
| F6 | **Tile grid and fittings auto-detected from vectors** (period coherence, "patterned" rule, closed-shape occupancy). Heads are snapped to tiles after layout. | `detectTiles`, `tileOccupancy`, `snapToTiles` | Fragile on real RCPs (~170k path ops, hatching, 45° feature linework). The code's own comment says "nudging finished heads never works". |
| F7 | **Render-pixel coordinates with a global `mmPerPx()`.** Caches are keyed on float signatures. Hidden global state (`page()`, `state`). | everywhere | Results depend on render state and cache history, so they are hard to reproduce. |
| F8 | **The sample lattice gets coarser on big rooms** (`>40000` samples → bigger step). | `roomSamples` | Coverage resolution degrades silently exactly where it matters (big plates). |
| F9 | **Traced polygons are noisy** (stair steps from dynamic fill). The dominant-angle code is a workaround. | `dominantAngle` | Frame choice and wall sampling are sensitive to tracing noise. |
| F10 | **Test zones are friendly:** exact mm values, no perturbation, no rotation sweep, no property tests, no mutation tests of the checker. | tests | Real-world inputs (noise, odd angles, holes) were never exercised. |

Design rules that follow, and are used throughout:
1. **Oracle independence.** Separate module, separate sample set, separate predicate implementation, no imports from placement code, layout frame never an input (§4).
2. **One structured solve with hard constraints.** No post-hoc repair stages. When the solve is infeasible, the engine returns a **typed, located failure**, never a silent shortfall.
3. **Heads live on branch lines (rows)** except explicitly labelled exceptions, which are reported to the user.
4. **Rules are separated:** coverage, perpendicular wall distance, spacing and per-head area are distinct checks.
5. **Tile grid is user-declared** (two clicks plus pitch). Auto-detection may later *suggest* a grid but never decides alone. Tile stops are candidate positions *inside* the solve, never a post-snap.
6. **Pure functions in real units** (mm, zone-local frame). No caches in core. Deterministic.

---

## 1. Problem statement

### 1.1 Inputs (per zone)

| Input | Form | Notes |
|---|---|---|
| Zone region `Z` | outer ring + hole rings, PDF user space | From dynamic fill (FR70) or polygon. Holes = columns, shafts, voids. |
| Calibration | page affine PDF-pt → mm (`sx`, `sy`, optional rotation) | Per page (architecture). Converted once at entry. Non-uniform `sx≠sy` is supported because conversion is affine. |
| Hazard class + rule set | `ELH`/`OH1`/`OH2`/`OH3`, rule-set id + version | From use → hazard mapping (FR71/72). The layout stores the rule version (A7). |
| Preferences (FR74) | preferred spacing `s_p`, preferred wall distance `w_p` | Clamped into rule limits. |
| Frame override | optional angle | Otherwise the engine picks one (§3.2). |
| Ceiling grid | optional `{angle, pitchU, pitchV, originU, originV, stops, mode}` | `mode: 'off' | 'preferred' | 'required'`. User-declared. |
| Keep-outs | optional polygons + clearance | Light fittings, grilles (manual in M2, as the PRD says). |
| Locked heads | points | Heads the user moved or added (FR76). Kept fixed on re-run. |
| Small-hole threshold | mm, default 1000 | Holes with max dimension ≤ threshold do not block spray visibility (columns). Founder question Q4. |

### 1.2 Outputs

- `heads[]`: points in PDF user space, each with `zoneId`, `kind: 'row' | 'offsetRow' | 'gapFill' | 'locked'`, `rowId`.
- `ZoneLayoutReport` (FR77): hazard, rule version, count, area, area per head (zone average **and** max local cell), min and max spacing, worst wall distance, min wall distance, coverage (sampled, with gap polygons), tile-alignment share, chosen frame and decomposition, flags with severity and head ids, `rulesVerified` flag (FR78 banner).
- On failure: `{ok:false, code, where: polygon|point, message}`, for example `NO_ADMISSIBLE_REGION` (zone narrower than 2·Wmin) or `UNCOVERABLE_PIECE`.

### 1.3 Hard constraints (engine must satisfy; oracle verifies)

With rule figures `Amax, Smax, Smin, Wmax, Wmin` (§2) and **coverage radius**
`Rc = ½·√(Smax² + (Amax/Smax)²)`, the half-diagonal of the largest compliant rectangular cell:

- **H1 Coverage:** every point `p ∈ Z` has a *visible* head `h` with `|p−h| ≤ Rc`. Visible means the segment p–h does not cross the zone boundary or a large hole.
- **H2 Wall distance:** every boundary point `q` (outer ring and large holes) has a visible head with perpendicular distance to q's wall line ≤ `Wmax` and `|q−h| ≤ Rc`.
- **H3 Min spacing:** every visible pair of heads is ≥ `Smin` apart.
- **H4 Max spacing:** every head with ≥1 visible peer has its nearest visible peer at ≤ `Smax`.
- **H5 Area per head (WARNING, not hard):** zone `area / count ≤ Amax`, and each head's local cell (Voronoi cell ∩ Z, visibility-clipped) ≤ `Amax`. Violations are reported as warnings in the app and in tests (founder decision 2). The engine still prefers layouts without the warning.
- **H6 Wall clearance:** every head is ≥ `Wmin` from every wall and hole edge, and outside keep-outs (+clearance).
- **H7 Inside:** every head is inside `Z` (not in a hole).

The engine applies an internal safety margin `μ = 10 mm` to every limit, so floating-point error and sampling can never flip an oracle verdict.

### 1.4 Soft objectives (lexicographic, per A8)

1. Minimise head count.
2. Minimise deviation from preferences: `Σ(gap − s_p)² + Σ(endOffset − w_p)²` over rows and row spacing.
3. Maximise alignment: same column x across rows (straight cross-mains), tile-stop hits when the grid mode is `preferred`.
4. Prefer fewer exceptions (`offsetRow`, `gapFill`).
5. Deterministic tie-break on (frame index, decomposition index, row count, phase index).

---

## 2. Rule figures (DRAFT — data, not code)

**Placement figures (Amax, Smax, Smin, Wmax, Wmin) founder-confirmed against NZS 4541 on 2026-10-16.** `WmaxReduced` and design density remain unverified (not used in M2 placement).
I do not have access to the licensed text of NZS 4541:2020. The figures come from this reasoning:
(a) NZS 4541's spacing rules descend from the FOC/LPC → BS 5306-2 → EN 12845 lineage.
(b) EN 12845 standard-spacing figures (LH 21 m² / 4.6 m; OH 12 m² / 4.0 m; min spacing 2 m; wall distance 2.0 m, reduced to 1.5 m with exposed joists or open sides) are widely published.
(c) The founder's prototype placeholders (`DEFAULT_RULES`) used ELH 21/4.6/2.3 and OH 12/4.0/2.0, which shows how the founder already reads the standard.
ELH is treated as the NZ analogue of LH.

| Figure (standard rectangular layout) | ELH | OH1 | OH2 | OH3 | Source reasoning / doubt |
|---|---|---|---|---|---|
| `Amax` max area per head (m²) | 21 | 12 | 12 | 12 | **Founder-confirmed** 2026-10-16. |
| `Smax` max spacing, along and between rows (m) | 4.6 | 4.0 | 4.0 | 4.0 | **Founder-confirmed** 2026-10-16. |
| `Smin` min spacing (m) | 1.8 | 1.8 | 1.8 | 1.8 | **Founder-confirmed** 2026-10-16. |
| `Wmax` max distance from wall (m) | 2.3 | 2.0 | 2.0 | 2.0 | **Founder-confirmed** 2026-10-16. |
| `WmaxReduced` (exposed joists / open-sided) (m) | 1.5 | 1.5 | 1.5 | 1.5 | EN 12845. Not used in M2 unless the zone flag is set. |
| `Wmin` min distance from wall (m) | 0.05 | 0.05 | 0.05 | 0.05 | **Founder-confirmed** 2026-10-16. |
| Staggered layout | user option | user option | user option | user option | Founder decision 3; same figures as rectangular until a staggered-specific figure is confirmed (§3.10). |
| Design density (mm/min), info only | 2.25 | 5.0 | 5.0 | 5.0 | Not used in placement; shown in the zone panel only if the founder wants it. |
| Derived `Rc` (m) | 3.24 | 2.50 | 2.50 | 2.50 | `½√(Smax²+(Amax/Smax)²)`. Computed, not stored. |
| Derived row-dependent `S_row(D)` | `min(Smax, Amax/D)` | same | same | same | For row spacing D. |

Draft use → hazard mapping (FR71; also UNVERIFIED): Office → ELH, Meeting → ELH, Corridor → ELH, Kitchen/kitchenette → OH1, Plant room → OH1, Storage (non-high-piled) → OH2, Retail → OH2, Carpark → OH2. Founder decides.

**Storage format.** Seed file `src/core/sprinkler/rulesets/nzs4541.v1.json`, mirrored into the DB rule-figure table that the platform admin edits (FR79, audit-logged per NFR34). Each layout stores `{ruleSetId, version}` (A7). The test fixture table (A7) *is* this file at a pinned version.

```json
{
  "id": "nzs4541", "version": "1", "verified": true,
  "source": "Placement figures founder-confirmed against NZS 4541, 2026-10-16",
  "units": "m",
  "hazards": {
    "ELH": {"Amax": 21, "Smax": 4.6, "Smin": 1.8, "Wmax": 2.3, "WmaxReduced": 1.5, "Wmin": 0.05},
    "OH1": {"Amax": 12, "Smax": 4.0, "Smin": 1.8, "Wmax": 2.0, "WmaxReduced": 1.5, "Wmin": 0.05},
    "OH2": {"Amax": 12, "Smax": 4.0, "Smin": 1.8, "Wmax": 2.0, "WmaxReduced": 1.5, "Wmin": 0.05},
    "OH3": {"Amax": 12, "Smax": 4.0, "Smin": 1.8, "Wmax": 2.0, "WmaxReduced": 1.5, "Wmin": 0.05}
  }
}
```

A Zod schema validates it: `Smin < Smax`, `Wmin < Wmax`, all values > 0. When `verified:false`, the report and the export notice (FR78) say so.

---

## 3. Algorithm

### 3.1 Recommended: frame search × bay decomposition × row sweep with exact 1-D stabbing DP

Idea: designers lay heads on straight branch lines (rows) at even spacing, and treat odd corners as exceptions. That suggests splitting the 2-D problem into:
(a) a small discrete search over frame, decomposition and row set, and
(b) for each row, an **exact 1-D problem** solved by dynamic programming over candidate positions.
Every hard constraint becomes either a row-selection constraint or a DP transition or demand constraint, so nothing needs repair afterwards.

```
placeZone(input):
  Z      = prepare(input)                      // §3.6: to mm, zone-local frame, clean, validate
  A      = admissible(Z)                       // erode(Z, Wmin+μ) − (keepouts ⊕ clearance) − Smin-discs(locked)
  if A empty → fail NO_ADMISSIBLE_REGION
  best = null
  for θ in frames(Z, input):                   // ≤3 angles, §3.2 (tile angle only, if a grid is declared)
    Zθ = rotate(Z, −θ)
    for dec in decompositions(Zθ):             // none | cut-horizontal | cut-vertical at reflex vertices, §3.3
      plan = []
      for bay in dec.bays (largest first):
        plan += bestBayLayout(bay, seams, θ)   // §3.4; returns heads + cost or a located failure
      score = (count, prefCost, alignCost, exceptions, θi, deci)
      best  = lexMin(best, score)
  heads  = rotate(best.heads, θ) → PDF space
  report = oracle.check(Zoriginal, heads, rules)   // §4: independent; never feeds back silently
  return {heads, report, notes: best.notes}
```

#### 3.2 Frame candidates

- If a ceiling grid is declared: only the grid angle.
- Otherwise: length-weighted histogram of edge angles mod 90° on the **simplified** polygon, using quarter-degree bins smoothed ±1.5°. Take the top 2 peaks, plus 0° (page-orthogonal) when it is not already within 1° of a peak. Ties are broken by angle value.
- A user override replaces the list.

Rotation invariance follows: rotating the input rotates the candidates with it, so the result is the same (property test P2).

#### 3.3 Bay decomposition

In frame θ, cut the zone at each reflex vertex with an axis-parallel ray (all horizontal cuts, or all vertical cuts). That gives two decompositions; "none" (whole zone as one bay) is the third. Cuts at large holes work the same way (a large hole has reflex vertices from the zone's point of view). Small holes never cause cuts.

- A **seam** between bays is a virtual wall. Heads must stay ≥ `Smin/2` from it, which guarantees H3 across the seam, and its reach limit is `S_row/2` instead of `Wmax`.
- Bays are laid out largest first. A later bay's DP gets the earlier bay's column positions as alignment targets (straight cross-mains continue across the seam).
- Bay count is bounded: if more than 12 reflex vertices, only "none" plus the cut direction with fewer bays is evaluated.

Why: in the L-shape test (Z2) the vertical cut saves a head for ELH (6 vs 7), and the "none" variant cannot even work for OH1, because the leg's band is not reachable from a global row. The search picks the right variant per zone instead of hard-coding one.

#### 3.4 Bay layout: rows, bands, pieces, DP

For a bay with perpendicular extent `[y0, y1]` (height `H`):

1. **Row sets.**
   - `m_min = max(1, ⌈H / Smax⌉)`. Raise it until the edge offset `o = H/(2m)` satisfies `o ≤ Wmax−μ` for real walls.
   - Candidates: `m ∈ {m_min … m_min+3}`. For each m, try up to three placements: (a) uniform, `D = H/m`, offsets `D/2`; (b) offsets pulled toward `w_p` with interior spacing `D = (H−2o)/(m−1)`, kept only when `D ≤ Smax` and `o ≤ D/2`; (c) tile-snapped (row y on tile stops, when a grid is declared).
   - Constraint per row pair: `Smin ≤ D_j ≤ Smax`. Constraint per edge: `o ≤ min(Wmax, D/2)` against walls, `≥ Smin/2` against seams.
2. **Bands.** Row j owns the band between the midlines to its neighbours (bay edges for the first and last row). Its effective half-height is `d_j = max(r_j − lo_j, hi_j − r_j)` and its allowed spacing is `S_j = min(Smax, Amax/(2·d_j))`. This is the rect-cell bound: half-diagonal `≤ Rc` by construction, so H1 holds for every point a row covers in rect sense.
3. **Pieces.** `Z ∩ band_j` can have several connected components (legs, holes spanning the band). Each piece P is handled independently. Its admissible set on the row is `I_P = {x : (x, r_j) ∈ A ∩ closure(P)}` (a union of intervals).
   - If `I_P` is empty (the piece does not reach the row line, e.g. a notch or a triangle tip), move that piece's row to the y inside P that maximises `|I_P|`. The resulting heads are labelled `offsetRow` and listed in the report.
4. **Demands.** Each demand is an interval of x where *some* head on this row must lie:
   - *Interior:* the piece's x-projection `[a, b]` must be covered by windows `[x − S_j/2, x + S_j/2]`. These are generated analytically, not by sampling: first head ≤ a + S_j/2, last ≥ b − S_j/2, gaps ≤ S_j.
   - *Overhang points:* where an oblique wall makes P stick out beyond `I_P ± S_j/2`, the boundary of P there is sampled every 100 mm. Each sample p is dropped if a head already placed in row j−1 covers it (`|p−h| ≤ Rc−μ`, visible). Otherwise it becomes a circle demand `x ∈ [p_x − √(Rc'² − (p_y−r_j)²), p_x + …]` with `Rc' = Rc − μ`. Rows are solved in sweep order, so row j−1 is final when row j is solved.
   - *Oblique-wall points (H2):* wall samples every 100 mm on non-row-parallel edges inside the band give an interval on the row where the perpendicular distance is ≤ `Wmax−μ`, intersected with the reach interval. Row-parallel walls were already handled by the edge-offset constraint in step 1.
   - *Locked heads* remove the demands they satisfy and appear as forced positions.
5. **1-D stabbing DP (exact).**
   - Candidate positions are `I_P` discretised at 50 mm. In `required` tile mode only tile stops are used; in `preferred` mode, tile stops are added with a bonus.
   - State: the index of the last head. A transition `p → q` is valid iff `Smin ≤ q−p ≤ S_j` and no demand lies strictly between p and q (`lo > p ∧ hi < q`). This is O(1) per transition after a suffix-min precomputation over demands sorted by `lo`.
   - Objective: `(count, Σ(gap−s_p)² + (end offsets − w_p)² + λ_align·Σ dist(x, target columns) + λ_tile·[not on tile stop])`.
   - Result: the true minimum head count for the row, with the most even and aligned positions among minimum-count solutions.
6. **Infeasible demand** (no candidate in its interval). Try the next row-set variant. If every variant fails for a piece, place **one** head at the admissible point that covers the most remaining demands, label it `gapFill`, and report it to the user with its location. It is never silent, and it is bounded at one per piece per variant.

The bay layout returns the cheapest row-set variant: count first, then cost.

#### 3.5 How the shapes are handled

| Shape | Mechanism |
|---|---|
| Rectangle | One bay, uniform rows, DP gives the textbook even grid (`n = ⌈W/S_j⌉`, even spacing). Optimal within the rectangular family. |
| L / T / U / comb | Decomposition at reflex vertices. Each arm gets its own rows. Seams carry Smin and alignment. |
| Triangle | Frame candidates include the hypotenuse angle. Bands near the tip become small pieces → `offsetRow`. Overhang near the acute corners is caught by circle demands, or forces more rows. |
| Diagonal wall | Oblique-wall interval demands (H2), plus overhang demands covered by the previous row. The frame search also tries the wall's own angle. |
| Corridor | `m_min = 1` when width ≤ 2·min(Wmax, Smax/2). One row, `S_j = min(Smax, Amax/width)`. |
| Holes / columns | Small holes: removed from `A` (head clearance) but do not block visibility. Large holes: cut the bay, block visibility, give wall demands. |

#### 3.6 Preparation (fixes F7/F9)

1. Map PDF points to mm with the page calibration. Translate so the zone bbox min is the origin; this keeps numbers small for precision.
2. Remove duplicate and collinear vertices (5 mm). RDP-simplify at 25 mm. Snap edges within 1.5° of the chosen frame to exact parallel, only for decomposition purposes.
3. Validate: simple rings, correct orientation, holes inside the outer ring, area > 0. Fix self-intersections with a Clipper2 union. If still invalid, fail `INVALID_ZONE` with location.
4. **The engine works on the simplified polygon. The oracle checks against the original (unsimplified) polygon.** To stay conservative the engine erodes `A` by the simplification tolerance and reduces reaches by it (it is part of μ).
5. Polygon booleans and offsets use Clipper2 (integer mm). The package version gets pinned at implementation (NFR33).

#### 3.7 Ceiling-grid alignment (optional objective)

- The user declares the grid: click two grid intersections and enter the pitch (for example 1200 × 600). This gives angle, pitch and origin. The default stop is the tile centre (founder decision 5); mode defaults to `preferred`. Thirds along the long side of 1200 × 600 tiles are a later option.
- `preferred`: tile stops are DP candidates with a cost bonus, and rows also prefer stops. Head count is never traded for alignment, because count is the first criterion.
- `required`: only tile stops are candidates (rows and heads). If that costs extra heads, the report says so ("tile alignment: +2 heads vs unaligned"). To get that number, the engine runs the unaligned solve too, which doubles the work for that zone only.
- In `required` mode, keep-out tiles (for example a panel light) are removed from the stop set. Auto-detecting occupied tiles from vectors is deferred (Growth), because it was a fragile part of the prototype (F6).

#### 3.8 How each prototype failure is avoided

F1 → §4 independent oracle. F2 → one solve; feasibility lives in the DP; failures are typed. F3 → heads only on rows; exceptions labelled and counted in the objective. F4 → bays and pieces; admissible sets instead of nudging. F5 → `Rc` from area and spacing; perpendicular wall rule; local-cell area. F6 → declared grid; stops inside the DP. F7 → mm, zone-local, pure, no caches. F8 → interior coverage is analytic; the oracle uses a fixed 100 mm lattice with an index, and the budget is sized for it (§6). F9 → explicit preparation with tolerances; oracle on the original polygon. F10 → property, mutation and perturbation tests (§5).

### 3.9 Alternatives considered

| Alternative | Sketch | Verdict |
|---|---|---|
| **A. Global grid fit with rotation/offset search** (prototype-style, without repair) | One lattice (S, D, θ, phase) clipped to Z. Search over parameters; keep the best feasible one. | Good for rectangles; fails on L, triangle and diagonal: a single lattice either leaves gaps near oblique walls or needs extra rows everywhere. This is exactly F4. It survives as a special case: the "none" decomposition with uniform rows. |
| **B. Set cover over a candidate lattice** (greedy or ILP via a wasm LP solver) | Candidates at 100–300 mm; constraints from sample points; minimise count. | Finds low counts but scattered, non-installable positions (F3). Spacing constraints are pairwise, which makes the ILP large. A wasm solver adds dependency weight and makes determinism harder. Kept only as a **test-time lower-bound tool**: an ILP on small zones tells us how far our count is from optimal. |
| **C. Lloyd / CVT relaxation with constraint projection** | Start from A, iterate head ← centroid of its Voronoi cell, project onto constraints. | Gives even, organic layouts on irregular shapes but no rows (not installable). Convergence and determinism depend on iteration count. Hard constraints are only approximately met, so it would need repair (F2). Rejected for M2; could later polish `gapFill` heads locally. |
| **D. Rectangular decomposition + independent grids per rectangle** | Partition into rectangles; textbook grid each. | It is our "decomposition" step without the band and piece DP. It cannot handle triangles or diagonal walls (no rectangles). Subsumed. |

The recommendation combines D's decomposition with A's structured rows and an exact 1-D solver. That gives installable layouts, true per-row optimality and explicit handling of non-rectilinear walls.

---

#### 3.10 Staggered pattern (user option, founder decision 3)

- Per-zone `pattern: 'rectangular' | 'staggered'`. Staggered = odd rows shifted by half the along-row gap; the row DP runs per row with candidate positions constrained to the shifted lattice, rows still optimised jointly for count first.
- The oracle is pattern-agnostic (coverage, spacing, wall distance, area per head), so it needs no change; tests add staggered variants of the five named zones.
- Staggered-specific figures (if NZS 4541 gives a larger spacing for staggered OH) are an open item; until confirmed, staggered uses the rectangular figures.

## 4. Verification oracle (FR77 in-app, NFR9 in tests)

### 4.1 Independence requirements

- Module `src/core/sprinkler/oracle/*` **must not import** `place/*`, `prep/*` or Clipper. This is enforced by an ESLint `no-restricted-imports` rule plus a dependency test that fails CI.
- It has its own ~80-line geometry kernel (point-in-polygon, segment crossing, point–segment distance). It is deliberately duplicated so that shared bugs cannot hide (F1).
- Inputs: the **original** zone polygon in mm, heads in mm, rule figures. **It never receives** the frame angle, rows, bays, simplified polygon or engine samples.
- Predicates are the §1.3 definitions, written from this spec by a separate story. No μ margin: exact limits with 1 mm tolerance.
- Its sample set differs from anything the engine uses: an interior lattice with step `h = 100 mm` and phase `(37 mm, 61 mm)` from the bbox origin, plus boundary points every 50 mm on every ring, plus every vertex. The step is fixed and never coarsened (F8). A1-scale floors are budgeted in §6.

### 4.2 Checks

| Check | Computation | Report field |
|---|---|---|
| C1 coverage (H1) | For each sample: is there a visible head within Rc? Uniform grid index of heads (cell = Rc); visibility via an edge grid index (cell 1 m), counting proper crossings with outer ring and large holes. | `coverage`, `gaps[]` (4-connected clusters → area, centroid, outline) |
| C2 wall distance (H2) | Boundary samples: max over q of min over visible heads of perpendicular distance, subject to `|q−h| ≤ Rc`. | `worstWallDist`, offending points |
| C3 min spacing (H3) | All visible pairs within Smin (grid index). | `minSpacing`, pairs |
| C4 max spacing (H4) | Nearest visible neighbour per head. | `maxNNSpacing`, heads |
| C5 area (H5) | Zone area / count; local cells = Voronoi (Bowyer–Watson on heads) clipped to Z with the oracle's own convex clipper on each cell, then the ring. | `areaPerHead`, `maxLocalArea`, heads |
| C6 clearance / inside (H6, H7) | Distance from each head to all edges; point-in-polygon; keep-outs. | `minWallDist`, heads |
| C7 rule provenance | `rulesVerified` flag, rule version. | banner (FR78) |

In-app, the same module produces the FR77 panel and the coverage-overlay gap highlight (FR75 draws circles of radius Rc or squares of `S_j` in the zone frame. These are **visual only**; the verdict always comes from C1–C6). The checks are non-blocking: flags have severity `error | warning`.

### 4.3 Making it strong enough to catch placement bugs

- **Exact cross-check (tests only).** For zones without large holes, circle coverage is verified exactly: max over (Voronoi cell ∩ Z) vertices of distance to the site must be ≤ Rc. A convex function on a polygon peaks at a vertex. This second oracle must agree with C1 on random inputs, which tests the sampler itself.
- **Mutation tests of the oracle.** Take a passing layout, then (i) delete a non-redundant head, (ii) move a head by +0.6 m toward a wall, (iii) duplicate a head at 1.5 m distance, (iv) shrink the zone's head set until A/count > Amax. The oracle must flag each with the right check id.
- **Analytic goldens.** Hand-computed layouts with known verdicts. Example: the Z1 grid with one corner head removed gives an uncovered area whose size has a closed form (±2 %).
- **Engine-oracle disagreement is a bug.** In tests the engine's own "I satisfied H1–H7" claim is compared to the oracle verdict. Any mismatch fails the test, even when the oracle says "pass".

---

## 5. Test plan

All coordinates in mm, zone-local. Default test calibration is 1 PDF pt = 12.37 mm (prototype value). Each zone is also run at a second calibration (1 pt = 3.53 mm, i.e. 1:10 on A-series) and must give identical heads in mm (P3).
"Count" is the head count. LB = `⌈area/Amax⌉`. "Hand" = the solution worked out in this document. The engine must return ≤ Hand; the exact golden is frozen after the first implementation review.
Every test asserts: oracle C1–C6 pass, zero uncovered samples (NFR9), no `gapFill` unless stated, deterministic output (run twice, byte-equal).

### 5.1 The five NFR9 zones

> Hand-worked expected values below were computed with draft-0 figures (`Smin` 2.0, `Wmin` 0.1). Recompute against v1 (`Smin` 1.8, `Wmin` 0.05) when the fixtures are written; count-first results are not expected to change, but min-spacing/clearance edge cases may.

| Id | Polygon | Area | OH1: LB / Hand | ELH: LB / Hand | Extra assertions |
|---|---|---|---|---|---|
| Z1 rectangle | (0,0) (10000,0) (10000,6000) (0,6000) | 60 m² | 5 / **6, exact** | 3 / **6, exact** | OH1 positions = x∈{1667, 5000, 8333} × y∈{1500, 4500} (±25 mm) when `s_p`/`w_p` are unset. Two rows. |
| Z2 L-shape | (0,0) (12000,0) (12000,4000) (6000,4000) (6000,9000) (0,9000) | 78 m² | 7 / **8** | 4 / **6** | ELH hand: vertical cut. Leg 6×9: 2 rows × 2 (x 1500/4500, y 2250/6750). Stub: 1 row y=2000, x 7500/10500. Every head in the leg is ≥ Smin from every stub head. |
| Z3 triangle | (0,0) (8000,0) (0,6000) | 24 m² | 2 / **5** | 2 / **3** | ELH hand: rows y=1500 (x≈2000, 5700) and y=4500 (x≈1750). The hypotenuse's perpendicular check (C2) is binding: worst wall distance reported ≤ Wmax. |
| Z4 diagonal wall | (0,0) (12000,0) (12000,3000) (0,9000) | 72 m² | 6 / **8** | 4 / **5** | Also **Z4r** = Z4 rotated 30° about the origin: same count as Z4, frame angle 30°±0.5° or (30°+wall angle). Overhang demands are exercised (assert ≥1 overhang demand was resolved by the previous row, via the debug trace). |
| Z5 corridor | (0,0) (20000,0) (20000,1600) (0,1600) | 32 m² | 3 / **5, exact** | 2 / **5, exact** | Single row: all heads at y = 800 ± 1. Spacing 4000. End offsets 2000. Variants: rotated 45°; L-corridor (0,0) (20000,0) (20000,1600) (1600,1600) (1600,12000) (0,12000), each leg one row, no head within Smin across the corner. |

### 5.2 Additional named zones

| Id | Definition | Purpose / expected |
|---|---|---|
| Z6 columns | Rect 16800 × 9000 with holes: 600×600 squares centred at (4200,4500), (8400,4500), (12600,4500) | Small holes do not block visibility. No head within Wmin of a column. Count equals the hole-free rect count (OH1: 3 rows × 5 = 15). |
| Z7 shaft | Rect 12000 × 12000 with a 4000×4000 hole at (4000..8000, 4000..8000) | Large hole: decomposition into a ring of bays, visibility blocking. Oracle C1 with visibility. |
| Z8 noisy L | Z2 with every edge replaced by a 30 mm stair-step trace (dynamic-fill style) | Same count as Z2 ±1. Oracle passes on the noisy original. |
| Z9 tile room | Rect 7200 × 6000, grid 1200×600 at angle 0, origin (0,0), mode `required` | 100 % of heads on tile centres. Report shows the extra-head delta vs unaligned. |
| Z10 too narrow | Rect 6000 × 150 | `NO_ADMISSIBLE_REGION` (with Wmin = 100), located failure, no heads. |

### 5.3 Zones derived from the sample RCPs (L17 / L21)

Observed in the sheets (treated as data): A1, plan viewport ≈ 454 × 434 mm, title-block scale "As indicated" only. Keynotes: "existing perimeter bulkhead between columns and linear ceiling grilles to be retained", "selected 1200x600 ceiling tiles in exposed T grid", "600x600 panel light", "13 mm GIB plasterboard ceiling", feature acoustic ceilings, "out of scope" core areas. Orthogonal linework dominates, and **45° linework is ≈ 20 % of long-line length** (splays or feature hatch).
The dimensions below are **representative**. Re-measure them from the calibrated sheets once the calibrate and dynamic-fill tools exist, then freeze them as fixtures.

| Id | Definition | Expected |
|---|---|---|
| R1 "L17 perimeter office" | L band: (0,0) (30000,0) (30000,22000) (21000,22000) (21000,9000) (0,9000) — inner edge at the perimeter-bulkhead line. Column holes 600×600 centred at (4200,1500), (12600,1500), (21000,1500), (28500,1500), (28500,9600), (28500,18000). Grid 1200×600 at angle 0, origin (0,0), mode `preferred`. Keep-outs: six 600×600 panel lights at tile cells (choose cells at x=6000,12000,18000 on y=4800 and y=7200). | ELH, area 387 m² (minus columns), LB 19. Oracle passes. ≥ 90 % of heads on tile stops. No head in a light tile. Count ≤ unaligned count + 15 %. Runtime ≤ 1 s (NFR6 single zone; the zone is > 200 m², so this is a stretch target). |
| R2 "L21 splayed meeting room (GIB)" | (0,0) (7200,0) (7200,3600) (5400,5400) (0,5400): 45° splay. No tile grid. Keep-outs: four downlights as 300 mm-radius discs at (1800,1800), (5400,1800), (1800,3600), (3600,3600). | Area 37.26 m². ELH: LB 2, Hand **4** (rows y=1350 → x 1800/5400; y=4050 → x≈1800/≈5000). OH1: LB 4. No head within 300 mm of a downlight. The splay's perpendicular check binds. |

### 5.4 Property-based tests (fast-check, fixed seeds for reproducibility)

| Id | Property |
|---|---|
| P1 | Random orthogonal polygons (random-walk rectilinear, 4–16 vertices, 3–40 m), random convex polygons, random triangles with angles ≥ 15°, all hazards: engine returns ok and the oracle passes, **or** the engine returns a typed failure whose location is inside the zone. |
| P2 | Rotation: rotate by φ ∈ [0, 90°): same count, and the oracle passes. |
| P3 | Translation and calibration: same real-world zone at any PDF offset or calibration → identical heads in mm (±0.5 mm). |
| P4 | Determinism: same input twice → byte-identical output (JSON). |
| P5 | Lower bound: count ≥ ⌈area/Amax⌉. Rectangles: count = (rows × cols) of the closed-form rectangular optimum. |
| P6 | Monotone rectangles: growing W or H never reduces the count. |
| P7 | Noise robustness: vertex jitter ≤ 20 mm → the oracle still passes on the jittered polygon (count may change). |
| P8 | Locked heads: re-running with k locked heads keeps them byte-equal, and the oracle passes. |
| P9 | Oracle agreement: C1 sampled vs the exact Voronoi-vertex check agree on random convex inputs. |
| P10 | Optimality gap (nightly, small zones ≤ 60 m²): engine count ≤ ILP optimum (rectangular-row family) + 1. |

---

## 6. Performance plan (NFR6: zone ≤200 m² ≤1 s; 600 m² / ≤15 zones ≤5 s; no main-thread task >50 ms)

Placement runs in a dedicated Web Worker (`sprinkler.worker.ts`). The main thread only posts messages and draws.

Cost model for one zone of area `a` m², perimeter `L` m, `k` heads:

| Step | Complexity | Typical (200 m²) |
|---|---|---|
| Preparation (Clipper offset, RDP) | O(V log V) | < 5 ms |
| Search variants | ≤ 3 frames × 3 decompositions × ≤ 4 m × ≤ 3 placements ≈ 108 bay-variants (bays share work) | — |
| Per bay-variant: rows × pieces × DP | DP: positions `P = len/50 mm` (≤ 600 for 30 m), transitions within `S_j/50 mm` (≤ 92) → ≤ 55k O(1) steps per row piece | ~5 rows × 55k ≈ 0.3 M steps |
| Total search | ≈ 108 × 0.3 M ≈ 30 M simple ops | ~60–120 ms |
| Oracle | samples `a/0.01 + L/0.05` ≈ 20k + 1.2k; heads per query via grid ≈ 4–9; visibility edge checks via grid ≈ ≤ 10 | ~1.5 M ops → 15–30 ms |
| Voronoi + clipping | O(k log k + k·V) | < 5 ms |

A 600 m² floor in 15 zones comes to roughly 0.6–1.5 s plus oracle ≈ 0.3 s, comfortably inside 5 s.

Budgets and safeguards:
- **Deterministic budgets.** Each zone gets an operation counter (default 50 M DP steps). When exceeded, the remaining lower-priority variants (fixed order: θ peak 2, cut-vertical, m+3, placement c) are skipped, and `searchTruncated:true` goes in the notes. Wall-clock timeouts are **never** used inside the solve, because they would break determinism.
- **Spatial indexes.** Uniform grids sized to the query radius: heads (cell Rc), edges (1 m), demands kept sorted per row. No quadtree needed at these sizes.
- **Typed arrays** (`Float64Array`) for samples and positions. Integer mm in Clipper.
- **Zones are independent.** Results stream per zone (progress messages). Cancellation is checked between zones and between variants. A second worker can be added if the reference hardware (A10) misses the budget. Zones are partitioned deterministically by id, and results are merged by zone id.
- **Incremental re-check.** After a manual move (FR76), the main thread asks the worker to `check` that zone only (~30 ms). The overlay updates on the response. The 50 ms visual feedback comes from drawing the moved symbol immediately, before the check returns.
- **Perf CI.** A Vitest bench on Z1–Z9 + R1/R2 under Node, with a threshold of 2× the budget headroom. R1 must place in ≤ 1 s on CI hardware.

---

## 7. Module / API sketch (`src/core/sprinkler/*`, framework-free, no DOM)

```
src/core/sprinkler/
  types.ts            // shared types below
  rules.ts            // load + validate rule sets (Zod), derive Rc, S_row
  rulesets/nzs4541.v1.json
  prep/prepare.ts     // calibration → mm, clean, simplify, validate, admissible region (Clipper2)
  place/frames.ts     // frame candidates
  place/decompose.ts  // bays + seams
  place/rows.ts       // row-set variants, bands, pieces, demands
  place/stab1d.ts     // exact 1-D stabbing DP
  place/placeZone.ts  // search + scoring (entry point)
  oracle/kernel.ts    // own minimal geometry (deliberately duplicated)
  oracle/check.ts     // C1–C7, gaps, Voronoi local cells
  oracle/exact.ts     // tests-only exact circle-coverage verifier
  worker/protocol.ts  // message types (shared with the worker entry in src/workers)
```

```ts
// types.ts
export type Mm = number;                         // millimetres, zone-local frame
export interface Pt { x: number; y: number }     // PDF user space or mm (documented per field)
export interface Ring { pts: Pt[] }              // closed implicitly, no repeated last point
export interface ZoneGeom { outer: Ring; holes: Ring[] }

export type Hazard = 'ELH' | 'OH1' | 'OH2' | 'OH3';
export interface HazardRule { Amax: number; Smax: number; Smin: number; Wmax: number; WmaxReduced: number; Wmin: number } // m, m²
export interface RuleSet { id: string; version: string; verified: boolean; source: string; hazards: Record<Hazard, HazardRule> }

export interface Calibration { pdfToMm: [a: number, b: number, c: number, d: number, e: number, f: number] } // affine
export interface CeilingGrid { angleRad: number; pitchU: Mm; pitchV: Mm; originU: Mm; originV: Mm;
                               stopsU: number[]; stopsV: number[];            // fractions, e.g. [0.5]
                               mode: 'off' | 'preferred' | 'required' }
export interface KeepOut { geom: ZoneGeom; clearance: Mm }               // geom in PDF space
export interface LockedHead { id: string; at: Pt }                        // PDF space

export interface ZoneInput {
  zoneId: string;
  geom: ZoneGeom;                    // PDF user space
  calibration: Calibration;
  hazard: Hazard;
  prefs?: { spacing?: Mm; wallDist?: Mm };
  frameOverrideRad?: number;
  grid?: CeilingGrid;
  keepOuts?: KeepOut[];
  locked?: LockedHead[];
  smallHoleMaxDim?: Mm;              // default 1000
  reducedWallDist?: boolean;         // use WmaxReduced
}

export type HeadKind = 'row' | 'offsetRow' | 'gapFill' | 'locked';
export interface PlacedHead { id: string; zoneId: string; at: Pt; kind: HeadKind; rowId?: string }

export type FlagCode = 'UNCOVERED' | 'WALL_DIST' | 'MIN_SPACING' | 'MAX_SPACING' | 'AREA_ZONE'
  | 'AREA_LOCAL' | 'WALL_CLEARANCE' | 'OUTSIDE' | 'IN_KEEPOUT' | 'RULES_UNVERIFIED';
export interface Flag { code: FlagCode; severity: 'error' | 'warning'; headIds: string[]; where?: Pt[]; value?: number; limit?: number }

export interface ZoneReport {
  zoneId: string; hazard: Hazard; ruleSet: { id: string; version: string; verified: boolean };
  headCount: number; areaM2: number; areaPerHeadM2: number; maxLocalAreaM2: number;
  minSpacingM: number; maxNNSpacingM: number; worstWallDistM: number; minWallDistM: number;
  coverage: number;                                   // sampled share, 0..1
  gaps: { areaM2: number; centroid: Pt; outline: Pt[] }[];
  tileAligned?: { onStop: number; total: number; extraHeadsVsUnaligned?: number };
  flags: Flag[];
}

export interface PlacementNotes { frameRad: number; decomposition: 'none' | 'cutH' | 'cutV';
  bays: number; rows: number; exceptions: { offsetRow: number; gapFill: number }; searchTruncated: boolean; opCount: number }

export type PlaceError =
  | { code: 'INVALID_ZONE'; where: Pt[]; message: string }
  | { code: 'NO_ADMISSIBLE_REGION'; where: Pt[]; message: string }
  | { code: 'UNCALIBRATED'; message: string };

export type PlaceResult =
  | { ok: true; heads: PlacedHead[]; report: ZoneReport; notes: PlacementNotes }
  | { ok: false; error: PlaceError };

// Entry points — pure, deterministic, synchronous (the worker provides async + cancel)
export declare function placeZone(input: ZoneInput, rules: RuleSet, opts?: { opBudget?: number; idPrefix?: string }): PlaceResult;
export declare function checkZone(input: Pick<ZoneInput, 'zoneId' | 'geom' | 'calibration' | 'hazard' | 'keepOuts' | 'smallHoleMaxDim' | 'reducedWallDist'>,
                                  heads: PlacedHead[], rules: RuleSet): ZoneReport;   // oracle only
```

Head ids are deterministic: `${idPrefix}${zoneId}:${bayIdx}:${rowIdx}:${posIdx}`. No `Math.random`, no `Date`, no Map iteration over float keys.

```ts
// worker/protocol.ts
export type ToWorker =
  | { type: 'place'; reqId: string; docRev: number; rules: RuleSet; zones: ZoneInput[]; opBudgetPerZone?: number }
  | { type: 'check'; reqId: string; docRev: number; rules: RuleSet; zone: ZoneInput; heads: PlacedHead[] }
  | { type: 'cancel'; reqId: string };

export type FromWorker =
  | { type: 'progress'; reqId: string; done: number; total: number }
  | { type: 'zoneResult'; reqId: string; docRev: number; zoneId: string; result: PlaceResult }   // streamed
  | { type: 'checkResult'; reqId: string; docRev: number; report: ZoneReport }
  | { type: 'done'; reqId: string; cancelled: boolean }
  | { type: 'error'; reqId: string; code: 'BAD_INPUT' | 'INTERNAL'; message: string };     // no stack traces (NFR32 spirit)
```

The main thread drops results whose `docRev` is stale. Inputs are validated with Zod at the worker boundary. Placed heads become ordinary device markups (FR76) carrying `{zoneId, kind, ruleSetVersion}` metadata, so legend counts work unchanged.

---

## 8. Open questions for the founder

1. **Rule figures (§2):** confirm every number against NZS 4541:2020, especially **ELH `Wmax` 2.3 vs 2.0 m**, whether `Smin` is 2.0 m, and whether a minimum wall distance exists in the standard (0.1 m is an installability default).
2. **Coverage interpretation:** is "every point within `Rc` (half-diagonal of the largest compliant S×D cell) + perpendicular wall rule + per-head S×D (Voronoi) ≤ Amax" an acceptable reading for irregular rooms? The alternative is a strict rectangular S×D check in a declared frame. This decides whether `AREA_LOCAL` is an error or a warning.
3. **Staggered layouts:** allowed in NZS 4541 for OH, and if so with which figures? M2 assumes rectangular only. Note: the current oracle would accept some staggered layouts (e.g. a 5-head quincunx in Z1 ELH) that a strict reading might reject.
4. *(Partly answered: columns = walls. Obstructions → post-MVP §9, height-aware.)* **Columns and obstructions:** below what size can a column be ignored for spray visibility (default 1.0 m)? Is there a 4541 rule for distance to columns or beams that should become a check in M2, or is it manual?
5. **Special cases in the standard:** small-room rules (one head in a small ELH room?), narrow-corridor spacing rules, and rules for concealed spaces or bulkheads. Should bulkheads at a different ceiling height always be separate zones?
6. **Ceiling-grid default:** `preferred` or `required`? For 1200×600 tiles, centre only or thirds along the long side (the prototype preferred thirds)?
7. **Adjacent zones without a wall** (open plan split by hazard): should coverage and min spacing be checked across the shared edge? This design treats every zone edge as a wall unless the zones are merged.
8. **Objective order:** A8 puts count first. Would you accept +1 head for straighter cross-mains or tile alignment? (Currently no.)
9. **Use → hazard mapping:** confirm the draft mapping (Office/Meeting/Corridor → ELH, Kitchen/Plant → OH1, Storage/Retail/Carpark → OH2).
10. **PRD edits:** change A8 to "independent oracle per this document" (not the prototype `audit()`), and point the 4541 performance references at NFR6.

---

## 9. Post-MVP extension: obstruction library and baffled coverage (Growth)

Decided by the founder 2026-10-17: **post-MVP**, with **height-aware obstructions** (not "every object is a wall"). Not part of M2. This section fixes the model so M2 code does not block it.

### 9.1 What the user does

1. Opens an **Obstruction library** panel: rectangle, circle, L-shape, free polygon, plus named presets (duct, beam, light fitting, cable tray, partition). Company admins can add presets (same storage model as Tool Chest sets).
2. Places objects on a calibrated page (real size, snap, rotate, resize like markups).
3. Sets each object's **height model** in Properties:
   - `fullHeight`: floor to ceiling (partition, column, shaft). Behaves exactly like a wall (founder decision 4 extended).
   - `suspended`: hangs below the ceiling. Inputs: `depthBelowCeiling` (mm, top of object at ceiling unless `topBelowCeiling` given) and optional `width` for linear objects (beam, duct, tray).
4. Sees each head's coverage shape **update live**: the shape is clipped by spray shadows behind obstructions that baffle it; shadowed area that no other head covers is shown as uncovered.
5. Runs or re-runs placement; the engine treats baffling obstructions as constraints and adds heads where shadows need them. The checker reports obstruction rule breaks on the canvas.

### 9.2 Model

```ts
type Obstruction = {
  id: string; pageId: string;
  shape: Polygon;                         // PDF user space, like zone rings
  kind: 'fullHeight' | 'suspended';
  topBelowCeiling_mm?: number;            // default 0 (fixed to ceiling)
  depthBelowCeiling_mm?: number;          // bottom of object below ceiling; required for 'suspended'
  preset?: 'duct' | 'beam' | 'light' | 'tray' | 'partition' | 'custom';
};
// Per zone (new inputs): ceilingHeight_mm, deflectorBelowCeiling_mm (head type default).
```

Stored as markups of a new type (jsonb geometry, same op queue / LWW sync), so no new sync path is needed.

### 9.3 Rule application (figures UNVERIFIED — founder to confirm against NZS 4541)

For each head–obstruction pair the engine and the checker each compute, independently:

- `d` = horizontal distance from the head to the nearest obstruction edge;
- `h` = vertical distance from the deflector to the bottom of the obstruction (from `depthBelowCeiling_mm` and `deflectorBelowCeiling_mm`).

The standard's obstruction rules relate `d` and `h` (and object width) to decide whether the object (a) can be ignored, (b) requires a minimum horizontal clearance, or (c) baffles the spray and must be treated as a wall (shadow + wall-distance rules on its faces, extra head beyond it). **No figures are written here on purpose.** They become a new ruleset table `nzs4541.obstructions` (data, not code) with `verified: false` until the founder checks each row against a licensed copy, as was done for v1 placement figures. `fullHeight` objects need no table: they are always walls.

### 9.4 Geometry

- **Baffled coverage shape** = visibility polygon from the head position against all baffling obstruction edges (and zone walls), intersected with the head's coverage disc/square (FR75 shape). Standard angular-sweep visibility, O(n log n) in edges near the head; spatial index (flatbush) limits edges to the coverage radius. Budget: one head ≤ 1 ms, so dragging stays within NFR3 (50 ms).
- **Placement:** baffling obstructions become holes/wall segments for the frame search and bay decomposition (§3.1) — the same path columns already take — plus the minimum-clearance constraint from §9.3(b) as a forbidden band around non-baffling obstructions.
- **Checker:** samples its own 100 mm grid and its own visibility test (no import from placement, §4.1); adds checks `OBSTRUCTION_CLEARANCE` (error) and `SHADOW_UNCOVERED` (error, points behind a baffle not reached by any head).

### 9.5 M2 hooks (do now, cheap)

- Zone holes and wall segments flow through one `Barrier[]` input in both placement and checker, so obstructions later add barriers without changing signatures.
- Coverage overlay renders from a per-head polygon (not an analytic circle) so baffled shapes drop in.
- Ruleset schema allows extra named tables (`obstructions`) and per-table `verified` flags.

### 9.6 Tests (when built)

- Duct ignored: suspended object above the "ignore" threshold → layout identical to no obstruction.
- Beam baffles: deep beam across a room → treated as wall, count equals the two half-rooms' sum, no `SHADOW_UNCOVERED`.
- Clearance: head dragged inside the clearance band → `OBSTRUCTION_CLEARANCE` at that head.
- Full-height partition ≡ zone split with a wall (same heads, same report).
