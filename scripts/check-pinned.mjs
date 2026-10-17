// Fails when any package.json dependency uses a range instead of an exact version (NFR33).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXACT_SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/** Returns "section: name@spec" for every dependency that is not an exact semver. */
export function findUnpinned(pkg) {
  const offenders = [];
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (typeof spec !== "string" || !EXACT_SEMVER.test(spec)) {
        offenders.push(`${section}: ${name}@${String(spec)}`);
      }
    }
  }
  return offenders;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const offenders = findUnpinned(pkg);
  if (offenders.length > 0) {
    console.error("Unpinned dependencies (exact versions only):");
    for (const line of offenders) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log("All dependencies are pinned to exact versions.");
}
