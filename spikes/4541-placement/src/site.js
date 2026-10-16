// Composition layer (stands in for the engine worker): places the zones of one site in order,
// passing earlier zones' heads as neighbours across open edges, then checks every zone with the
// independent oracle. Placer and oracle stay unaware of each other.

import { placeZone } from './placer.js';
import { checkZone } from './oracle.js';

export function runSite(zones, ruleset, opts = {}) {
  const now = opts.now || (() => 0);
  const lockedById = opts.locked || {};
  const placed = [];
  for (const z of zones) {
    const neighbourHeads = placed.filter(p => p.res.heads.length).flatMap(p => p.res.heads);
    const t0 = now();
    const res = placeZone({ ...z, locked: lockedById[z.zoneId] || z.locked, neighbourHeads }, ruleset);
    const ms = now() - t0;
    placed.push({ zone: z, res, ms });
  }
  for (const p of placed) p.report = checkOne(p, placed, ruleset, now);
  return placed;
}

export function checkOne(p, all, ruleset, now = () => 0) {
  const t0 = now();
  const neighbours = all.filter(q => q !== p).map(q => ({ zone: q.zone, heads: q.res.heads }));
  const rep = checkZone(p.zone, p.res.heads, ruleset, p.zone.hazard, { neighbours });
  rep.checkMs = now() - t0;
  return rep;
}
