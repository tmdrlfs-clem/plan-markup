import { describe, expect, it } from "vitest";

import {
  NZS4541_V1,
  USE_HAZARD_V1,
  coverageRadius,
  hazardOf,
  ruleFiguresInputSchema,
  ruleSetInUse,
  ruleSetOfRow,
  ruleSetSchema,
  ruleSetVersions,
  rulesetLabel,
  rowSpacingLimit,
  useHazardMapSchema,
  type RuleFiguresRow,
} from "./rules";

describe("NZS 4541 rule figures (Story 9.1)", () => {
  it("holds the founder-verified v1 figures", () => {
    expect(NZS4541_V1).toMatchObject({ id: "nzs4541", version: "1", verified: true, units: "m" });
    expect(NZS4541_V1.hazards.ELH).toEqual({ Amax: 21, Smax: 4.6, Smin: 1.8, Wmax: 2.3, Wmin: 0.05 });
    for (const h of ["OH1", "OH2", "OH3"] as const) expect(NZS4541_V1.hazards[h]).toEqual({ Amax: 12, Smax: 4.0, Smin: 1.8, Wmax: 2.0, Wmin: 0.05 });
    // Extra tables carry their own (unverified) flag.
    expect(NZS4541_V1.tables.wallReduced).toMatchObject({ verified: false, values: { ELH: 1.5 } });
  });

  it("derives the coverage radius and the row spacing limit", () => {
    expect(coverageRadius(NZS4541_V1.hazards.ELH)).toBeCloseTo(3.24, 2);
    expect(coverageRadius(NZS4541_V1.hazards.OH1)).toBeCloseTo(2.5, 2);
    expect(rowSpacingLimit(NZS4541_V1.hazards.OH1, 4)).toBe(3);
    expect(rowSpacingLimit(NZS4541_V1.hazards.ELH, 3)).toBe(4.6);
  });

  it("refuses inconsistent figures and unknown fields", () => {
    const bad = structuredClone(NZS4541_V1);
    bad.hazards.ELH.Smin = 5;
    expect(ruleSetSchema.safeParse(bad).success).toBe(false);
    expect(ruleSetSchema.safeParse({ ...NZS4541_V1, extra: 1 }).success).toBe(false);
    expect(ruleSetSchema.safeParse({ ...NZS4541_V1, tables: { "Bad Name": NZS4541_V1.tables.wallReduced } }).success).toBe(false);
  });

  it("maps uses to hazards (the draft defaults), Office by default", () => {
    expect(USE_HAZARD_V1).toMatchObject({ verified: false, defaultUse: "Office" });
    expect(hazardOf(USE_HAZARD_V1, "office")).toBe("ELH");
    expect(hazardOf(USE_HAZARD_V1, "Kitchen")).toBe("OH1");
    expect(hazardOf(USE_HAZARD_V1, " Carpark ")).toBe("OH2");
    expect(hazardOf(USE_HAZARD_V1, "Laboratory")).toBeNull();
    expect(useHazardMapSchema.safeParse({ ...USE_HAZARD_V1, uses: [...USE_HAZARD_V1.uses, { use: "OFFICE", hazard: "OH1" }] }).success).toBe(false);
  });

  it("Story 10.13: the rule set in use is the newest verified version; a draft is never it", () => {
    const row = (version: string, verified: boolean, Amax = 21): RuleFiguresRow => ({
      ruleset_id: "nzs4541",
      version,
      verified,
      source: `v${version}`,
      hazards: { ...NZS4541_V1.hazards, ELH: { ...NZS4541_V1.hazards.ELH, Amax } },
      tables: NZS4541_V1.tables,
    });
    expect(ruleSetInUse([])).toBe(NZS4541_V1);
    expect(ruleSetInUse([row("1", true), row("2", false, 20)]).version).toBe("1");
    expect(ruleSetInUse([row("1", true), row("2", true, 20), row("3", false, 19)])).toMatchObject({ version: "2", verified: true, units: "m", hazards: { ELH: { Amax: 20 } } });
    // Versions are numbers: 10 is newer than 9.
    expect(ruleSetInUse([row("9", true), row("10", true, 20)]).version).toBe("10");
    // Another ruleset's rows and rows that do not read are left out.
    expect(ruleSetInUse([{ ...row("5", true), ruleset_id: "other" }, { ...row("4", true), hazards: { ELH: {} } }, row("1", true)]).version).toBe("1");
    expect(ruleSetInUse([row("2", false, 20)])).toBe(NZS4541_V1);
    expect(ruleSetVersions([row("1", true), row("3", false), row("2", true)]).map((r) => r.version)).toEqual(["3", "2", "1"]);
    expect(ruleSetOfRow({ ...row("2", true), tables: null })?.tables).toEqual({});
  });

  it("Story 10.13: names a version and checks the figures an admin saves", () => {
    expect(rulesetLabel({ id: "nzs4541", version: "2" })).toBe("NZS 4541 v2");
    const ok = { hazards: NZS4541_V1.hazards, source: " Clause 5 " };
    expect(ruleFiguresInputSchema.parse(ok).source).toBe("Clause 5");
    const withElh = (change: object) => ({ ...ok, hazards: { ...ok.hazards, ELH: { ...ok.hazards.ELH, ...change } } });
    for (const bad of [{ Amax: 0 }, { Amax: 100.1 }, { Smax: 51 }, { Smin: 4.6 }, { Wmin: 2.3 }, { Wmax: Number.POSITIVE_INFINITY }, { Amax: "21" }, { extra: 1 }]) {
      expect(ruleFiguresInputSchema.safeParse(withElh(bad)).success).toBe(false);
    }
    expect(ruleFiguresInputSchema.safeParse({ ...ok, source: "" }).success).toBe(false);
    expect(ruleFiguresInputSchema.safeParse({ ...ok, source: "x".repeat(501) }).success).toBe(false);
    expect(ruleFiguresInputSchema.safeParse({ hazards: { ELH: ok.hazards.ELH }, source: "x" }).success).toBe(false);
  });
});
