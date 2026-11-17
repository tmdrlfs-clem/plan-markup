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

/** The ruleset the app places and checks by. */
export const RULESET_ID = "nzs4541";

/** A ruleset version by name: what a layout records and what a placed head carries (A7). */
export type RuleSetRef = { id: string; version: string };

/** "NZS 4541 v2" for { id: "nzs4541", version: "2" }. */
export function rulesetLabel(ref: RuleSetRef): string {
  return `${ref.id.toUpperCase().replace(/^NZS/, "NZS ")} v${ref.version}`;
}

/** A `rule_figures` row as read. */
export type RuleFiguresRow = {
  ruleset_id: string;
  version: string;
  verified: boolean;
  source: string;
  hazards: unknown;
  tables: unknown;
  created_at?: string;
  verified_at?: string | null;
};

/** The rule set a row holds, or null when the row does not read as one. */
export function ruleSetOfRow(row: RuleFiguresRow): RuleSet | null {
  const parsed = ruleSetSchema.safeParse({
    id: row.ruleset_id,
    version: row.version,
    verified: row.verified,
    source: row.source,
    units: "m",
    hazards: row.hazards,
    tables: row.tables ?? {},
  });
  return parsed.success ? parsed.data : null;
}

/** The versions of `id` in `rows`, newest first (rows that do not read are left out). */
export function ruleSetVersions(rows: readonly RuleFiguresRow[], id: string = RULESET_ID): RuleSet[] {
  return rows
    .filter((r) => r.ruleset_id === id)
    .map(ruleSetOfRow)
    .filter((r): r is RuleSet => r !== null)
    .sort((a, b) => Number(b.version) - Number(a.version));
}

/**
 * Story 10.13 (A7): the rule set in use is the newest verified version. A
 * draft (unverified) is used by nobody. With no rows (offline, or before they
 * are read) it is the built-in one.
 */
export function ruleSetInUse(rows: readonly RuleFiguresRow[], id: string = RULESET_ID): RuleSet {
  return ruleSetVersions(rows, id).find((r) => r.verified) ?? NZS4541_V1;
}

export const FIGURE_KEYS = ["Amax", "Smax", "Smin", "Wmax", "Wmin"] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

/** What each figure is, its unit and the largest value the database takes. */
export const FIGURES: Record<FigureKey, { label: string; unit: "m" | "m²"; max: number }> = {
  Amax: { label: "Max area per head", unit: "m²", max: 100 },
  Smax: { label: "Max spacing", unit: "m", max: 50 },
  Smin: { label: "Min spacing", unit: "m", max: 50 },
  Wmax: { label: "Max to wall", unit: "m", max: 50 },
  Wmin: { label: "Min to wall", unit: "m", max: 50 },
};

const figure = (key: FigureKey) =>
  z
    .number({ error: "Enter a number." })
    .finite("Enter a number.")
    .positive("Must be above 0.")
    .max(FIGURES[key].max, `At most ${FIGURES[key].max} ${FIGURES[key].unit}.`);

const hazardFiguresInput = z
  .strictObject({ Amax: figure("Amax"), Smax: figure("Smax"), Smin: figure("Smin"), Wmax: figure("Wmax"), Wmin: figure("Wmin") })
  .refine((r) => r.Smin < r.Smax, { message: "Min spacing must be below max spacing.", path: ["Smin"] })
  .refine((r) => r.Wmin < r.Wmax, { message: "Min to wall must be below max to wall.", path: ["Wmin"] });

/** Story 10.13: the figures the platform admin saves as the next version, and where they come from. */
export const ruleFiguresInputSchema = z.strictObject({
  hazards: z.strictObject({ ELH: hazardFiguresInput, OH1: hazardFiguresInput, OH2: hazardFiguresInput, OH3: hazardFiguresInput }),
  source: z.string().trim().min(1, "Say where the figures come from.").max(500, "At most 500 characters."),
});
export type RuleFiguresInput = z.infer<typeof ruleFiguresInputSchema>;

/** The hazard for a use (case-insensitive), or null when the map does not name it. */
export function hazardOf(map: UseHazardMap, use: string): Hazard | null {
  const key = use.trim().toLowerCase();
  return map.uses.find((u) => u.use.toLowerCase() === key)?.hazard ?? null;
}
