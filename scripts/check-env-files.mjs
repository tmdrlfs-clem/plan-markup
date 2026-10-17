// Fails when a tracked file is named .env* other than .env.example (NFR23).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Returns the tracked paths whose basename starts with ".env" and is not ".env.example". */
export function findForbiddenEnvFiles(paths) {
  return paths.filter((p) => {
    const base = p.split("/").pop() ?? p;
    return base.startsWith(".env") && base !== ".env.example";
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  const bad = findForbiddenEnvFiles(out.split("\0").filter(Boolean));
  if (bad.length > 0) {
    console.error("Tracked env files are forbidden (only .env.example is allowed):");
    for (const p of bad) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log("No forbidden .env files are tracked.");
}
