// Fails when src/lib/db/types.gen.ts differs from `supabase gen types` for the local database (NFR47).
// Fix drift with: npm run db:types
// Needs the local stack: npm run db:start.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { firstDifferences, SCHEMAS } from "./check-schema-drift.mjs";

export const TYPES_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "db", "types.gen.ts");

/** Normalises CRLF and trailing whitespace; ends with exactly one newline. */
export function normalizeTypes(text) {
  return `${text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()}\n`;
}

/** Runs `supabase gen types` against the local stack and returns normalised output. */
export function generateTypes() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const out = execSync(`npx supabase gen types typescript --local --schema ${SCHEMAS}`, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return normalizeTypes(out);
}

function main() {
  let generated;
  try {
    generated = generateTypes();
  } catch (err) {
    process.stderr.write("Could not generate types. Is the stack running (npm run db:start)?\n");
    process.stderr.write(`${err.stderr?.toString() ?? err.message}\n`);
    process.exit(1);
  }
  const committed = normalizeTypes(readFileSync(TYPES_PATH, "utf8"));
  if (generated === committed) {
    process.stdout.write("src/lib/db/types.gen.ts matches the local database. No drift.\n");
    return;
  }
  process.stderr.write("Types drift: src/lib/db/types.gen.ts differs from `supabase gen types`.\n");
  process.stderr.write("Run `npm run db:types` and commit the result.\n");
  process.stderr.write("First differences:\n");
  process.stderr.write(`${firstDifferences(committed.trimEnd(), generated.trimEnd()).join("\n")}\n`);
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
