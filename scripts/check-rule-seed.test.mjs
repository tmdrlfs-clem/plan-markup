import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findSeedDrift } from "./check-rule-seed.mjs";

const RULES = new URL("../src/core/sprinkler/rules/", import.meta.url);
const ruleSet = JSON.parse(readFileSync(new URL("nzs4541.v1.json", RULES), "utf8"));
const useMap = JSON.parse(readFileSync(new URL("use-hazard.v1.json", RULES), "utf8"));

const figureRows = () => [{ ruleset_id: "nzs4541", version: "1", verified: true, source: ruleSet.source, hazards: structuredClone(ruleSet.hazards), tables: structuredClone(ruleSet.tables) }];
const mapRows = () =>
  useMap.uses.map((u) => ({ company_id: null, map_version: "1", use: u.use, hazard: u.hazard, is_default: u.use === useMap.defaultUse, verified: false }));

describe("findSeedDrift (Story 9.1)", () => {
  it("finds nothing when the DB matches the JSON (numbers by value, key order ignored)", () => {
    const rows = figureRows();
    rows[0].hazards.OH1 = { Wmin: 0.05, Wmax: 2, Smin: 1.8, Smax: 4, Amax: 12 };
    expect(findSeedDrift({ ruleSet, useMap, figureRows: rows, mapRows: [...mapRows(), { company_id: "c", use: "Office", hazard: "OH3" }] })).toEqual([]);
  });

  it("names each disagreement", () => {
    const rows = figureRows();
    rows[0].hazards.ELH.Wmax = 2.0;
    const map = mapRows();
    map[3].hazard = "OH2";
    map.pop();
    expect(findSeedDrift({ ruleSet, useMap, figureRows: rows, mapRows: map })).toEqual([
      "rule_figures.hazards differ",
      "use_hazard_map has 7 default uses, the JSON 8",
      "use_hazard_map Kitchen: OH2 ≠ OH1",
      "use_hazard_map lacks Carpark",
    ]);
    expect(findSeedDrift({ ruleSet, useMap, figureRows: [], mapRows: mapRows() })).toEqual(["rule_figures has no nzs4541 v1"]);
  });
});
