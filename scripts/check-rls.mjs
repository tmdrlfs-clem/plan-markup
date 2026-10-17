// Fails when a table in schemas public or app lacks RLS or has no policy (NFR20).
// Same rule as supabase/tests/rls_coverage.test.sql, with readable CI output.
// Needs the local stack: npm run db:start.
import { fileURLToPath } from "node:url";

export const DEFAULT_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

export const COVERAGE_SQL = `
  select n.nspname as schema,
         c.relname as table,
         c.relrowsecurity as rls_enabled,
         (select count(*)::int from pg_catalog.pg_policies p
           where p.schemaname = n.nspname and p.tablename = c.relname) as policy_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app')
    and c.relkind in ('r', 'p')
  order by 1, 2
`;

/**
 * Splits coverage rows into tables without RLS and tables without any policy.
 * @param {{schema: string, table: string, rls_enabled: boolean, policy_count: number}[]} rows
 * @returns {{noRls: string[], noPolicy: string[]}}
 */
export function findRlsOffenders(rows) {
  const noRls = [];
  const noPolicy = [];
  for (const r of rows) {
    const name = `${r.schema}.${r.table}`;
    if (!r.rls_enabled) noRls.push(name);
    if (!(Number(r.policy_count) > 0)) noPolicy.push(name);
  }
  return { noRls, noPolicy };
}

async function main() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL ?? DEFAULT_DB_URL });
  try {
    await client.connect();
  } catch (err) {
    process.stderr.write(`Could not connect to the local database. Is the stack running (npm run db:start)?\n${err.message}\n`);
    process.exit(1);
  }
  let rows;
  try {
    ({ rows } = await client.query(COVERAGE_SQL));
  } finally {
    await client.end();
  }
  const { noRls, noPolicy } = findRlsOffenders(rows);
  if (noRls.length === 0 && noPolicy.length === 0) {
    process.stdout.write(`RLS coverage OK: ${rows.length} table(s) in public/app, all with RLS and at least one policy.\n`);
    return;
  }
  if (noRls.length > 0) {
    process.stderr.write("Tables without row level security:\n");
    for (const t of noRls) process.stderr.write(`  ${t}\n`);
  }
  if (noPolicy.length > 0) {
    process.stderr.write("Tables without any policy:\n");
    for (const t of noPolicy) process.stderr.write(`  ${t}\n`);
  }
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
