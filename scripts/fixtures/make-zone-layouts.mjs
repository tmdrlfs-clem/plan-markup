// Story 9.4: reference head layouts for the oracle tests, one file per sample and hazard in
// fixtures/zones/layouts/<sample>.<hazard>.json (format plan-markup.zone-layout/1).
//
// The heads come from the Story 2.2 spike placer (spikes/4541-placement). They are test DATA:
// the production oracle (src/core/sprinkler/oracle) never imports the spike or any placer, it only
// reads these files in its tests and must find zero errors on each. Heads are rounded to 0.1 mm.
//
// Usage: node scripts/fixtures/make-zone-layouts.mjs [--check]
//   --check: exit 1 when a file is missing or differs from what the spike produces now.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const spike = (rel) => import(pathToFileURL(path.join(root, "spikes", "4541-placement", "src", rel)).href);
const { NZS4541_V1 } = await spike("rules.js");
const { samplesFromFixtures } = await spike("zones.js");
const { runSite } = await spike("site.js");

const ZONES = path.join(root, "fixtures", "zones");
const OUT = path.join(ZONES, "layouts");
const check = process.argv.includes("--check");

const docs = readdirSync(ZONES)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(ZONES, f), "utf8")));
const slugOf = new Map(docs.map((d) => [`${d.sample.id}/${d.zone.zoneId}`, d.slug]));
const round = (v) => Math.round(v * 10) / 10;

let problems = 0;
if (!check) mkdirSync(OUT, { recursive: true });
for (const sample of samplesFromFixtures(docs)) {
  if (sample.infeasible) continue;
  for (const hazard of [sample.zones[0].hazard, ...sample.alsoHazards]) {
    const zones = sample.zones.map((z) => ({ ...z, hazard }));
    const site = runSite(zones, NZS4541_V1);
    const bad = site.filter((p) => !p.res.ok || p.report.errors > 0);
    if (bad.length) {
      console.error(`${sample.id} ${hazard}: the spike layout is not clean (${bad.map((p) => p.zone.zoneId).join(", ")}); skipped`);
      problems++;
      continue;
    }
    const doc = {
      format: "plan-markup.zone-layout/1",
      sample: sample.id,
      hazard,
      ruleSet: { id: NZS4541_V1.id, version: NZS4541_V1.version },
      generator: "spikes/4541-placement placer (reference data for the oracle tests only)",
      units: "mm",
      zones: site.map((p) => ({
        slug: slugOf.get(`${sample.id}/${p.zone.zoneId}`),
        zoneId: p.zone.zoneId,
        heads: p.res.heads.map((h) => ({ id: h.id, x: round(h.x), y: round(h.y) })),
      })),
    };
    const file = path.join(OUT, `${sample.id.toLowerCase()}.${hazard.toLowerCase()}.json`);
    const text = `${JSON.stringify(doc, null, 1)}\n`;
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
        console.error(`${path.relative(root, file)} is missing or out of date`);
        problems++;
      }
    } else {
      writeFileSync(file, text);
    }
  }
}
if (check && problems) process.exit(1);
console.log(check ? "Zone layouts match the spike." : `Wrote zone layouts to ${path.relative(root, OUT)}`);
