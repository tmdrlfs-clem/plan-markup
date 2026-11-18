// CI's runtime dependency audit: fails on any high or critical advisory in the
// production dependencies, except the ones accepted below, each with its reason.
// An accepted advisory stops being accepted on its review date, so CI fails
// again and someone looks at it.
//
//   node scripts/audit-runtime.mjs
import { execSync } from "node:child_process";

/** GHSA id → why it is accepted, and the date to look again (YYYY-MM-DD). */
export const ACCEPTED = {
  "GHSA-fc5q-39xc-vjpf": {
    reason:
      "picomatch ReDoS (every version <=4.0.7, no fix yet). Reached only through @sentry/nextjs's build-time bundler plugins (@rollup/pluginutils, @rollup/plugin-commonjs), which match our own file paths at build time, never user input.",
    review: "2026-12-18",
  },
};

/** The advisory ids (GHSA) at high or critical, from `npm audit --json`. */
export function highAdvisories(report) {
  const ids = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via) {
      if (typeof via === "string") continue;
      if (via.severity !== "high" && via.severity !== "critical") continue;
      const id =
        String(via.url ?? "")
          .split("/")
          .pop() || String(via.source);
      ids.set(id, `${via.name}: ${via.title} (${via.severity})`);
    }
  }
  return ids;
}

/** The advisories that fail the audit on `today` (YYYY-MM-DD). */
export function failing(ids, today, accepted = ACCEPTED) {
  return [...ids].filter(
    ([id]) => !(accepted[id] && today <= accepted[id].review),
  );
}

function main() {
  let out;
  try {
    out = execSync("npm audit --omit=dev --json", { encoding: "utf8" });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    out = error.stdout;
  }
  const ids = highAdvisories(JSON.parse(out));
  const today = new Date().toISOString().slice(0, 10);
  for (const [id, text] of ids) {
    const a = ACCEPTED[id];
    if (a && today <= a.review)
      console.log(`accepted until ${a.review}: ${id} ${text}`);
  }
  const bad = failing(ids, today);
  for (const [id, text] of bad) console.error(`high: ${id} ${text}`);
  if (bad.length > 0) process.exit(1);
  console.log(
    "No unaccepted high or critical advisories in runtime dependencies.",
  );
}

if (process.argv[1]?.endsWith("audit-runtime.mjs")) main();
