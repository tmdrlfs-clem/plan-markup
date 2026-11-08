// Story 9.5 (design §3, §7): the composition layer between the placer and the
// oracle. It is the only module that sees both: the placer places, the oracle
// checks the result against the original zone, and nothing flows back from
// the check into placement (no repair). Pure and synchronous; the engine
// worker adds async, progress and cancel around these steps.

import { checkZone, type OracleReport, type OracleZone } from "../oracle";
import { placeZone, type PlaceInput, type PlaceResult, type PlacedHead } from "../placer";
import type { Hazard, RuleSet } from "../rules/rules";

/** A zone as the engine receives it: the placer input plus its hazard class. */
export type EngineZone = Omit<PlaceInput, "neighbourHeads"> & { hazard: Hazard };
export type ZoneOutcome = { zoneId: string; hazard: Hazard; result: PlaceResult; report: OracleReport | null };

export function oracleZoneOf(z: Pick<PlaceInput, "barriers" | "openEdges" | "keepOuts">): OracleZone {
  return { barriers: z.barriers, openEdges: z.openEdges ?? [], keepOuts: z.keepOuts ?? [] };
}

const ruleSetRef = (rules: RuleSet) => ({ id: rules.id, version: rules.version, verified: rules.verified });

/** Places one zone; heads of the zones placed before it are its neighbours (spacing across open edges). */
export function placeInSequence(zone: EngineZone, earlier: readonly PlaceResult[], rules: RuleSet, idPrefix?: string): PlaceResult {
  const neighbourHeads = earlier.flatMap((r) => r.heads.map((h) => ({ x: h.x, y: h.y })));
  return placeZone({ ...zone, neighbourHeads }, rules.hazards[zone.hazard], { idPrefix });
}

/** The oracle's report for one zone's heads, with the other zones of the site as neighbours. */
export function checkPlacement(
  zone: EngineZone,
  heads: readonly Pick<PlacedHead, "id" | "x" | "y">[],
  others: readonly { zone: EngineZone; heads: readonly Pick<PlacedHead, "id" | "x" | "y">[] }[],
  rules: RuleSet,
): OracleReport {
  return checkZone(
    oracleZoneOf(zone),
    heads.map((h) => ({ id: h.id, x: h.x, y: h.y })),
    rules.hazards[zone.hazard],
    {
      neighbours: others.map((o) => ({ zone: oracleZoneOf(o.zone), heads: o.heads.map((h) => ({ id: h.id, x: h.x, y: h.y })) })),
      ruleSet: ruleSetRef(rules),
    },
  );
}

/** Places the zones of one site in order, then checks each with the independent oracle. */
export function placeSite(zones: readonly EngineZone[], rules: RuleSet, idPrefix?: string): ZoneOutcome[] {
  const results: PlaceResult[] = [];
  for (const z of zones) results.push(placeInSequence(z, results, rules, idPrefix));
  return zones.map((z, i) => ({
    zoneId: z.zoneId,
    hazard: z.hazard,
    result: results[i],
    report: results[i].heads.length || results[i].ok ? checkPlacement(z, results[i].heads, others(zones, results, i), rules) : null,
  }));
}

export function others(zones: readonly EngineZone[], results: readonly PlaceResult[], i: number) {
  return zones.flatMap((zone, k) => (k === i ? [] : [{ zone, heads: results[k].heads }]));
}
