// Story 9.3 (FR71, FR72): the use → hazard mapping a user's zones follow: their
// company's rows when it has any, else the platform default rows, else the
// built-in JSON (offline, or before the rows are read). Framework-free.

import { HAZARDS, NZS4541_V1, USE_HAZARD_V1, hazardOf, useHazardMapSchema, type Hazard, type HazardRule, type RuleSet, type UseHazardMap } from "./rules/rules";

/** A `use_hazard_map` row as read. */
export type UseHazardRow = {
  company_id: string | null;
  map_version: string;
  use: string;
  hazard: string;
  is_default: boolean;
  verified: boolean;
};

export type MappingSource = "company" | "platform" | "built-in";

export type ResolvedUseMap = { map: UseHazardMap; source: MappingSource };

export const MAPPING_SOURCE_LABELS: Record<MappingSource, string> = {
  company: "Company mapping",
  platform: "Platform default mapping",
  "built-in": "Built-in default mapping",
};

function mapOf(rows: readonly UseHazardRow[], source: Exclude<MappingSource, "built-in">): UseHazardMap | null {
  if (rows.length === 0) return null;
  const parsed = useHazardMapSchema.safeParse({
    id: "use-hazard",
    version: rows[0].map_version,
    verified: rows.every((r) => r.verified),
    source: MAPPING_SOURCE_LABELS[source],
    defaultUse: (rows.find((r) => r.is_default) ?? rows[0]).use,
    uses: [...rows].sort((a, b) => a.use.localeCompare(b.use)).map((r) => ({ use: r.use, hazard: r.hazard })),
  });
  return parsed.success ? parsed.data : null;
}

/** The mapping for `companyId`: its rows, else the platform's (company_id null), else the built-in one. */
export function resolveUseMap(rows: readonly UseHazardRow[], companyId: string | null): ResolvedUseMap {
  const company = companyId ? mapOf(rows.filter((r) => r.company_id === companyId), "company") : null;
  if (company) return { map: company, source: "company" };
  const platform = mapOf(rows.filter((r) => r.company_id === null), "platform");
  if (platform) return { map: platform, source: "platform" };
  return { map: USE_HAZARD_V1, source: "built-in" };
}

/** The uses offered for a zone: the mapping's, plus the zone's own when the mapping lacks it (shown unmapped). */
export function useOptions(map: UseHazardMap, current: string): { use: string; hazard: Hazard | null }[] {
  const options: { use: string; hazard: Hazard | null }[] = map.uses.map((u) => ({ use: u.use, hazard: u.hazard }));
  if (!hazardOf(map, current)) options.push({ use: current, hazard: null });
  return options;
}

/** The figures a hazard class places by, with the ruleset that holds them. */
export type ZoneFigures = { hazard: Hazard; rule: HazardRule; ruleset: string };

export function figuresOf(hazard: Hazard | null, rules: RuleSet = NZS4541_V1): ZoneFigures | null {
  if (!hazard || !HAZARDS.includes(hazard)) return null;
  return { hazard, rule: rules.hazards[hazard], ruleset: `${rules.id.toUpperCase().replace(/^NZS/, "NZS ")} v${rules.version}` };
}

/** The figures as shown: label, value with its unit. */
export function figureRows(rule: HazardRule): { key: keyof HazardRule; label: string; value: string }[] {
  const m = (v: number) => `${Number(v.toFixed(2))} m`;
  return [
    { key: "Amax", label: "Max area per head", value: `${Number(rule.Amax.toFixed(2))} m²` },
    { key: "Smax", label: "Max spacing", value: m(rule.Smax) },
    { key: "Smin", label: "Min spacing", value: m(rule.Smin) },
    { key: "Wmax", label: "Max to wall", value: m(rule.Wmax) },
    { key: "Wmin", label: "Min to wall", value: m(rule.Wmin) },
  ];
}
