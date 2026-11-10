import { describe, expect, it } from "vitest";

import { checkZone, type Flag } from "./oracle";
import { flagLabel, metres, reportRows, ruleBreaks, zoneStatus } from "./report";
import { NZS4541_V1 } from "./rules/rules";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const OH1 = NZS4541_V1.hazards.OH1;
const room = { barriers: [{ kind: "wall" as const, ring: rect(0, 0, 6000, 4000) }] };
const flag = (f: Partial<Flag> & Pick<Flag, "code">): Flag => ({ severity: "error", headIds: [], message: "", ...f });

describe("zone report (Story 9.11)", () => {
  it("labels each rule break briefly, in metres and m²", () => {
    expect(metres(4800)).toBe("4.8 m");
    expect(metres(4650)).toBe("4.65 m");
    expect(flagLabel(flag({ code: "MAX_SPACING", value: 4800, limit: 4600 }))).toBe("Spacing 4.8 m > 4.6 m");
    expect(flagLabel(flag({ code: "MIN_SPACING", value: 1500, limit: 2000 }))).toBe("Spacing 1.5 m < 2 m");
    expect(flagLabel(flag({ code: "WALL_CLEARANCE", value: 50, limit: 100 }))).toBe("Wall 0.05 m < 0.1 m");
    expect(flagLabel(flag({ code: "WALL_DIST", value: 2300, limit: 2000 }))).toBe("Wall 2.3 m > 2 m");
    expect(flagLabel(flag({ code: "WALL_DIST", value: Infinity, limit: 2000 }))).toBe("Wall not reached");
    expect(flagLabel(flag({ code: "UNCOVERED", value: 0.437 }))).toBe("Uncovered 0.44 m²");
    expect(flagLabel(flag({ code: "AREA_ZONE", severity: "warning", value: 12.8, limit: 12 }))).toBe("12.8 m²/head > 12 m²");
    expect(flagLabel(flag({ code: "AREA_LOCAL", severity: "warning", value: 13.06, limit: 12 }))).toBe("Cell 13.06 m² > 12 m²");
    expect(flagLabel(flag({ code: "OUTSIDE" }))).toBe("Outside zone");
  });

  it("gives a zone's status: infeasible, rule breaks, warnings, pass, or none", () => {
    const pass = checkZone(room, [{ id: "a", x: 1500, y: 2000 }, { id: "b", x: 4500, y: 2000 }], OH1, { ruleSet: NZS4541_V1 });
    expect(zoneStatus(pass)).toEqual({ kind: "pass", count: 0, text: "Checks pass" });
    const bad = checkZone(room, [{ id: "a", x: 30, y: 2000 }], OH1, { ruleSet: NZS4541_V1 });
    const s = zoneStatus(bad)!;
    expect(s.kind).toBe("error");
    expect(s.count).toBe(bad.errors);
    expect(s.text).toMatch(/^\d+ rule breaks?/);
    expect(zoneStatus(null)).toBeNull();
    expect(zoneStatus(null, true)).toEqual({ kind: "infeasible", count: 0, text: "Infeasible" });
    expect(zoneStatus({ ...pass, warnings: 2, flags: [] })).toEqual({ kind: "warning", count: 2, text: "2 warnings" });
  });

  it("reports the figures against the limits and lists breaks errors first", () => {
    const r = checkZone(room, [{ id: "a", x: 1500, y: 2000 }, { id: "b", x: 4500, y: 2000 }], OH1, { ruleSet: NZS4541_V1 });
    const rows = Object.fromEntries(reportRows(r, "OH1").map((x) => [x.key, x]));
    expect(rows.hazard.value).toBe("OH1");
    expect(rows.ruleset.value).toBe(`nzs4541 v${NZS4541_V1.version}`);
    expect(rows.heads.value).toBe("2");
    expect(rows.areaPerHead.value).toBe(`12 m² (max ${OH1.Amax} m²)`);
    expect(rows.maxSpacing.value).toBe(`3 m (max ${OH1.Smax} m)`);
    expect(rows.minWall.value).toBe(`1.5 m (min ${OH1.Wmin} m)`);
    expect(rows.maxWall.ok).toBe(true);
    expect(Object.values(rows).every((x) => x.ok)).toBe(true);

    const mixed = { ...r, flags: [flag({ code: "AREA_LOCAL", severity: "warning" }), flag({ code: "OUTSIDE" })] };
    expect(ruleBreaks(mixed).map((b) => [b.index, b.label])).toEqual([
      [1, "Outside zone"],
      [0, "Head's area"],
    ]);
  });
});
