// Sample zones for the placement spike, built from the zone fixtures (fixtures/zones/*.json, the
// single source of truth; format in fixtures/README.md, generator export-zones.mjs).
// This module does no I/O: test/run.mjs reads the files, build.mjs inlines them into the demo.
//
// Output sample shape (what site.js, test/run.mjs and the demo use):
//   { id, name, group, zones: [{zoneId, hazard, pattern, outer:[{x,y}], holes?:[{kind, ring}],
//     openEdges?:[{a,b}], grid?, keepOuts?, expected}], hand: {HZ: n}, lowerBound: {HZ: n},
//     alsoHazards: [HZ], infeasible: bool, expectedError: code | null }

const pts = pairs => pairs.map(([x, y]) => ({ x, y }));

function zoneFrom(z) {
  const out = { zoneId: z.zoneId, hazard: z.hazard, pattern: z.pattern || 'rectangular', outer: pts(z.outer) };
  if (z.holes) out.holes = z.holes.map(h => ({ kind: h.kind, ring: pts(h.ring) }));
  if (z.openEdges) out.openEdges = z.openEdges.map(([a, b]) => ({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } }));
  if (z.grid) out.grid = { ...z.grid };
  // keep-outs are carried as data only; the spike placer and oracle ignore them
  if (z.keepOuts) out.keepOuts = z.keepOuts.map(k => (k.ring ? { kind: k.kind, ring: pts(k.ring) } : { ...k }));
  return out;
}

export function samplesFromFixtures(docs) {
  const sorted = docs.slice().sort((a, b) => (a.sample.index - b.sample.index) || (a.sample.zone - b.sample.zone));
  const out = [];
  for (const d of sorted) {
    if (d.format !== 'plan-markup.zone-fixture/1') throw new Error(`${d.slug}: unknown fixture format ${d.format}`);
    let s = out.find(x => x.id === d.sample.id);
    if (!s) {
      const err = d.expected && d.expected.error ? d.expected.error : null;
      s = { id: d.sample.id, name: d.sample.name, group: d.sample.group, zones: [], hand: {}, lowerBound: {},
        alsoHazards: [], infeasible: !!err, expectedError: err };
      out.push(s);
    }
    s.zones.push({ ...zoneFrom(d.zone), expected: d.expected });
    if (d.sample.zones === 1) s.alsoHazards = d.hazards.slice(1);
    if (!s.expectedError) {
      for (const [hz, e] of Object.entries(d.expected)) {
        if (e.hand != null) s.hand[hz] = e.hand;
        if (d.sample.zones === 1) s.lowerBound[hz] = e.lowerBound;
      }
    }
  }
  for (const s of out) {
    const n = sorted.find(d => d.sample.id === s.id).sample.zones;
    if (s.zones.length !== n) throw new Error(`${s.id}: ${s.zones.length} of ${n} zone fixtures found`);
  }
  return out;
}
