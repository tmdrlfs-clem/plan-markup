// Spike test runner: placer + independent oracle on every sample zone, randomized property checks,
// oracle mutation checks and NFR6 timing. Exit code 1 if any feasible zone has an oracle ERROR.
// Usage: node test/run.mjs   (from spikes/4541-placement)

import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = rel => import(pathToFileURL(path.join(here, '..', rel)).href);
const { NZS4541_V1, validateRuleSet } = await load('src/rules.js');
const { samplesFromFixtures } = await load('src/zones.js');
// Samples come from the zone fixtures (single source of truth), see fixtures/README.md.
const FIXTURES = path.join(here, '..', '..', '..', 'fixtures', 'zones');
const SAMPLES = samplesFromFixtures(readdirSync(FIXTURES).filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(path.join(FIXTURES, f), 'utf8'))));
const { runSite } = await load('src/site.js');
const { placeZone } = await load('src/placer.js');
const { checkZone } = await load('src/oracle.js');

const RS = NZS4541_V1;
const now = () => performance.now();
let failures = 0;
const fails = [];
const failNote = msg => { failures++; fails.push(msg); };

if (validateRuleSet(RS).length) failNote('rule set invalid: ' + validateRuleSet(RS).join('; '));

const cols = [['zone', 30], ['haz', 4], ['pattern', 5], ['heads', 5], ['hand', 4], ['LB', 3], ['A/hd m²', 7], ['maxCell', 7],
  ['maxSp m', 7], ['minSp m', 7], ['maxWall', 7], ['minWall', 7], ['err', 3], ['warn', 4], ['frame', 6], ['dec', 4], ['ms', 6]];
const line = vals => vals.map((v, i) => String(v).padEnd(cols[i][1])).join(' ');
const f2 = v => (v == null ? '-' : isFinite(v) ? v.toFixed(2) : 'inf');
const tableRows = [];
console.log(line(cols.map(c => c[0])));
console.log(cols.map(c => '-'.repeat(c[1])).join(' '));

function runAndReport(sample, hazardOverride) {
  const zones = sample.zones.map(z => (hazardOverride ? { ...z, hazard: hazardOverride } : z));
  const site = runSite(zones, RS, { now });
  for (const p of site) {
    const z = p.zone, r = p.report, res = p.res;
    const label = (sample.zones.length > 1 ? `${sample.id}/${z.zoneId}` : sample.name).slice(0, 30);
    if (sample.infeasible) {
      const okErr = !res.ok && res.error && res.error.code === sample.expectedError && res.error.where && res.error.where.length && res.heads.length === 0;
      const row = line([label, z.hazard, '-', 0, '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', p.ms.toFixed(1)]);
      console.log(row + `  -> ${res.ok ? 'UNEXPECTED OK' : res.error.code}: ${res.error?.message ?? ''}`);
      tableRows.push(row + `  -> ${res.ok ? 'UNEXPECTED OK' : res.error.code}`);
      if (!okErr) failNote(`${label}: infeasible zone did not return a located ${sample.expectedError} error`);
      continue;
    }
    const lb = Math.ceil(r.areaM2 / (RS.hazards[z.hazard].Amax) - 1e-9);
    const fixLb = z.expected?.[z.hazard]?.lowerBound;
    if (fixLb !== lb) failNote(`${label} ${z.hazard}: fixture lower bound ${fixLb} differs from the oracle's ${lb}`);
    const hand = sample.hand?.[z.hazard] ?? '-';
    const row = line([label, z.hazard, (z.pattern === 'staggered' ? 'stagg' : 'rect'), r.headCount, hand, lb, f2(r.areaPerHeadM2), f2(r.maxLocalAreaM2),
      f2(r.maxNNSpacingM), f2(r.minSpacingM), f2(r.worstWallDistM), f2(r.minWallDistM), r.errors, r.warnings,
      res.notes ? res.notes.frameDeg.toFixed(1) : '-', res.notes ? res.notes.decomposition.replace('none', '-') : '-', p.ms.toFixed(1)]);
    console.log(row);
    tableRows.push(row);
    if (!res.ok) failNote(`${label} ${z.hazard}: placer returned ${res.error.code}: ${res.error.message}`);
    if (r.errors) {
      failNote(`${label} ${z.hazard}: oracle errors: ` + r.flags.filter(f => f.severity === 'error').slice(0, 4)
        .map(f => `${f.code}@(${Math.round(f.where?.x)},${Math.round(f.where?.y)}) ${f.message}`).join(' | '));
    }
    if (res.notes?.exceptions?.gapFill) console.log(`   note: ${res.notes.exceptions.gapFill} gapFill head(s)`);
    if (res.notes?.tileAligned) console.log(`   note: tile stops ${res.notes.tileAligned.onStop}/${res.notes.tileAligned.total}` +
      (res.notes.tileAligned.extraHeadsVsUnaligned != null ? `, extra heads vs unaligned: ${res.notes.tileAligned.extraHeadsVsUnaligned}` : ''));
  }
  return site;
}

for (const s of SAMPLES) {
  runAndReport(s);
  for (const hz of s.alsoHazards || []) runAndReport(s, hz);
}

// ---- determinism (P4) ------------------------------------------------------------------------
for (const s of SAMPLES.filter(s => !s.infeasible).slice(0, 8)) {
  const a = JSON.stringify(placeZone(s.zones[0], RS).heads), b = JSON.stringify(placeZone(s.zones[0], RS).heads);
  if (a !== b) failNote(`${s.id}: non-deterministic output`);
}

// ---- seeded random zones (P1) and rotations (P2) ----------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const between = (r, a, b) => a + (b - a) * r();
const snap = v => Math.round(v / 50) * 50;

function randomRectilinear(r) {
  // skyline over a flat base, optionally with a skyline cut from below (gives L/U/T/comb shapes)
  const n = 2 + Math.floor(r() * 4);
  const xs = [0]; for (let i = 0; i < n; i++) xs.push(xs[xs.length - 1] + snap(between(r, 2500, 9000)));
  const tops = xs.slice(0, -1).map(() => snap(between(r, 3000, 14000)));
  const bots = xs.slice(0, -1).map((_, i) => (r() < 0.3 && i > 0 && i < n - 1 ? snap(between(r, 0, 2000)) : 0));
  const pts = [];
  for (let i = 0; i < n; i++) { pts.push({ x: xs[i], y: bots[i] }); pts.push({ x: xs[i + 1], y: bots[i] }); }
  for (let i = n - 1; i >= 0; i--) { pts.push({ x: xs[i + 1], y: tops[i] }); pts.push({ x: xs[i], y: tops[i] }); }
  const ded = [];
  for (const p of pts) { const l = ded[ded.length - 1]; if (!l || l.x !== p.x || l.y !== p.y) ded.push(p); }
  // drop collinear points
  return ded.filter((p, i) => { const a = ded[(i + ded.length - 1) % ded.length], b = ded[(i + 1) % ded.length]; return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y)); });
}
function randomConvex(r) {
  const k = 3 + Math.floor(r() * 7), rx = between(r, 2500, 12000), ry = between(r, 2500, 9000);
  const angs = Array.from({ length: k }, () => r() * Math.PI * 2).sort((a, b) => a - b);
  for (let i = 1; i < k; i++) if (angs[i] - angs[i - 1] < 0.25) angs[i] = angs[i - 1] + 0.25;
  const pts = angs.filter(a => a < angs[0] + Math.PI * 2 - 0.25).map(a => ({ x: Math.round(rx * Math.cos(a)), y: Math.round(ry * Math.sin(a)) }));
  return pts.length >= 3 ? pts : [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }];
}
const hzList = ['ELH', 'OH1', 'OH2', 'OH3'];
let randCount = 0, randFail = 0, randTimeMax = 0;
const randRows = [];
function randomCase(tag, outer, hazard, pattern) {
  randCount++;
  const t0 = now();
  const res = placeZone({ zoneId: tag, outer, hazard, pattern }, RS);
  const ms = now() - t0; randTimeMax = Math.max(randTimeMax, ms);
  if (!res.ok) { randFail++; failNote(`${tag} ${hazard}: placer ${res.error.code} ${res.error.message} outer=${JSON.stringify(outer)}`); return; }
  const rep = checkZone({ outer }, res.heads, RS, hazard);
  const lb = Math.ceil(rep.areaM2 / RS.hazards[hazard].Amax - 1e-9);
  randRows.push({ tag, hazard, heads: rep.headCount, lb, err: rep.errors, ms });
  if (rep.errors) {
    randFail++;
    failNote(`${tag} ${hazard}: oracle errors ` + rep.flags.filter(f => f.severity === 'error').slice(0, 3).map(f => `${f.code}@(${Math.round(f.where?.x)},${Math.round(f.where?.y)})`).join(' ') + ` outer=${JSON.stringify(outer)}`);
  }
}
{
  const r = rng(4541);
  for (let i = 0; i < 24; i++) randomCase(`rectilinear#${i}`, randomRectilinear(r), hzList[i % 4], i % 5 === 4 ? 'staggered' : 'rectangular');
  const r2 = rng(2020);
  for (let i = 0; i < 24; i++) randomCase(`convex#${i}`, randomConvex(r2), hzList[(i + 1) % 4], 'rectangular');
  const r3 = rng(77);
  for (let i = 0; i < 6; i++) {
    const s = SAMPLES[[0, 1, 2, 3, 13, 16][i]];
    const ang = Math.round(between(r3, 5, 85));
    const a = ang * Math.PI / 180;
    const outer = s.zones[0].outer.map(p => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }));
    randomCase(`${s.id}@${ang}°`, outer, s.zones[0].hazard, 'rectangular');
  }
}
console.log(`\nRandomized/rotated zones: ${randCount} run, ${randFail} failing, max ${randTimeMax.toFixed(0)} ms`);
const rot = randRows.filter(r => r.tag.includes('@'));
if (rot.length) console.log('Rotations: ' + rot.map(r => `${r.tag} ${r.hazard} ${r.heads} heads`).join('; '));
const gaps = randRows.map(r => r.heads - r.lb);
console.log(`Head count above area lower bound (random set): mean ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2)}, max ${Math.max(...gaps)}`);

// ---- oracle mutation checks (§4.3) -------------------------------------------------------------
{
  const zone = { outer: SAMPLES[0].zones[0].outer };
  const base = placeZone({ zoneId: 'M', outer: zone.outer, hazard: 'OH1' }, RS).heads;
  const expect = (name, heads, code, sev = 'error') => {
    const rep = checkZone(zone, heads, RS, 'OH1');
    const hit = rep.flags.some(f => f.code === code && f.severity === sev);
    console.log(`mutation ${name.padEnd(34)} -> ${hit ? 'caught' : 'MISSED'} (${code})`);
    if (!hit) failNote(`mutation ${name} not caught`);
  };
  const corner = base.reduce((a, h) => (h.x + h.y < a.x + a.y ? h : a));
  expect('delete corner head', base.filter(h => h !== corner), 'UNCOVERED');
  expect('move corner head 0.6 m inward', base.map(h => (h === corner ? { ...h, x: h.x + 600, y: h.y + 600 } : h)), 'UNCOVERED');
  expect('duplicate head at 1.5 m', base.concat([{ id: 'dup', x: corner.x + 1500, y: corner.y }]), 'MIN_SPACING');
  expect('head 30 mm from wall', base.map(h => (h === corner ? { ...h, x: 30 } : h)), 'WALL_CLEARANCE');
  expect('only 4 heads (A/count > Amax)', base.slice(0, 4), 'AREA_ZONE', 'warning');
  const rp = checkZone(zone, base, RS, 'OH1');
  console.log(`unmutated base layout: ${rp.errors} errors`);
  if (rp.errors) failNote('unmutated base layout has errors');
}

// ---- column rule (founder decision 4, 2026-10-17) ------------------------------------------------
// Columns block spray and need Wmin, but Wmax does not apply to their faces; shafts are real walls.
{
  const ringOf = h => (Array.isArray(h) ? h : h.ring);
  const retag = (zone, kind) => ({ ...zone, holes: zone.holes.map(h => (kind ? { kind, ring: ringOf(h) } : ringOf(h))) });
  const distToRing = (p, ring) => Math.min(...ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length], vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy);
  }));
  const onHole = (zone, f) => f.where && zone.holes.some(h => distToRing(f.where, ringOf(h)) < 60);
  const wallDistOnHoles = (zone, heads) => checkZone(zone, heads, RS, zone.hazard).flags
    .filter(f => f.code === 'WALL_DIST' && onHole(zone, f)).length;
  const report = (name, ok, detail) => {
    console.log(`column rule ${name.padEnd(48)} -> ${ok ? 'ok' : 'FAILED'}${detail ? ` (${detail})` : ''}`);
    if (!ok) failNote(`column rule: ${name}${detail ? ` (${detail})` : ''}`);
  };

  const z6 = SAMPLES.find(s => s.id === 'Z6').zones[0];
  const z6res = placeZone(z6, RS);
  const z6rep = checkZone(z6, z6res.heads, RS, z6.hazard);
  // 15 (design §5 hand count) assumed columns do not block sight; see docs/spikes/2-2-placement-report.md.
  report('Z6 places ≤ 18 heads with zero oracle errors', z6res.ok && z6res.heads.length <= 18 && z6rep.errors === 0,
    `${z6res.heads.length} heads, ${z6rep.errors} errors`);
  // Wmax mutation on column faces: delete every head right of column 1 up to 7 m, so its right face
  // has no head within Wmax. As columns: no WALL_DIST on the faces. Same layout as shafts: flagged.
  const thinned = z6res.heads.filter(h => !(h.x > 4400 && h.x < 7000));
  const asCol = wallDistOnHoles(z6, thinned), asShaft = wallDistOnHoles(retag(z6, 'shaft'), thinned);
  report('Z6 column-face Wmax mutation is not flagged', asCol === 0 && asShaft > 0,
    `WALL_DIST on hole faces: as columns ${asCol}, as shafts ${asShaft}`);
  const untagged = placeZone(retag(z6, null), RS);
  report('untagged 600 mm holes fall back to columns', untagged.heads.length === z6res.heads.length,
    `${untagged.heads.length} vs ${z6res.heads.length}`);

  // a head 30 mm from a column face is a clearance error
  const col = ringOf(z6.holes[0]);
  const cx1 = Math.max(...col.map(p => p.x)), cy = (Math.min(...col.map(p => p.y)) + Math.max(...col.map(p => p.y))) / 2;
  const nearCol = z6res.heads.map((h, i) => (i === 0 ? { ...h, x: cx1 + 30, y: cy } : h));
  const clr = checkZone(z6, nearCol, RS, z6.hazard).flags.some(f => f.code === 'WALL_CLEARANCE' && f.severity === 'error');
  report('head 30 mm from a column is flagged', clr, 'WALL_CLEARANCE');

  // Z7: the 4 m shaft keeps Wmax. Push every head within 2.5 m of the shaft 600 mm away from it.
  const z7 = SAMPLES.find(s => s.id === 'Z7').zones[0];
  const z7res = placeZone(z7, RS);
  const sh = ringOf(z7.holes[0]);
  const sx = (Math.min(...sh.map(p => p.x)) + Math.max(...sh.map(p => p.x))) / 2, sy = (Math.min(...sh.map(p => p.y)) + Math.max(...sh.map(p => p.y))) / 2;
  const pushed = z7res.heads.map(h => {
    if (distToRing(h, sh) > 2500) return h;
    const dx = h.x - sx, dy = h.y - sy, L = Math.hypot(dx, dy) || 1;
    return { ...h, x: h.x + 600 * dx / L, y: h.y + 600 * dy / L };
  });
  const z7shaft = wallDistOnHoles(z7, pushed), z7col = wallDistOnHoles(retag(z7, 'column'), pushed);
  report('Z7 shaft faces keep Wmax', checkZone(z7, z7res.heads, RS, z7.hazard).errors === 0 && z7shaft > 0 && z7col === 0,
    `pushed layout: WALL_DIST on shaft faces ${z7shaft}, same hole tagged column ${z7col}`);
  const z7untagged = placeZone(retag(z7, null), RS);
  report('untagged 4 m hole falls back to shaft', z7untagged.heads.length === z7res.heads.length,
    `${z7untagged.heads.length} vs ${z7res.heads.length}`);
}

// ---- NFR6 timing: 200 m² single zone under 1 s -------------------------------------------------
{
  const cases = [
    { name: '200 m² rect 20×10 OH1', outer: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 10000 }, { x: 0, y: 10000 }], hazard: 'OH1' },
    { name: '200 m² L ELH', outer: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 6000 }, { x: 10000, y: 6000 }, { x: 10000, y: 14000 }, { x: 0, y: 14000 }], hazard: 'ELH' },
    { name: '200 m² 7-gon OH2', outer: [{ x: 0, y: 0 }, { x: 15000, y: 0 }, { x: 18000, y: 5000 }, { x: 15000, y: 12000 }, { x: 6000, y: 14000 }, { x: 1000, y: 11000 }, { x: -1500, y: 5000 }], hazard: 'OH2' },
  ];
  for (const c of cases) {
    const t0 = now(); const res = placeZone({ zoneId: 'T', ...c }, RS); const ms = now() - t0;
    const t1 = now(); const rep = checkZone({ outer: c.outer }, res.heads, RS, c.hazard); const cms = now() - t1;
    console.log(`timing ${c.name.padEnd(24)} area ${rep.areaM2.toFixed(0)} m², ${res.heads.length} heads, place ${ms.toFixed(0)} ms, check ${cms.toFixed(0)} ms, errors ${rep.errors}`);
    if (ms > 1000) failNote(`timing: ${c.name} took ${ms.toFixed(0)} ms`);
    if (rep.errors) failNote(`timing case ${c.name} has oracle errors`);
  }
}

console.log('');
if (failures) {
  console.log(`FAIL: ${failures} problem(s)`);
  for (const f of fails) console.log(' - ' + f.slice(0, 400));
  process.exit(1);
}
console.log('PASS: all feasible zones have zero oracle errors; infeasible zones return located errors.');
