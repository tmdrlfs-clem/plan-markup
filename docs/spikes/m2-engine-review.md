# M2 engine review (Story 9.13)

Date: 2026-11-10 · Scope: the 4541 oracle (`src/core/sprinkler/oracle`), the placer's output, and the path from the page to the engine and back.

This is a second look at the engine before pilots use it. It asks two things:

- Does the oracle check what the design says it checks, everywhere on the page?
- Do the layouts the placer makes keep the rules when they are read more strictly than the oracle reads them?

## Result

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | The oracle does not see two rows that are too far apart. | Rule reading, founder decision | Option 3 chosen by the founder (2026-11-12): the report row is now "Nearest head". A row-aware warning for hand edits is left for after M2. Placer layouts are not affected (measured). Heads moved by hand are. |
| F2 | The verdict could depend on where the room sat on the page (a head up to 1 mm past the coverage radius was sometimes missed). | Bug, low | Fixed, with a regression test. |
| F3 | The zone report could not be scrolled with the keyboard. | Accessibility, serious (axe) | Fixed. Found by the new keyboard-only test. |
| O1 | The placer uses fewer heads than an aligned grid when rows may hold different numbers of heads. | Observation | Changed 2026-11-12 after the founder's sample drawings: rows are aligned by default (`alignRows`), at up to one head or about 10 % more, when it saves 2 row or column lines per extra head. 14×14 m OH1 is now 20 heads in a 4 × 5 grid. A layout that would open the rows past the maximum spacing falls back to the fewest-heads layout. |

No finding changes a pass into a fail for a layout the placer makes.

## F1: rows too far apart pass the oracle

**What the design says.** Max spacing (H4, C4) is checked as: each head's nearest visible head is no further than `Smax`. The design's question 2 already notes that coverage is read as "every point within `Rc`" and not as a strict S × D grid.

**What that misses.** A layout with heads close together along each row, and the rows far apart, passes every check:

| Hazard | `Smax` | Rows apart (passes) | Heads along the row | Area per head | Oracle |
|---|---|---|---|---|---|
| ELH | 4.6 m | 6.0 m | 1.8 m | 9.5 m² | pass, no warning, "max spacing 1.8 m" |
| OH1 | 4.0 m | 4.5 m | 1.8 m | 7.7 m² | pass, no warning, "max spacing 1.8 m" |

- The coverage radius allows it: with heads 1.8 m apart along the row, every point between rows 6.0 m apart is still within `Rc` (3.24 m for ELH).
- The widest row spacing that passes is about 6.2 m for ELH and 4.6 m for OH.
- The report's "Max spacing" row then shows the along-row figure, which reads as if spacing were fine.

**Who is affected.**

- **Placer layouts: not affected.** The placer builds rows no further than `Smax` apart. This was measured on 104 layouts (the fixtures at each hazard, the 15-zone office floor and 60 seeded irregular zones), using each head's row and the frame angle:
  - widest spacing along a row: 1.0000 × `Smax`;
  - widest spacing across the rows: 1.0003 × `Smax` (1.3 mm over on one zone, inside the rounding of the stored frame angle).
- **Heads moved or added by hand (Story 9.10): affected.** The live check is the oracle alone. A designer can drag rows apart past `Smax` and still see a green tick.

**Why it is not fixed here.** A check that needs no row structure gives false alarms. Measured as "the distance between heads whose cells share a boundary", 36 of 105 placer layouts would be flagged, because rows that hold different numbers of heads are not aligned and the diagonal between them is longer than `Smax` while the row spacing and the along-row spacing are both within it. A correct check has to know the rows.

**Options for the founder.**

1. Accept for M2. The placer keeps the rule; the advisory notice covers hand edits.
2. Add a warning for hand-edited zones, using the rows of the last placer run (kept in `zone_layouts`): "these rows are x m apart; the maximum is y m". Roughly one story.
3. Rename the report row to "Nearest head" so it does not read as the full spacing rule. Small.

Tests that pin this: `src/core/sprinkler/engine/m2-review.test.ts` (both the 104-layout measurement and the two "KNOWN LIMIT" cases, which must change when a check is added).

## F2: the verdict depended on the room's position (fixed)

- The oracle finds heads near a sample through a grid of cells `Rc` wide and looked at the sample's own cell and the eight around it.
- A head between `Rc` and `Rc` + 1 mm away (inside the 1 mm tolerance) can lie two cells over. It was then missed, and the sample was reported as uncovered.
- Whether that happened depended on where the room sat on the page. The same room and head gave 52 of 54 samples covered at one position and 53 of 54 after a move.
- Fix: the cells are now taken from the reach (`Rc` + tolerance) around the sample.
- Tests (`src/core/sprinkler/oracle/audit.test.ts`):
  - the case above, at five positions;
  - every reference layout gives the same report after two moves (29 layouts);
  - the wall index agrees with a plain loop over every wall for 400 seeded sight lines on each fixture.

## F3: the zone report could not be scrolled with the keyboard (fixed)

- The report scrolls when the panel is short, and a report with no rule breaks holds nothing that takes focus.
- It now takes focus itself, so the arrow keys scroll it.
- Found by `e2e/keyboard-4541.spec.ts` (axe rule `scrollable-region-focusable`).

## O1: fewer heads than an aligned grid

- A 14 × 14 m OH1 room gets 18 heads in four rows of 5, 4, 4 and 5. An aligned grid would be 4 × 5 = 20.
- Each row is straight and every figure is inside its limit (area per head 10.9 m² on average, 11.8 m² at most; spacing along the rows up to 3.55 m).
- The heads of neighbouring rows do not line up, which matters if the designer wants straight cross-mains.
- This follows the objective order (head count first, A8). It is worth a look in the A16 comparison: if the founder would not draw it this way, the objective order is the thing to change.

## Checked and found sound

- **Units.** Page points become millimetres per axis (`UserUnit` × the page's x and y factors), and heads come back through the inverse. A non-uniform calibration is handled.
- **Rule figures.** Placement and the live check both use the built-in `nzs4541` v1 file. The database copy is checked against it in CI (`check:rules`). An edit to the database copy does not change placement until Epic 10 wires it in.
- **Oracle independence.** It imports only its own kernel (lint rule and test).
- **Sight lines.** A sight line may start or end on a wall. One that passes through a wall corner counts as blocked, which is the careful side.
- **Wall distance.** Measured to the wall's line from a visible head within `Rc`, on real walls only: open edges and column faces carry no maximum, as decided.
- **Tolerances.** The placer keeps a margin inside every limit (30–75 mm on sampled limits, 0.5 mm on exact ones); the oracle allows 1 mm. The placer is never the more generous of the two.
