// Fails when supabase/schema.sql differs from the schema of the local database (NFR47).
// Fix drift with: npm run db:schema
// Needs the local stack: npm run db:start.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMAS = "public,app";

/** Drops session settings and blank lines, trims line ends and normalises CRLF. */
export function normalizeSql(sql) {
  return sql
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .filter((line) => !/^SET\s/i.test(line))
    .filter((line) => !/set_config\(/i.test(line))
    .join("\n");
}

/** Returns up to `max` differences between two normalised texts as display lines. */
export function firstDifferences(expected, actual, max = 20) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const out = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len && out.length < max * 3; i++) {
    if (a[i] !== b[i]) {
      out.push(`  line ${i + 1}:`);
      out.push(`  - committed: ${a[i] ?? "(missing)"}`);
      out.push(`  + database:  ${b[i] ?? "(missing)"}`);
    }
  }
  return out;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const committedPath = join(root, "supabase", "schema.sql");
  const dir = mkdtempSync(join(tmpdir(), "schema-drift-"));
  const dumpPath = join(dir, "schema.sql");
  try {
    try {
      execSync(`npx supabase db dump --local --schema ${SCHEMAS} -f "${dumpPath}"`, {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      process.stderr.write("Could not dump the local schema. Is the stack running (npm run db:start)?\n");
      process.stderr.write(`${err.stderr?.toString() ?? err.message}\n`);
      process.exit(1);
    }
    const actual = normalizeSql(readFileSync(dumpPath, "utf8"));
    const committed = normalizeSql(readFileSync(committedPath, "utf8"));
    if (actual === committed) {
      process.stdout.write("supabase/schema.sql matches the local database. No drift.\n");
      return;
    }
    process.stderr.write("Schema drift: supabase/schema.sql differs from the local database.\n");
    process.stderr.write("Run `npm run db:reset` then `npm run db:schema` and commit the result.\n");
    process.stderr.write("First differences:\n");
    process.stderr.write(`${firstDifferences(committed, actual).join("\n")}\n`);
    process.exit(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
