// Maps `supabase status -o json` (local stack) to the app's env variables.
//   node scripts/supabase-env.mjs --github-env    append KEY=value lines to $GITHUB_ENV (CI)
//   node scripts/supabase-env.mjs --write .env.local  update the three keys, keep every other line
// Needs the local stack: npm run db:start. Never prints key values.
import { execSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

/**
 * Maps the CLI 2.121.0 status JSON to env vars. Prefers the publishable and
 * secret keys and falls back to the legacy anon and service-role JWTs.
 * @param {Record<string, unknown>} json
 * @returns {Record<string, string>}
 */
export function mapStatusToEnv(json) {
  const pick = (...names) => {
    for (const name of names) {
      const value = json?.[name];
      if (typeof value === "string" && value !== "") return value;
    }
    return undefined;
  };
  const vars = {
    NEXT_PUBLIC_SUPABASE_URL: pick("API_URL"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: pick("PUBLISHABLE_KEY", "ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: pick("SECRET_KEY", "SERVICE_ROLE_KEY"),
  };
  const missing = ENV_KEYS.filter((k) => vars[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`supabase status is missing values for: ${missing.join(", ")}`);
  }
  return /** @type {Record<string, string>} */ (vars);
}

/**
 * Sets `vars` in an env file's text: replaces existing `KEY=` lines (first
 * occurrence; later duplicates are dropped), appends missing keys, keeps every
 * other line as it was.
 * @param {string} text
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function mergeEnvFile(text, vars) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    if (key && Object.hasOwn(vars, key)) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${key}=${vars[key]}`);
    } else {
      out.push(line);
    }
  }
  for (const [key, value] of Object.entries(vars)) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  return `${out.join(eol)}${eol}`;
}

function readStatus() {
  const out = execSync("npx supabase status -o json", {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return JSON.parse(out);
}

function main() {
  const args = process.argv.slice(2);
  let vars;
  try {
    vars = mapStatusToEnv(readStatus());
  } catch (err) {
    process.stderr.write(
      `Could not read the local Supabase status. Is the stack running (npm run db:start)?\n${err.message}\n`,
    );
    process.exit(1);
  }

  if (args[0] === "--github-env") {
    const target = process.env.GITHUB_ENV;
    if (!target) {
      process.stderr.write("GITHUB_ENV is not set.\n");
      process.exit(1);
    }
    appendFileSync(target, Object.entries(vars).map(([k, v]) => `${k}=${v}\n`).join(""), "utf8");
    process.stdout.write(`Exported ${Object.keys(vars).join(", ")} to GITHUB_ENV.\n`);
    return;
  }

  if (args[0] === "--write" && args[1]) {
    const path = args[1];
    const before = existsSync(path) ? readFileSync(path, "utf8") : "";
    writeFileSync(path, mergeEnvFile(before, vars), "utf8");
    process.stdout.write(`Updated ${Object.keys(vars).join(", ")} in ${path}.\n`);
    return;
  }

  process.stderr.write("Usage: node scripts/supabase-env.mjs --github-env | --write <file>\n");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
