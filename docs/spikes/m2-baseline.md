# M2 gate baseline: manual head placement (A16, AR29)

The M2 gate (PRD success criteria) says the 4541 engine must be faster than manual placement on 3/3 of the founder's office drawings, with full coverage.

To make that a fair test, the founder times their **manual** head placement on the same three drawings **before** the engine (Stories 9.4–9.7) is run on them. Times recorded after anyone has seen an engine layout don't count.

Status: **waiting for the founder.** The engine must not be run on these drawings until the table below is filled in.

## How to time

- Use the tool and workflow you use today (Revu, or Plan Markup's Count tool once Epic 9's zones exist). Start from a calibrated drawing with the rooms known.
- Start the clock when you begin placing heads in the first room. Stop it when every room on the drawing is placed and you would issue it for checking.
- Count every head you placed, and note anything unusual (columns, bulkheads, odd-shaped rooms).

## Drawings

Drawings are referred to by a short label only. Client file names and content stay out of the repository (NFR26). The founder keeps the label-to-file key privately.

| # | Label | Pages / zones | Hazard classes present | Manual time (min) | Heads placed | Date timed | Notes |
|---|---|---|---|---|---|---|---|
| 1 | B1 |  |  |  |  |  |  |
| 2 | B2 |  |  |  |  |  |  |
| 3 | B3 |  |  |  |  |  |  |

**Note, 2026-11-10.** The engine was shown in a local demo on this date, and one of the founder's ceiling plans was suggested as the drawing to try it on. If Place heads was run on a drawing that is one of B1–B3, that drawing's manual time no longer counts: choose another drawing of the same kind for it.

## Engine runs (filled in at the M2 gate, after the table above)

"Engine time incl. review" runs from the first zone drawn to the layout you would issue for checking: zones, uses, Place heads, reading each zone's report and any heads moved by hand.

| # | Label | Engine time incl. review (min) | Heads | Full coverage (oracle) | Faster than manual? | Time saved (min) |
|---|---|---|---|---|---|---|
| 1 | B1 |  |  |  |  |  |
| 2 | B2 |  |  |  |  |  |
| 3 | B3 |  |  |  |  |  |

## Rule disagreements (Story 9.13)

Every place where the engine's layout and yours differ for a reason of the rules, not of taste. One line each.

| # | Drawing / zone | What the engine did | What you would do | Rule or reading behind it | Action |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

Things to look for (from `docs/spikes/m2-engine-review.md`):

- Rows that hold different numbers of heads, so heads do not line up across rows (O1). The engine puts head count first.
- Heads you move by hand: the live check does not see rows more than the maximum spacing apart (F1).
- Hazard class per use: the default mapping is still a draft.
- Columns (no maximum wall distance on their faces) and shafts (a wall).
