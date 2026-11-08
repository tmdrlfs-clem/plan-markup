// Story 9.1 (A7): fails when the migration's seed of NZS 4541 rule figures or
// the default use → hazard mapping disagrees with the JSON in
// src/core/sprinkler/rules (the source of truth). Run on a freshly migrated
// local stack (CI's Database job): admin edits in production legitimately differ.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DEFAULT_DB_URL } from "./check-rls.mjs";

const RULES = new URL("../src/core/sprinkler/rules/", import.meta.url);

/** Same JSON values (numbers compared by value, key order ignored). */
function same(a, b) {
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
}

/**
 * Differences between the JSON rule files and the DB rows, as readable lines.
 * @param {{ ruleSet: any, useMap: any, figureRows: any[], mapRows: any[] }} input
 * @returns {string[]}
 */
export function findSeedDrift({ ruleSet, useMap, figureRows, mapRows }) {
  const drift = [];
  const row = figureRows.find((r) => r.ruleset_id === ruleSet.id && r.version === ruleSet.version);
  if (!row) {
    drift.push(`rule_figures has no ${ruleSet.id} v${ruleSet.version}`);
  } else {
    if (row.verified !== ruleSet.verified) drift.push(`rule_figures.verified ${row.verified} ≠ ${ruleSet.verified}`);
    if (row.source !== ruleSet.source) drift.push("rule_figures.source differs");
    if (!same(row.hazards, ruleSet.hazards)) drift.push("rule_figures.hazards differ");
    if (!same(row.tables, ruleSet.tables ?? {})) drift.push("rule_figures.tables differ");
  }
  const seeded = mapRows.filter((r) => r.company_id === null);
  if (seeded.length !== useMap.uses.length) drift.push(`use_hazard_map has ${seeded.length} default uses, the JSON ${useMap.uses.length}`);
  for (const u of useMap.uses) {
    const r = seeded.find((x) => x.use === u.use);
    if (!r) drift.push(`use_hazard_map lacks ${u.use}`);
    else {
      if (r.hazard !== u.hazard) drift.push(`use_hazard_map ${u.use}: ${r.hazard} ≠ ${u.hazard}`);
      if (r.is_default !== (u.use === useMap.defaultUse)) drift.push(`use_hazard_map ${u.use}: default flag differs`);
      if (r.verified !== useMap.verified) drift.push(`use_hazard_map ${u.use}: verified differs`);
      if (r.map_version !== useMap.version) drift.push(`use_hazard_map ${u.use}: version differs`);
    }
  }
  return drift;
}

async function main() {
  const ruleSet = JSON.parse(readFileSync(new URL("nzs4541.v1.json", RULES), "utf8"));
  const useMap = JSON.parse(readFileSync(new URL("use-hazard.v1.json", RULES), "utf8"));
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL });
  try {
    await client.connect();
  } catch (err) {
    process.stderr.write(`Could not connect to the local database. Is the stack running (npm run db:start)?\n${err.message}\n`);
    process.exit(1);
  }
  let figureRows;
  let mapRows;
  try {
    ({ rows: figureRows } = await client.query("select ruleset_id, version, verified, source, hazards, tables from public.rule_figures"));
    ({ rows: mapRows } = await client.query("select company_id, map_version, use, hazard, is_default, verified from public.use_hazard_map"));
  } finally {
    await client.end();
  }
  const drift = findSeedDrift({ ruleSet, useMap, figureRows, mapRows });
  if (drift.length === 0) {
    process.stdout.write(`Rule seed OK: ${ruleSet.id} v${ruleSet.version} and ${useMap.uses.length} default uses match the JSON.\n`);
    return;
  }
  process.stderr.write("The DB seed and src/core/sprinkler/rules disagree:\n");
  for (const d of drift) process.stderr.write(`  ${d}\n`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
