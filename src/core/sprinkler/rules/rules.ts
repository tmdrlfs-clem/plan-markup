// Story 9.1 (FR79, A7, AR24): the NZS 4541 rule figures and the default
// use → hazard mapping, as versioned data. The JSON files here are the source
// of truth: the migration seeds the same values into `rule_figures` and
// `use_hazard_map` (scripts/check-rule-seed.mjs fails when they disagree), and
// every layout records the { id, version } it used. Framework-free.
//
// Units: metres and square metres. A ruleset may carry extra named tables
// (each with its own `verified` flag) for figures not used in placement yet.

import { z } from "zod";

import nzs4541v1 from "./nzs4541.v1.json";
import useHazardV1 from "./use-hazard.v1.json";

export const HAZARDS = ["ELH", "OH1", "OH2", "OH3"] as const;
export type Hazard = (typeof HAZARDS)[number];

const metres = z.number().finite().positive();

export const hazardRuleSchema = z
  .strictObject({ Amax: metres, Smax: metres, Smin: metres, Wmax: metres, Wmin: metres })
  .refine((r) => r.Smin < r.Smax, { message: "Smin must be below Smax", path: ["Smin"] })
  .refine((r) => r.Wmin < r.Wmax, { message: "Wmin must be below Wmax", path: ["Wmin"] });
export type HazardRule = z.infer<typeof hazardRuleSchema>;

const TABLE_NAME = /^[a-z][A-Za-z0-9]{0,39}$/;

/** An extra named table (e.g. wallReduced): its own `verified` flag, one value per hazard. */
export const ruleTableSchema = z.strictObject({
  verified: z.boolean(),
  source: z.string().min(1).max(500),
  values: z.strictObject({ ELH: z.number().finite(), OH1: z.number().finite(), OH2: z.number().finite(), OH3: z.number().finite() }),
});
export type RuleTable = z.infer<typeof ruleTableSchema>;

export const ruleSetSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  version: z.string().regex(/^[0-9]{1,6}$/),
  verified: z.boolean(),
  source: z.string().min(1).max(500),
  units: z.literal("m"),
  hazards: z.strictObject({ ELH: hazardRuleSchema, OH1: hazardRuleSchema, OH2: hazardRuleSchema, OH3: hazardRuleSchema }),
  tables: z.record(z.string().regex(TABLE_NAME), ruleTableSchema).default({}),
});
export type RuleSet = z.infer<typeof ruleSetSchema>;

/** A use's name: letters first, then letters, digits, spaces, "/", "&" or "-" (≤ 40). */
export const USE_NAME = /^[A-Za-z][A-Za-z0-9 /&-]{0,39}$/;

export const useHazardMapSchema = z
  .strictObject({
    id: z.literal("use-hazard"),
    version: z.string().regex(/^[0-9]{1,6}$/),
    verified: z.boolean(),
    source: z.string().min(1).max(500),
    defaultUse: z.string().regex(USE_NAME),
    uses: z
      .array(z.strictObject({ use: z.string().regex(USE_NAME), hazard: z.enum(HAZARDS) }))
      .min(1)
      .max(200),
  })
  .refine((m) => new Set(m.uses.map((u) => u.use.toLowerCase())).size === m.uses.length, { message: "each use once", path: ["uses"] })
  .refine((m) => m.uses.some((u) => u.use === m.defaultUse), { message: "the default use is in the map", path: ["defaultUse"] });
export type UseHazardMap = z.infer<typeof useHazardMapSchema>;

/** The built-in ruleset (NZS 4541, v1, founder-verified placement figures). */
export const NZS4541_V1: RuleSet = ruleSetSchema.parse(nzs4541v1);

/** The built-in default use → hazard mapping (draft, unverified). */
export const USE_HAZARD_V1: UseHazardMap = useHazardMapSchema.parse(useHazardV1);

/** The radius every point must be within: half the diagonal of the largest compliant S × A/S cell (m). */
export function coverageRadius(rule: HazardRule): number {
  return 0.5 * Math.hypot(rule.Smax, rule.Amax / rule.Smax);
}

/** The largest spacing along a row when rows are `rowSpacing` apart (m). */
export function rowSpacingLimit(rule: HazardRule, rowSpacing: number): number {
  return Math.min(rule.Smax, rule.Amax / rowSpacing);
}

/** The hazard for a use (case-insensitive), or null when the map does not name it. */
export function hazardOf(map: UseHazardMap, use: string): Hazard | null {
  const key = use.trim().toLowerCase();
  return map.uses.find((u) => u.use.toLowerCase() === key)?.hazard ?? null;
}
