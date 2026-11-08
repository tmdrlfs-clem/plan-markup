import { describe, expect, it } from "vitest";

import { NZS4541_V1, USE_HAZARD_V1 } from "./rules/rules";
import { figureRows, figuresOf, resolveUseMap, useOptions, type UseHazardRow } from "./use-map";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const platform: UseHazardRow[] = USE_HAZARD_V1.uses.map((u) => ({
  company_id: null,
  map_version: "1",
  use: u.use,
  hazard: u.hazard,
  is_default: u.use === "Office",
  verified: false,
}));
const company: UseHazardRow[] = [
  { company_id: COMPANY, map_version: "3", use: "Office", hazard: "OH1", is_default: false, verified: true },
  { company_id: COMPANY, map_version: "3", use: "Lab", hazard: "OH2", is_default: true, verified: true },
];

describe("use → hazard mapping (Story 9.3)", () => {
  it("uses the company's rows when it has any, else the platform's, else the built-in map", () => {
    const own = resolveUseMap([...platform, ...company], COMPANY);
    expect(own.source).toBe("company");
    expect(own.map).toMatchObject({ version: "3", verified: true, defaultUse: "Lab" });
    expect(own.map.uses).toEqual([
      { use: "Lab", hazard: "OH2" },
      { use: "Office", hazard: "OH1" },
    ]);

    const fallback = resolveUseMap([...platform, ...company], "c0000000-0000-4000-8000-000000000002");
    expect(fallback.source).toBe("platform");
    expect(fallback.map).toMatchObject({ verified: false, defaultUse: "Office" });
    expect(fallback.map.uses).toHaveLength(8);
    expect(resolveUseMap(platform, null).source).toBe("platform");

    expect(resolveUseMap([], null)).toEqual({ map: USE_HAZARD_V1, source: "built-in" });
    // Rows that do not make a valid map (a hazard the rules lack) fall through.
    expect(resolveUseMap([{ ...platform[0], hazard: "HH1" }], null).source).toBe("built-in");
  });

  it("offers the mapping's uses, plus the zone's own when unmapped", () => {
    expect(useOptions(USE_HAZARD_V1, "Office")).toHaveLength(8);
    expect(useOptions(USE_HAZARD_V1, "Hangar").at(-1)).toEqual({ use: "Hangar", hazard: null });
  });

  it("shows a hazard's figures and the ruleset version", () => {
    const f = figuresOf("ELH")!;
    expect(f.ruleset).toBe("NZS 4541 v1");
    expect(f.rule).toEqual(NZS4541_V1.hazards.ELH);
    expect(figureRows(f.rule).map((r) => `${r.key} ${r.value}`)).toEqual(["Amax 21 m²", "Smax 4.6 m", "Smin 1.8 m", "Wmax 2.3 m", "Wmin 0.05 m"]);
    expect(figureRows(figuresOf("OH2")!.rule)[0].value).toBe("12 m²");
    expect(figuresOf(null)).toBeNull();
  });
});
