// Story 9.13 (M2 review): "max spacing" read strictly, along and across the rows.
//
// The oracle's C4 (design H4) reads max spacing as each head's nearest visible peer. Two rows
// too far apart, with heads close along each row, pass it (finding F1 in
// docs/spikes/m2-engine-review.md). These tests pin both sides of that:
//   - every layout the placer makes keeps the strict reading (its rows are known, so the
//     along-row and across-row spacing can be measured directly);
//   - the oracle alone does not see it, so heads moved by hand are not held to it.
import { describe, expect, it } from "vitest";

import { NZS4541_V1, type Hazard } from "../rules/rules";
import { neighbourGaps } from "../testing/neighbour-gaps";
import { auditRows } from "../testing/row-audit";
import { inputOf, samples } from "../testing/zone-fixtures";
import { irregularZone, officeFloor } from "../testing/zone-generators";

import { checkZone } from "../oracle";

import { placeSite, type EngineZone } from "./site";

/** The frame angle in the notes is rounded to 0.001°: up to about 1 mm across a 60 m floor. */
const FRAME_TOL = 3;

type Site = { name: string; zones: EngineZone[] };
const sites: Site[] = [
  ...samples()
    .filter((s) => !s.error)
    .flatMap((s) => s.hazards.map((hz) => ({ name: `${s.id} ${hz}`, zones: s.zones.map((f) => ({ ...inputOf(f.zone), hazard: (s.zones.length === 1 ? hz : f.zone.hazard) as Hazard })) }))),
  { name: "office floor (15 zones)", zones: officeFloor() },
  ...Array.from({ length: 60 }, (_, i) => ({ name: `seed ${i + 1} ${irregularZone(i + 1).shape}`, zones: [irregularZone(i + 1)] })),
];

describe("M2 review: every placed layout keeps max spacing along and across its rows", () => {
  let layouts = 0;
  let widest = 0;

  it.each(sites.map((s) => [s.name, s] as const))("%s", { timeout: 60_000 }, (_name, site) => {
    placeSite(site.zones, NZS4541_V1).forEach((r, i) => {
      const z = site.zones[i];
      // A staggered layout has no "next row straight across": it is checked by the oracle only.
      if (!r.result.ok || z.pattern === "staggered") return;
      const smax = NZS4541_V1.hazards[z.hazard].Smax * 1000;
      const audit = auditRows(z.barriers.map((b) => b.ring), r.result.heads, r.result.notes.frameDeg, smax);
      expect(audit.along, `${z.zoneId} along a row: ${JSON.stringify(audit.worst)}`).toBeLessThanOrEqual(smax + FRAME_TOL);
      expect(audit.across, `${z.zoneId} across the rows: ${JSON.stringify(audit.worst)}`).toBeLessThanOrEqual(smax + FRAME_TOL);
      layouts++;
      widest = Math.max(widest, audit.along / smax, audit.across / smax);
    });
  });

  it("measured real layouts, some of them at the limit", () => {
    expect(layouts).toBeGreaterThanOrEqual(100);
    expect(widest).toBeGreaterThan(0.99);
  });
});

describe("M2 review, finding F1: the oracle does not see rows that are too far apart", () => {
  const rect = (w: number, h: number) => [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  // Two rows of five heads, 1.8 m apart along the row; the rows `gap` apart, each `wall` from its wall.
  const twoRows = (gap: number, wall: number) =>
    [0, 1].flatMap((r) => [0, 1, 2, 3, 4].map((k) => ({ id: `r${r}h${k}`, rowId: `r${r}`, x: 900 + 1800 * k, y: wall + r * gap })));

  it.each([
    ["ELH", 6000, 2300],
    ["OH1", 4500, 2000],
  ] as const)("KNOWN LIMIT %s: rows %i mm apart pass every oracle check", (hazard, gap, wall) => {
    const f = NZS4541_V1.hazards[hazard];
    const outer = rect(9000, 2 * wall + gap);
    const heads = twoRows(gap, wall);
    expect(gap).toBeGreaterThan(f.Smax * 1000);
    // Measured strictly, the layout breaks max spacing across the rows ...
    expect(auditRows([outer], heads, 0, f.Smax * 1000).across).toBe(gap);
    expect(neighbourGaps({ outer }, heads)[0].distance).toBe(gap);
    // ... and the oracle passes it without a warning, reporting the 1.8 m along the rows (the report row is "Nearest head" for this reason).
    const report = checkZone({ barriers: [{ kind: "wall", ring: outer }] }, heads, f);
    expect(report.pass).toBe(true);
    expect(report.flags).toEqual([]);
    expect(report.maxNNSpacingM).toBe(1.8);
    // When this is fixed (a row-aware check for hand-edited heads), this test must change with it.
  });
});
