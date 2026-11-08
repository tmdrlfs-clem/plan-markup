import { describe, expect, it } from "vitest";

import { NZS4541_V1, USE_HAZARD_V1, coverageRadius, hazardOf, ruleSetSchema, rowSpacingLimit, useHazardMapSchema } from "./rules";

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
});
