// Fails when `next build` prerendered a route statically that is not allowlisted.
// Pages under the nonce CSP must render per request, or their scripts lose the
// nonce and are blocked (NFR28). Run after `npm run build`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Routes allowed in `.next/prerender-manifest.json` `routes`, read from the real
 * Story 1.6 build: `/favicon.ico` (a file route) and `/_global-error` (Next's
 * built-in global-error document, which does not use the root layout and so is
 * not made dynamic by its connection() call). Never add `/`, `/sign-in`,
 * `/workspace` or `/_not-found`. Story 13.1 adds marketing paths here together
 * with MARKETING_PATHS and the hash manifest.
 */
export const STATIC_ROUTE_ALLOWLIST = Object.freeze(["/_global-error", "/favicon.ico"]);

/** Returns the prerendered route keys that are not in the allowlist, sorted. */
export function findUnexpectedStaticRoutes(manifest, allowlist) {
  const allowed = new Set(allowlist);
  const routes = manifest && typeof manifest === "object" ? manifest.routes : undefined;
  if (!routes || typeof routes !== "object") {
    throw new Error("prerender-manifest.json has no routes object");
  }
  return Object.keys(routes)
    .filter((route) => !allowed.has(route))
    .sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = new URL("../.next/prerender-manifest.json", import.meta.url);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Cannot read .next/prerender-manifest.json (run npm run build first): ${error.message}`);
    process.exit(1);
  }
  const bad = findUnexpectedStaticRoutes(manifest, STATIC_ROUTE_ALLOWLIST);
  if (bad.length > 0) {
    console.error("Statically prerendered routes that would lose the CSP nonce:");
    for (const route of bad) console.error(`  ${route}`);
    console.error(
      "Make the page dynamic (the root layout awaits connection()) or, for a marketing page, " +
        "add it to MARKETING_PATHS with its hash manifest (Story 13.1) and to STATIC_ROUTE_ALLOWLIST.",
    );
    process.exit(1);
  }
  console.log(
    `No unexpected static routes (${Object.keys(manifest.routes).length} prerendered, all allowlisted).`,
  );
}
