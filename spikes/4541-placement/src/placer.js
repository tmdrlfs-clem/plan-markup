// NZS 4541 sprinkler head auto-placement (spike #2, design docs/4541-placement-design.md §3).
//
// frame search × bay decomposition × row sweep, each row solved by an exact 1-D stabbing DP.
// Every hard constraint is a demand or a DP transition rule; there is no repair stage.
// Units: mm, zone-local frame. Pure and deterministic: no Math.random, no Date, no caches.
//
// This module never imports the oracle, and the oracle never imports this module.

import {
  ringArea, orientRing, bbox, pointInRing, pointInRegion, distPointSeg, rotatePt, rotateRing,
  cleanRing, simplifyRing, isConvex, findSelfIntersection, ringRowIntervals, subtractIntervals,
  mergeIntervals, SegIndex,
} from './geometry.js';

const MU_COV = 75;    // reach margin for sampled coverage demands (100 mm lattice: any point is ≤71 mm from a sample)
const MU_WALL = 30;   // reach margin for wall samples (50 mm step)
const TOL = 0.5;      // tolerance on exact analytic limits (the oracle allows 1 mm)
const LAT = 100;      // coverage lattice step
const BND = 50;       // boundary sample step
const CSTEP = 50;     // DP candidate step along a row
const SMALL_HOLE = 1000; // fallback for untagged holes: up to this extent a hole counts as a column
const NUDGE = 0.5;    // boundary samples are tested for visibility from 0.5 mm inside the wall
const MAX_GAPFILL = 3;
const TRACE_TOL = 40;

// ---------------------------------------------------------------------------------------------
// Public entry point

let DEBUG = null;
/** Test hook: receives one record per evaluated bay row-set variant. */
export function setPlacerDebug(fn) { DEBUG = fn; }

/**
 * @param input {zoneId, outer:[{x,y}], holes?:[[{x,y}] | {kind:'column'|'shaft', ring:[{x,y}]}], hazard, pattern?:'rectangular'|'staggered',
 *               prefs?:{spacing?:mm, wallDist?:mm}, grid?:{angleDeg,pitchX,pitchY,originX,originY,mode},
 *               locked?:[{id,x,y}], openEdges?:[{a:{x,y},b:{x,y}}], neighbourHeads?:[{x,y}],
 *               frameDeg?:number, reducedWallDist?:boolean}     (all coordinates in mm)
 * @param ruleset rule set data (rules.js)
 * @returns {ok, heads, notes, error?}
 */
export function placeZone(input, ruleset, opts = {}) {
  const hz = ruleset.hazards[input.hazard];
  if (!hz) return fail('INVALID_ZONE', [], `Unknown hazard class ${input.hazard}`);
  const R = {
    Amax: hz.Amax * 1e6, Smax: hz.Smax * 1000, Smin: hz.Smin * 1000,
    Wmax: (input.reducedWallDist ? hz.WmaxReduced : hz.Wmax) * 1000, Wmin: hz.Wmin * 1000,
  };
  R.Rc = 0.5 * Math.sqrt(R.Smax ** 2 + (R.Amax / R.Smax) ** 2);

  const prep = prepare(input);
  if (!prep.ok) return { ok: false, error: prep.error, heads: [], notes: null };

  const prefs = {
    spacing: input.prefs?.spacing ? clamp(input.prefs.spacing, R.Smin, R.Smax) : null,
    wallDist: input.prefs?.wallDist ? clamp(input.prefs.wallDist, R.Wmin + 1, R.Wmax) : null,
  };
  const pattern = input.pattern === 'staggered' ? 'staggered' : 'rectangular';
  const grid = input.grid && input.grid.mode !== 'off' ? input.grid : null;

  // Admissible region: some point must keep Wmin from every wall.
  const adm = admissibleProbe(prep, R);
  if (!adm) {
    return fail('NO_ADMISSIBLE_REGION', prep.outerWorld,
      `No point in this zone is ${R.Wmin} mm or more from every wall (zone narrower than 2 × Wmin = ${2 * R.Wmin} mm). No heads placed.`,
      centroidOf(prep.outerWorld));
  }

  const frames = frameCandidates(prep, grid, input.frameDeg);
  let best = null, tried = 0;
  for (let fi = 0; fi < frames.length; fi++) {
    const F = buildFrame(prep, frames[fi], R, grid);
    const decs = decompositions(F);
    for (let di = 0; di < decs.length; di++) {
      const res = layoutDecomposition(F, decs[di], R, prefs, pattern, grid);
      tried++;
      res.score = [res.unresolved.length + res.h4.length, res.heads.length, res.gapFill, res.cost, fi, di];
      res.frame = F; res.decName = decs[di].name; res.bayCount = decs[di].bays.length;
      if (!best || lexLess(res.score, best.score)) best = res;
    }
  }

  // Back to world coordinates.
  const F = best.frame;
  const toWorld = p => { const q = rotatePt(p, F.theta); return { x: q.x + prep.ox, y: q.y + prep.oy }; };
  const heads = [];
  const counters = new Map();
  for (const h of best.heads) {
    const w = toWorld(h);
    if (h.kind === 'locked') { heads.push({ id: h.id, x: h.wx, y: h.wy, kind: 'locked' }); continue; }
    const key = `${h.bay}:${h.row}`;
    const k = counters.get(key) || 0; counters.set(key, k + 1);
    heads.push({ id: `${opts.idPrefix || ''}${input.zoneId || 'Z'}:${h.bay}:${h.row}:${k}`, x: round3(w.x), y: round3(w.y), kind: h.kind, rowId: `${h.bay}:${h.row}` });
  }
  const unresolvedWorld = best.unresolved.map(s => toWorld(s));
  const notes = {
    frameDeg: round3(F.theta * 180 / Math.PI),
    decomposition: best.decName, bays: best.bayCount, rows: best.rowCount,
    exceptions: { gapFill: best.gapFill, offsetRow: 0 },
    unresolved: unresolvedWorld.length, h4Violations: best.h4.length,
    variantsTried: tried, rule: R,
  };
  if (grid) {
    const stops = heads.filter(h => onTileStop(h, grid)).length;
    notes.tileAligned = { onStop: stops, total: heads.length };
    if (grid.mode === 'required' && !opts.noDelta) {
      const free = placeZone({ ...input, grid: null }, ruleset, { ...opts, noDelta: true });
      if (free.ok) notes.tileAligned.extraHeadsVsUnaligned = heads.length - free.heads.length;
    }
  }
  if (unresolvedWorld.length) {
    return {
      ok: false, heads, notes,
      error: { code: 'UNCOVERABLE_PIECE', where: unresolvedWorld.slice(0, 50),
        message: `${unresolvedWorld.length} sample point(s) could not be reached by any admissible head position under the hard constraints.` },
    };
  }
  return { ok: true, heads, notes };
}

export function tileStopAt(grid, x, y) {
  const a = (grid.angleDeg || 0) * Math.PI / 180;
  const p = rotatePt({ x: x - (grid.originX || 0), y: y - (grid.originY || 0) }, -a);
  const i = Math.round(p.x / grid.pitchX - 0.5), j = Math.round(p.y / grid.pitchY - 0.5);
  const q = rotatePt({ x: (i + 0.5) * grid.pitchX, y: (j + 0.5) * grid.pitchY }, a);
  return { x: q.x + (grid.originX || 0), y: q.y + (grid.originY || 0) };
}
function onTileStop(h, grid) { const s = tileStopAt(grid, h.x, h.y); return Math.hypot(s.x - h.x, s.y - h.y) < 1.5; }

// ---------------------------------------------------------------------------------------------
// Preparation (§3.6): zone-local mm, clean, orient, validate.

function prepare(input) {
  const raw = (input.outer || []).map(p => ({ x: +p.x, y: +p.y }));
  if (raw.length < 3 || raw.some(p => !isFinite(p.x) || !isFinite(p.y))) {
    return { ok: false, error: { code: 'INVALID_ZONE', where: raw, message: 'Zone outline needs at least 3 valid points.' } };
  }
  const bb = bbox(raw), ox = bb.x0, oy = bb.y0;
  const loc = p => ({ x: +p.x - ox, y: +p.y - oy });
  const outer = orientRing(cleanRing(raw.map(loc)), true);
  // Holes are tagged `column` or `shaft` (founder decision 4). Columns block spray and need Wmin but
  // carry no Wmax and never cut bays; shafts/voids are real walls. Untagged rings fall back to the
  // extent heuristic (column if no side of the bbox exceeds SMALL_HOLE).
  const holes = [], holeColumn = [];
  for (const h of input.holes || []) {
    const ring = Array.isArray(h) ? h : (h && h.ring) || [];
    const r = orientRing(cleanRing(ring.map(loc)), false);
    if (r.length < 3) continue;
    holes.push(r);
    holeColumn.push(isColumnHole(h, r));
  }
  const world = p => ({ x: p.x + ox, y: p.y + oy });
  const si = outer.length >= 3 ? findSelfIntersection([outer, ...holes]) : null;
  if (si) {
    return { ok: false, error: { code: 'INVALID_ZONE', where: [world(si)], outline: raw, message: 'Zone outline crosses itself (or a hole crosses the outline) at the marked point.' } };
  }
  if (outer.length < 3 || Math.abs(ringArea(outer)) < 1e4) {
    return { ok: false, error: { code: 'INVALID_ZONE', where: raw, message: 'Zone area is zero or too small.' } };
  }
  for (const h of holes) {
    if (!h.every(p => pointInRing(p, outer))) {
      return { ok: false, error: { code: 'INVALID_ZONE', where: h.map(world), message: 'A hole (column) lies outside the zone outline.' } };
    }
  }
  const open = (input.openEdges || []).map(e => ({ a: loc(e.a), b: loc(e.b) }));
  const outerOpen = outer.map((p, i) => {
    const q = outer[(i + 1) % outer.length];
    return open.some(e => distPointSeg(p, e.a, e.b) < 2 && distPointSeg(q, e.a, e.b) < 2);
  });
  return {
    ok: true, ox, oy, outer, holes, holeColumn, outerOpen,
    outerWorld: raw,
    locked: (input.locked || []).map(h => ({ ...loc(h), id: h.id, wx: h.x, wy: h.y })),
    neighbours: (input.neighbourHeads || []).map(loc),
    gridLocal: input.grid ? { ...input.grid, originX: (input.grid.originX || 0) - ox, originY: (input.grid.originY || 0) - oy } : null,
  };
}

function isColumnHole(h, ring) {
  if (!Array.isArray(h) && h && (h.kind === 'column' || h.kind === 'shaft')) return h.kind === 'column';
  const b = bbox(ring);
  return Math.max(b.x1 - b.x0, b.y1 - b.y0) <= SMALL_HOLE;
}

// Trace tolerance (see oracle): sight lines from samples near a wall are tested from a probe
// pushed TRACE_TOL into the room. Smaller than the oracle's 50 mm so the placer is never the more
// generous of the two.
function pushProbe(v, nx, ny, a, outer, holes, idx) {
  const d0 = Math.abs((v.x - a.x) * nx + (v.y - a.y) * ny);
  for (let t = TRACE_TOL - d0; t > 0.5; t /= 2) {
    const q = { x: v.x + nx * t, y: v.y + ny * t };
    if (pointInRegion(q, outer, holes) && idx.visible(v, q)) return q;
  }
  return v;
}
function latticeProbe(p, outer, holes, idx) {
  let best = null, bd = TRACE_TOL;
  idx.forBox(p.x - TRACE_TOL, p.y - TRACE_TOL, p.x + TRACE_TOL, p.y + TRACE_TOL, s => {
    const d = distPointSeg(p, s.a, s.b); if (d < bd) { bd = d; best = s; }
  });
  return best ? pushProbe(p, best.nx, best.ny, best.a, outer, holes, idx) : p;
}

function barrierSegs(outer, holes, outerOpen) {
  const segs = [];
  const add = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1e-9) return;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    segs.push({ a, b, nx, ny, c: nx * a.x + ny * a.y });
  };
  outer.forEach((p, i) => { if (!outerOpen[i]) add(p, outer[(i + 1) % outer.length]); });
  for (const h of holes) h.forEach((p, i) => add(p, h[(i + 1) % h.length]));
  return segs;
}

function admissibleProbe(prep, R) {
  const idx = new SegIndex(barrierSegs(prep.outer, prep.holes, prep.outerOpen));
  const need = R.Wmin + 1;
  const ok = p => pointInRegion(p, prep.outer, prep.holes) && idx.clearance(p, need + 1) >= need;
  const bb = bbox(prep.outer);
  for (let y = bb.y0 + 50; y < bb.y1; y += 100) for (let x = bb.x0 + 50; x < bb.x1; x += 100) if (ok({ x, y })) return true;
  // fine probe along every wall, offset inward by the clearance (catches slim zones)
  for (const r of [prep.outer, ...prep.holes]) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
      for (let s = 0; s <= L; s += 20) {
        const p = { x: a.x + (b.x - a.x) * s / L + nx * (need + 0.5), y: a.y + (b.y - a.y) * s / L + ny * (need + 0.5) };
        if (ok(p)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Frames (§3.2): length-weighted edge-angle histogram mod 90°, top two peaks plus 0°.
// Rows run along the frame x axis, so each angle is also tried turned by 90°.

function frameCandidates(prep, grid, override) {
  let base;
  if (override != null) base = [override * Math.PI / 180];
  else if (grid) base = [(grid.angleDeg || 0) * Math.PI / 180];
  else {
    const edges = [];
    for (const r of [prep.outer, ...prep.holes]) r.forEach((p, i) => {
      const q = r[(i + 1) % r.length];
      const L = Math.hypot(q.x - p.x, q.y - p.y);
      let a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; a = ((a % 90) + 90) % 90;
      edges.push({ a, L });
    });
    const bins = new Float64Array(360);
    for (const e of edges) bins[Math.floor(e.a / 0.25) % 360] += e.L;
    const sm = new Float64Array(360);
    for (let i = 0; i < 360; i++) for (let k = -6; k <= 6; k++) sm[i] += bins[(i + k + 360) % 360];
    let p1 = 0; for (let i = 1; i < 360; i++) if (sm[i] > sm[p1]) p1 = i;
    let p2 = -1;
    for (let i = 0; i < 360; i++) {
      const dd = Math.min(Math.abs(i - p1), 360 - Math.abs(i - p1));
      if (dd <= 12 || sm[i] < 0.15 * sm[p1]) continue;
      if (p2 < 0 || sm[i] > sm[p2]) p2 = i;
    }
    const peakAngle = (pi) => {
      const c = pi * 0.25 + 0.125; let sx = 0, sy = 0;
      for (const e of edges) {
        let d = Math.abs(e.a - c); d = Math.min(d, 90 - d);
        if (d <= 1.5) { sx += e.L * Math.cos(e.a * 4 * Math.PI / 180); sy += e.L * Math.sin(e.a * 4 * Math.PI / 180); }
      }
      let a = Math.atan2(sy, sx) * 180 / Math.PI / 4; if (a < 0) a += 90;
      return a;
    };
    const list = [peakAngle(p1)];
    if (p2 >= 0) list.push(peakAngle(p2));
    if (!list.some(a => Math.min(a, 90 - a) < 1)) list.push(0);
    base = list.map(a => (Math.min(a, 90 - a) < 1e-6 ? 0 : a) * Math.PI / 180);
  }
  const out = [];
  for (const a of base) for (const t of [a, a + Math.PI / 2]) {
    if (!out.some(b => Math.abs(b - t) < 1e-9)) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Frame context: rotated geometry, barrier index, samples.

function buildFrame(prep, theta, R, grid) {
  const rot = -theta;
  const outer = rotateRing(prep.outer, rot);
  const holes = prep.holes.map(h => rotateRing(h, rot));
  const segs = barrierSegs(outer, holes, prep.outerOpen);
  const idx = new SegIndex(segs);
  const bb = bbox(outer);

  const lat = [];
  const ix0 = Math.ceil((bb.x0 - 50) / LAT), ix1 = Math.floor((bb.x1 - 50) / LAT);
  const iy0 = Math.ceil((bb.y0 - 50) / LAT), iy1 = Math.floor((bb.y1 - 50) / LAT);
  for (let iy = iy0; iy <= iy1; iy++) {
    const y = 50 + iy * LAT;
    const runs = subtractIntervals(ringRowIntervals(outer, y), holes.flatMap(h => ringRowIntervals(h, y)));
    for (const [a, b] of runs) {
      for (let ix = Math.max(ix0, Math.ceil((a - 50) / LAT)); ix <= ix1 && 50 + ix * LAT <= b; ix++) {
        const x = 50 + ix * LAT;
        const lp = latticeProbe({ x, y }, outer, holes, idx);
        lat.push({ t: 0, x, y, vx: lp.x, vy: lp.y, ix, iy });
      }
    }
  }
  const bnd = [], wall = [];
  // columns: block sight, need Wmin, but no Wmax rule (founder decision 2026-10-17)
  const rings = [{ r: outer, open: prep.outerOpen, column: false },
    ...holes.map((h, i) => ({ r: h, open: null, column: prep.holeColumn[i] }))];
  for (const { r, open, column } of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y); if (L < 1e-6) continue;
      const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L, nx = -dy, ny = dx; // left normal points into the region
      const n = Math.max(1, Math.ceil(L / BND));
      const isWall = !(open && open[i]) && !column;
      for (let k = 0; k <= n; k++) {
        const s = k * L / n;                     // includes both vertices
        const x = a.x + dx * s, y = a.y + dy * s;
        // probe point just inside the room (tighter than the oracle's 1 mm, so the placer is never
        // more generous about sight lines in corner pockets); shrinks in acute corners
        let v = null;
        const end = k === 0 ? 1 : k === n ? -1 : 0;
        for (let dl = NUDGE; dl > 1e-4; dl /= 3) {
          const q = { x: x + nx * dl + dx * end * dl * 2, y: y + ny * dl + dy * end * dl * 2 };
          if (pointInRegion(q, outer, holes)) { v = q; break; }
          const tws = end ? [end] : [1, -1];
          for (const tw of tws) {
            for (const [fn, fa] of [[0.25, 1], [0.05, 2]]) {
              const q2 = { x: x + nx * dl * fn + dx * tw * dl * fa, y: y + ny * dl * fn + dy * tw * dl * fa };
              if (pointInRegion(q2, outer, holes)) { v = q2; break; }
            }
            if (v) break;
          }
          if (v) break;
        }
        if (!v) v = { x, y };   // sliver corner: test sight lines from the boundary point itself
        v = pushProbe(v, nx, ny, a, outer, holes, idx);
        bnd.push({ t: 1, x, y, vx: v.x, vy: v.y });
        if (isWall) wall.push({ t: 2, x, y, vx: v.x, vy: v.y, nx, ny, c: nx * a.x + ny * a.y });
      }
    }
  }

  // Decomposition geometry: noisy outlines are simplified for bay cutting only.
  const simplified = outer.length > 40;
  const douter = simplified ? orientRing(simplifyRing(outer, 40), true) : outer;
  const dholes = holes.map(h => (h.length > 40 ? orientRing(simplifyRing(h, 40), false) : h));

  const rotP = p => rotatePt(p, rot);
  let gridF = null;
  if (grid) {
    const o = rotP({ x: prep.gridLocal.originX, y: prep.gridLocal.originY });
    // frame is the grid angle or the grid angle + 90° (pitches swap; tile centres are symmetric)
    const rel = Math.abs(((theta - (grid.angleDeg || 0) * Math.PI / 180) % Math.PI + Math.PI) % Math.PI);
    const turned = Math.abs(rel - Math.PI / 2) < 1e-6;
    gridF = { ox: o.x, oy: o.y, px: turned ? grid.pitchY : grid.pitchX, py: turned ? grid.pitchX : grid.pitchY, mode: grid.mode };
  }
  return {
    theta, outer, holes, holeColumn: prep.holeColumn, segs, idx, bb, lat, bnd, wall, simplified, douter, dholes, grid: gridF,
    locked: prep.locked.map(h => ({ ...rotP(h), id: h.id, wx: h.wx, wy: h.wy, kind: 'locked', bay: -1 })),
    neighbours: prep.neighbours.map(h => ({ ...rotP(h), bay: -2 })),
    R,
  };
}

// ---------------------------------------------------------------------------------------------
// Bay decomposition (§3.3): none | cutH | cutV. Cuts are trapezoid slabs at the vertices of the
// outline and of large holes, merged back wherever no vertex interrupts the slab boundary;
// this equals cutting with axis-parallel rays from the reflex vertices.

function decompositions(F) {
  const large = F.dholes.filter((h, i) => !F.holeColumn[i]);   // shafts / voids cut bays
  const small = F.holes.filter((h, i) => F.holeColumn[i]);      // columns never cut bays
  const mkBay = (ring, holes, id) => {
    const bb = bbox(ring);
    const hs = holes.filter(h => { const b = bbox(h); return b.x1 > bb.x0 && b.x0 < bb.x1 && b.y1 > bb.y0 && b.y0 < bb.y1; });
    const convex = isConvex(ring);
    return { id, ring, holes: hs, bb, area: Math.abs(ringArea(ring)) - hs.reduce((s, h) => s + Math.abs(ringArea(h)), 0),
      convex, fast: convex && hs.length === 0 && !F.simplified };
  };
  const out = [{ name: 'none', bays: [mkBay(F.douter, F.dholes, 0)] }];
  let reflex = large.reduce((s, h) => s + h.length, 0);
  for (let i = 0; i < F.douter.length; i++) {
    const a = F.douter[(i + F.douter.length - 1) % F.douter.length], b = F.douter[i], c = F.douter[(i + 1) % F.douter.length];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-6) reflex++;
  }
  if (reflex === 0) return out;
  const rings = [F.douter, ...large];
  const cutH = trapezoidBays(rings).map((r, i) => mkBay(r, small, i));
  const T = r => r.map(p => ({ x: p.y, y: p.x }));
  const cutV = trapezoidBays(rings.map(T)).map(r => orientRing(T(r), true)).map((r, i) => mkBay(r, small, i));
  const cuts = [{ name: 'cutH', bays: cutH }, { name: 'cutV', bays: cutV }].filter(d => d.bays.length > 1);
  if (reflex > 12 && cuts.length === 2) cuts.splice(cuts[0].bays.length <= cuts[1].bays.length ? 1 : 0, 1);
  return out.concat(cuts);
}

function trapezoidBays(rings) {
  const ys0 = rings.flat().map(p => p.y).sort((a, b) => a - b);
  const ys = [];
  for (const y of ys0) if (!ys.length || y - ys[ys.length - 1] > 0.5) ys.push(y);
  const edges = [];
  for (const r of rings) r.forEach((p, i) => { const q = r[(i + 1) % r.length]; if (Math.abs(q.y - p.y) > 1e-9) edges.push([p, q]); });
  const slabs = [];
  let id = 0;
  for (let k = 0; k + 1 < ys.length; k++) {
    const ylo = ys[k], yhi = ys[k + 1], ym = (ylo + yhi) / 2;
    const xs = [];
    for (const [a, b] of edges) {
      if (Math.min(a.y, b.y) < ym && Math.max(a.y, b.y) > ym) {
        const f = y => a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y);
        xs.push({ m: f(ym), b: f(ylo), t: f(yhi) });
      }
    }
    xs.sort((p, q) => p.m - q.m);
    const traps = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      traps.push({ id: id++, k, ylo, yhi, xlb: xs[i].b, xlt: xs[i].t, xrb: xs[i + 1].b, xrt: xs[i + 1].t });
    }
    slabs.push(traps);
  }
  const all = slabs.flat();
  const parent = all.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let k = 0; k + 1 < slabs.length; k++) {
    for (const T of slabs[k]) {
      const ups = slabs[k + 1].filter(U => U.xlb < T.xrt - 1 && U.xrb > T.xlt + 1);
      if (ups.length !== 1) continue;
      const U = ups[0];
      const downs = slabs[k].filter(S => S.xrt > U.xlb + 1 && S.xlt < U.xrb - 1);
      if (downs.length === 1 && Math.abs(T.xlt - U.xlb) < 1 && Math.abs(T.xrt - U.xrb) < 1) parent[find(U.id)] = find(T.id);
    }
  }
  const groups = new Map();
  for (const T of all) { const g = find(T.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(T); }
  const out = [];
  for (const g of [...groups.keys()].sort((a, b) => a - b)) {
    const st = groups.get(g).sort((a, b) => a.k - b.k);
    const ring = [{ x: st[0].xlb, y: st[0].ylo }];
    for (const T of st) ring.push({ x: T.xlt, y: T.yhi });
    for (let i = st.length - 1; i >= 0; i--) { ring.push({ x: st[i].xrt, y: st[i].yhi }); ring.push({ x: st[i].xrb, y: st[i].ylo }); }
    const r = cleanRing(ring, 1);
    if (r.length >= 3 && Math.abs(ringArea(r)) > 1e3) out.push(orientRing(r, true));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Layout for one decomposition: bays largest first, each bay picks its best row-set variant.

function layoutDecomposition(F, dec, R, prefs, pattern, grid) {
  const bays = dec.bays;
  // assign samples to bays
  const per = bays.map(() => ({ lat: [], bnd: [], wall: [] }));
  const assign = (s, key) => {
    let bi = -1, inside = false;
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i].bb;
      if (s.vx < b.x0 - 1 || s.vx > b.x1 + 1 || s.vy < b.y0 - 1 || s.vy > b.y1 + 1) continue;
      if (pointInRing({ x: s.vx, y: s.vy }, bays[i].ring)) { bi = i; inside = true; break; }
    }
    if (bi < 0) {
      let bd = Infinity;
      for (let i = 0; i < bays.length; i++) {
        const r = bays[i].ring;
        for (let k = 0; k < r.length; k++) { const d = distPointSeg({ x: s.vx, y: s.vy }, r[k], r[(k + 1) % r.length]); if (d < bd) { bd = d; bi = i; } }
      }
    }
    per[bi][key].push({ s, bay: bi, inside });
  };
  for (const s of F.lat) assign(s, 'lat');
  for (const s of F.bnd) assign(s, 'bnd');
  for (const s of F.wall) assign(s, 'wall');

  const order = bays.map((b, i) => i).sort((a, b) => (bays[b].area - bays[a].area) || (a - b));
  const placedCov = F.locked.slice();
  const placedSp = F.locked.concat(F.neighbours);
  const heads = F.locked.slice();
  let unresolved = [], gapFill = 0, cost = 0, rowCount = 0;
  const alignXs = [];
  for (const bi of order) {
    const res = layoutBay(F, bays[bi], bi, per[bi], { R, prefs, pattern, grid, placedCov, placedSp, alignXs });
    for (const h of res.heads) { heads.push(h); placedCov.push(h); placedSp.push(h); alignXs.push(h.x); }
    unresolved = unresolved.concat(res.unresolved);
    gapFill += res.gapFill; cost += res.cost; rowCount += res.rows;
  }
  // H4 self-check (max spacing to nearest visible peer) — an engine claim the oracle will verify.
  const h4 = [];
  const own = heads;
  for (const h of own) {
    if (h.kind === 'locked') continue;
    let nn = Infinity, any = false;
    for (const g of own.concat(F.neighbours)) {
      if (g === h) continue;
      const d = Math.hypot(g.x - h.x, g.y - h.y);
      if (d >= nn) continue;
      if (F.idx.visible(h, g)) { any = true; nn = d; }
    }
    if (any && nn > R.Smax + TOL) h4.push(h);
  }
  return { heads, unresolved, gapFill, cost, h4, rowCount };
}

function layoutBay(F, bay, bi, samples, ctx) {
  const variants = rowVariants(F, bay, ctx);
  const modes = bay.fast ? [false] : [false, true];
  const all = [];
  // Exact pruning: once a variant resolves every sample with n heads, a variant that needs more than
  // n heads can never win (cmpBay ranks unresolved first, then heads), so its sweep stops early.
  let bound = null, lastShadow = true;
  for (const rows of variants) for (const defer of modes) {
    if (defer && !lastShadow) continue;   // identical to the run without deferral
    const res = layoutRows(F, bay, bi, samples, rows, { ...ctx, defer, bound });
    lastShadow = res.sawShadow;
    if (res.pruned) continue;
    if (!res.unresolved.length && (bound == null || res.heads.length < bound)) bound = res.heads.length;
    if (DEBUG) DEBUG({ frameDeg: Math.round(F.theta * 180 / Math.PI), bay: bi, rows: rows.map(Math.round), defer, heads: res.heads.length, unresolved: res.unresolved.length, unresAt: res.unresolved.slice(0, 3).map(p => [Math.round(p.x), Math.round(p.y), p.t]) });
    all.push(res);
  }
  if (!all.length) return { heads: [], unresolved: samples.lat.map(o => o.s), gapFill: 0, cost: 0, rows: 0 };
  all.sort(cmpBay);
  if (all[0].unresolved.length) {
    // only the most promising layouts get gap-fill heads
    const top = all.slice(0, 3).map(r => applyGapFill(F, bay, bi, samples, r, ctx));
    all.splice(0, 3, ...top);
    all.sort(cmpBay);
  }
  return all[0];
}
function cmpBay(a, b) {
  return (a.unresolved.length - b.unresolved.length) || (a.heads.length - b.heads.length) ||
    (a.gapFill - b.gapFill) || (a.cost - b.cost);
}

function rowVariants(F, bay, ctx) {
  const { R, prefs } = ctx, grid = F.grid;
  const y0 = bay.bb.y0, y1 = bay.bb.y1, H = y1 - y0;
  let m = Math.max(1, Math.ceil(H / R.Smax - 1e-9));
  while (H / (2 * m) > R.Wmax + TOL) m++;
  const out = [], unis = [];
  const push = rows => { if (!out.some(o => o.length === rows.length && o.every((y, i) => Math.abs(y - rows[i]) < 0.5))) out.push(rows); };
  const okD = rows => rows.every((y, i) => i === 0 || (rows[i] - rows[i - 1] >= R.Smin - TOL && rows[i] - rows[i - 1] <= R.Smax + TOL));
  // each row moved to the nearest tile-stop line (null if two rows collapse onto one line)
  const snapRows = rows => {
    const snapped = [];
    for (const y of rows) {
      const j = Math.round((y - grid.oy) / grid.py - 0.5);
      let best = null;
      for (const jj of [j - 1, j, j + 1]) {
        const ys = grid.oy + (jj + 0.5) * grid.py;
        if (ys <= y0 + R.Wmin || ys >= y1 - R.Wmin) continue;
        if (best == null || Math.abs(ys - y) < Math.abs(best - y)) best = ys;
      }
      if (best != null && !snapped.some(v => Math.abs(v - best) < 1)) snapped.push(best);
    }
    return snapped.length === rows.length ? snapped : null;
  };
  for (let k = 0; k < 3; k++) {
    const mm = m + k;
    if (mm > 1 && H / mm < R.Smin - TOL) break;
    const uni = Array.from({ length: mm }, (_, i) => y0 + (i + 0.5) * H / mm);
    if (k <= 1) unis.push(uni);
    if (!grid || grid.mode !== 'required') push(uni);
    if (mm > 2) {
      // edge rows pulled out to Wmax: interior rows bunch up (helps rows see both faces of columns)
      const o = R.Wmax - 1, D = (H - 2 * o) / (mm - 1);
      if (D >= R.Smin && D <= R.Smax) push(Array.from({ length: mm }, (_, i) => y0 + o + i * D));
    }
    if (prefs.wallDist && mm > 1) {
      const o = prefs.wallDist, D = (H - 2 * o) / (mm - 1);
      if (D >= R.Smin && D <= R.Smax && o <= D / 2 + TOL) push(Array.from({ length: mm }, (_, i) => y0 + o + i * D));
    }
    if (grid) {
      const snapped = snapRows(uni);
      if (snapped && okD(snapped)) push(snapped);
    }
  }
  // Column-aware variants: a row through a column band sees neither face of the column well, so
  // move that row just clear of the band (below or above) and re-spread the other rows evenly
  // between it and the walls. Only rows of the uniform sets with m and m + 1 rows are moved, one at
  // a time (m + 2 added runtime on R1 without a better count).
  const bands = columnBands(F, bay, R);
  if (bands.length) {
    for (const rows of unis) {
      const mm = rows.length;
      for (let j = 0; j < mm; j++) {
        const band = bands.find(b => rows[j] > b[0] && rows[j] < b[1]);
        if (!band) continue;
        for (const p of COL_GAP.flatMap(g => [band[0] - g, band[1] + g])) {
          if (p <= y0 + R.Wmin || p >= y1 - R.Wmin) continue;
          const na = mm - 1 - j, o = R.Wmax - 1;
          // other rows spread evenly (half a gap at the walls), or with the wall rows at Wmax
          for (const [Db, Da] of [[j ? (p - y0) / (j + 0.5) : 0, na ? (y1 - p) / (na + 0.5) : 0],
            [j ? (p - y0 - o) / j : 0, na ? (y1 - o - p) / na : 0]]) {
            const moved = rows.map((y, i) => (i < j ? p - (j - i) * Db : i > j ? p + (i - j) * Da : p));
            const edgeOk = r => r[0] - y0 <= R.Wmax + TOL && y1 - r[mm - 1] <= R.Wmax + TOL;
            if (!grid || grid.mode !== 'required') { if (edgeOk(moved) && okD(moved)) push(moved); }
            const sn = grid ? snapRows(moved) : null;
            if (sn && edgeOk(sn) && okD(sn) && !bands.some(b => sn[j] > b[0] && sn[j] < b[1])) push(sn);
          }
        }
      }
    }
  }
  return out;
}

const COL_GAP = [300, 700];   // distances tried between a moved row and a column band

// y-bands (frame coordinates) of the columns inside a bay, widened by Wmin and merged.
function columnBands(F, bay, R) {
  const raw = [];
  F.holes.forEach((h, i) => {
    if (!F.holeColumn[i]) return;
    const b = bbox(h);
    if (b.x1 <= bay.bb.x0 || b.x0 >= bay.bb.x1 || b.y1 <= bay.bb.y0 || b.y0 >= bay.bb.y1) return;
    raw.push([b.y0 - R.Wmin, b.y1 + R.Wmin]);
  });
  raw.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const r of raw) { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push(r.slice()); }
  return out;
}

// --- Row sweep for one bay and one row set ----------------------------------------------------

function layoutRows(F, bay, bi, samples, rows, ctx) {
  const { R, prefs, pattern } = ctx;
  const m = rows.length;
  const y0 = bay.bb.y0, y1 = bay.bb.y1;
  const lo = rows.map((y, j) => (j === 0 ? y0 : (rows[j - 1] + y) / 2));
  const hi = rows.map((y, j) => (j === m - 1 ? y1 : (y + rows[j + 1]) / 2));
  const bandOf = y => { for (let j = 0; j < m - 1; j++) if (y < hi[j]) return j; return m - 1; };

  const info = rows.map((y, j) => {
    const d = Math.max(y - lo[j], hi[j] - y);
    const Srect = d < R.Rc ? 2 * Math.sqrt(R.Rc * R.Rc - d * d) : 0;
    const S = Math.min(R.Smax, Srect, R.Amax / (2 * Math.max(d, 1)));
    const runs = rowRuns(bay, y);
    const clean = cleanIntervals(bay, runs, lo[j], hi[j]);
    return { y, d, Srect, S, runs, clean, base: rowCandidates(F, bay, y, runs, R, prefs) };
  });

  // bucket samples by band; drop lattice samples dominated inside clean columns
  const bands = rows.map(() => []);
  for (const o of samples.lat) {
    const j = bandOf(o.s.y), I = info[j];
    const iv = findIv(I.clean, o.s.x);
    if (iv) {
      const iyLo = Math.ceil((lo[j] - 50) / LAT - 1e-9);
      const iyHi = j === m - 1 ? Math.floor((hi[j] - 50) / LAT + 1e-9) : Math.ceil((hi[j] - 50) / LAT - 1e-9) - 1;
      if (o.s.iy !== iyLo && o.s.iy !== iyHi) continue;
    }
    bands[j].push({ o, iv });
  }
  for (const o of samples.bnd) { const j = bandOf(o.s.y); bands[j].push({ o, iv: findIv(info[j].clean, o.s.x) }); }
  for (const o of samples.wall) { const j = bandOf(o.s.y); bands[j].push({ o, iv: null }); }
  for (let j = 0; j < m; j++) {
    for (const iv of info[j].clean) for (const x of [iv[0], iv[1]]) for (const y of [lo[j] + 1, hi[j] - 1]) {
      if (hi[j] - lo[j] < 3 || !pointInRegion({ x, y }, F.outer, F.holes)) continue;
      bands[j].push({ o: { s: { t: 3, x, y, vx: x, vy: y }, inside: true }, iv });
    }
  }

  const heads = [];
  const unresolved = [];
  const cov = new HeadGrid(ctx.placedCov, R.Rc);
  let carry = [], cost = 0, prevRowXs = null, prevS = 0, row0 = null, row0S = 0, sawShadow = false;
  for (let j = 0; j < m; j++) {
    if (ctx.bound != null && heads.length > ctx.bound) return { pruned: true, sawShadow: true };
    const I = info[j];
    const spHeads = ctx.placedSp.concat(heads);
    // targets for alignment / stagger
    let targets = [], restrict = false;
    if (pattern === 'staggered' && row0 && row0.length) {
      // staggered (§3.10): odd rows on the half-offset lattice of the first row, even rows on it;
      // heads beyond the lattice span are free (end heads near walls)
      targets = j % 2 ? staggerTargets(row0, row0S) : row0.slice();
      restrict = true;
    } else if (prevRowXs && prevRowXs.length) targets = prevRowXs.slice();
    else if (pattern !== 'staggered') targets = ctx.alignXs.filter(x => x >= bay.bb.x0 && x <= bay.bb.x1);
    let cands = finalCandidates(F, bay, I, targets, spHeads, R);
    if (restrict && targets.length) {
      const tmin = targets[0], tmax = targets[targets.length - 1];
      const keep = cands.filter(c => c.x < tmin - 1 || c.x > tmax + 1 || targets.some(t => Math.abs(t - c.x) < 1));
      if (keep.length) cands = keep;
    }

    const items = bands[j].map(b => ({ o: b.o, iv: b.iv, own: true })).concat(carry.map(o => ({ o, iv: null, own: false })));
    // look-ahead: samples of the next band the next row cannot reach at all are served here
    if (j + 1 < m) {
      const N = info[j + 1];
      for (const b of bands[j + 1]) {
        if (b.o.s.t === 3) continue;
        const r = demandRange(F, bay, bi, b.o, null, N, N.base, R, true);
        if (!r) items.push({ o: b.o, iv: null, own: false, pulled: true });
      }
    }
    carry = [];
    const demands = [], dItems = [];
    for (const it of items) {
      if (satisfied(F, bay, bi, it.o, cov, R)) continue;
      const r = demandRange(F, bay, bi, it.o, it.own ? it.iv : null, I, cands, R, false);
      if (!r) {
        if (it.pulled) continue;               // stays with its own band
        if (j + 1 < m) carry.push(it.o); else unresolved.push(it.o);
        continue;
      }
      if (r.shadowed) sawShadow = true;
      if (r.shadowed && ctx.defer && j + 1 < m && !it.pulled) {
        // partly in a wall's shadow from this row: let the next row serve it when it can
        const N = info[j + 1];
        if (demandRange(F, bay, bi, it.o, null, N, N.base, R, true)) { carry.push(it.o); continue; }
      }
      demands.push(r); dItems.push(it);
    }
    let sol = stabDP(cands, demands, I, R, prefs, targets, pattern, F.grid);
    // Demands that cannot all be met on this row (two narrow windows closer than Smin): hand the
    // narrowest on to the next row (or report it) and solve again. Bounded.
    if (!sol && DEBUG) DEBUG({ dpFail: j, y: I.y, S: I.S, n: cands.length, cx: cands.map(c => Math.round(c.x) + ":" + c.seg).join(" ").slice(0, 600), dem: demands.slice(0, 400).map(([a, b]) => Math.round(cands[a].x) + "-" + Math.round(cands[b].x)).filter((v, i, arr) => arr.indexOf(v) === i).join(" ") });
    for (let tries = 0; !sol && demands.length && tries < 40; tries++) {
      let k = 0;
      for (let i = 1; i < demands.length; i++) if (demands[i][1] - demands[i][0] < demands[k][1] - demands[k][0]) k = i;
      const it = dItems[k];
      demands.splice(k, 1); dItems.splice(k, 1);
      if (!it.pulled) (j + 1 < m ? carry : unresolved).push(it.o);
      sol = stabDP(cands, demands, I, R, prefs, targets, pattern, F.grid);
    }
    if (!sol) {
      for (const it of dItems) if (!it.pulled) (j + 1 < m ? carry : unresolved).push(it.o);
      prevRowXs = []; continue;
    }
    cost += sol.cost;
    const xs = [];
    for (const k of sol.idx) { const c = cands[k]; const h = { x: c.x, y: I.y, bay: bi, row: j, kind: 'row' }; heads.push(h); cov.add(h); xs.push(c.x); }
    prevRowXs = xs; prevS = I.S;
    if (!row0 && xs.length) { row0 = xs.slice(); row0S = I.S; }
  }

  // gap-fill (§3.4 step 6): bounded, labelled exceptions
  const rest = unresolved.filter(o => !satisfied(F, bay, bi, o, cov, R));
  return { heads, rest, unresolved: rest.map(o => o.s), cov, gapFill: 0, cost, rows: m, sawShadow };
}

// gap-fill (§3.4 step 6): bounded, labelled exceptions, applied to a finished row layout
function applyGapFill(F, bay, bi, samples, res, ctx) {
  const { R } = ctx;
  let rest = res.rest, gapFill = 0;
  const heads = res.heads.slice();
  for (let it = 0; it < MAX_GAPFILL && rest.length; it++) {
    const h = bestGapFill(F, bay, bi, samples, rest, ctx.placedSp.concat(heads), R);
    if (!h) break;
    const g = { ...h, bay: bi, row: 'g', kind: 'gapFill' };
    heads.push(g);
    gapFill++;
    const one = new HeadGrid([g], R.Rc);
    rest = rest.filter(o => !satisfied(F, bay, bi, o, one, R));
  }
  return { ...res, heads, rest, unresolved: rest.map(o => o.s), gapFill, cost: res.cost + gapFill * 50 };
}

// Half-offset lattice of a row: midpoints of its consecutive heads. Positions beyond the span are
// left free so end heads can sit within Wmax of the walls.
function staggerTargets(xs, S) {
  const s = xs.slice().sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < s.length; i++) if (s[i + 1] - s[i] <= S + 1) out.push((s[i] + s[i + 1]) / 2);
  return out;
}

function rowRuns(bay, y) {
  const base = ringRowIntervals(bay.ring, y);
  const cuts = bay.holes.flatMap(h => ringRowIntervals(h, y));
  return subtractIntervals(base, cuts);
}

// x-intervals where the whole band [lo, hi] above/below the row is free of walls.
function cleanIntervals(bay, runs, lo, hi) {
  const a = lo + 0.5, b = hi - 0.5;
  const blocked = [];
  for (const r of [bay.ring, ...bay.holes]) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      const ylo = Math.min(p.y, q.y), yhi = Math.max(p.y, q.y);
      if (yhi <= a || ylo >= b) continue;
      if (Math.abs(q.y - p.y) < 1e-9) { blocked.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]); continue; }
      const f = y => p.x + (y - p.y) * (q.x - p.x) / (q.y - p.y);
      const xa = f(Math.max(ylo, a)), xb = f(Math.min(yhi, b));
      blocked.push([Math.min(xa, xb), Math.max(xa, xb)]);
    }
  }
  return subtractIntervals(runs, mergeIntervals(blocked).map(([u, v]) => [u - 1e-6, v + 1e-6]));
}
function findIv(ivs, x) { for (const iv of ivs) if (x >= iv[0] && x <= iv[1]) return iv; return null; }

function rowCandidates(F, bay, y, runs, R, prefs) {
  const out = [];
  const need = R.Wmin + 1;
  runs.forEach(([a, b], ri) => {
    const xs = [];
    for (let x = Math.ceil(a / CSTEP) * CSTEP; x <= b; x += CSTEP) xs.push(x);
    const L = b - a;
    const n0 = Math.max(1, Math.ceil(L / R.Smax - 1e-9));
    for (let n = n0; n <= n0 + 2; n++) for (let k = 0; k < n; k++) xs.push(a + (k + 0.5) * L / n);
    if (prefs.wallDist) {
      const o = prefs.wallDist;
      for (let n = n0; n <= n0 + 2; n++) for (let k = 0; k < n; k++) xs.push(n === 1 ? a + L / 2 : a + o + k * (L - 2 * o) / (n - 1));
    }
    xs.push(a + need, b - need);
    if (F.grid) {
      const i0 = Math.ceil((a - F.grid.ox) / F.grid.px - 0.5), i1 = Math.floor((b - F.grid.ox) / F.grid.px - 0.5);
      for (let i = i0; i <= i1; i++) xs.push(F.grid.ox + (i + 0.5) * F.grid.px);
    }
    for (const x of xs) {
      if (x < a || x > b) continue;
      const p = { x, y };
      if (!pointInRegion(p, F.outer, F.holes)) continue;
      if (F.idx.clearance(p, need + 1) < need) continue;
      out.push({ x, y, run: ri, stop: F.grid ? isStop(F.grid, x, y) : false });
    }
  });
  out.sort((p, q) => p.x - q.x);
  const ded = [];
  for (const c of out) {
    const l = ded[ded.length - 1];
    if (l && Math.abs(l.x - c.x) < 1) { l.stop = l.stop || c.stop; continue; }
    ded.push(c);
  }
  return ded;
}
function isStop(g, x, y) {
  const fx = (x - g.ox) / g.px - 0.5, fy = (y - g.oy) / g.py - 0.5;
  return Math.abs(fx - Math.round(fx)) * g.px < 1 && Math.abs(fy - Math.round(fy)) * g.py < 1;
}

function finalCandidates(F, bay, I, targets, spHeads, R) {
  let list = I.base;
  if (targets.length) {
    const extra = [];
    const need = R.Wmin + 1;
    for (const x of targets) {
      const ri = I.runs.findIndex(([a, b]) => x >= a && x <= b);
      if (ri < 0) continue;
      const p = { x, y: I.y };
      if (!pointInRegion(p, F.outer, F.holes) || F.idx.clearance(p, need + 1) < need) continue;
      extra.push({ x, y: I.y, run: ri, stop: F.grid ? isStop(F.grid, x, I.y) : false });
    }
    if (extra.length) {
      list = list.concat(extra).sort((p, q) => p.x - q.x);
      const ded = [];
      for (const c of list) { const l = ded[ded.length - 1]; if (l && Math.abs(l.x - c.x) < 0.5) continue; ded.push(c); }
      list = ded;
    }
  }
  const req = F.grid && F.grid.mode === 'required';
  const smin = R.Smin + TOL;
  const out = [];
  let seg = 0, last = null, excludedSince = false;
  for (const c of list) {
    if (req && !c.stop) continue;
    let bad = false;
    for (const h of spHeads) {
      const dx = h.x - c.x, dy = h.y - c.y;
      if (dx * dx + dy * dy < smin * smin && F.idx.visible(c, h)) { bad = true; break; }
    }
    if (bad) { excludedSince = true; continue; }
    if (!last || last.run !== c.run || excludedSince || c.x - last.x > (req ? F.grid.px + 1 : 110)) seg++;
    out.push({ ...c, seg });
    last = c; excludedSince = false;
  }
  return out;
}

// Is sample s already served by one of `heads`?
function satisfied(F, bay, bi, o, grid, R) {
  const s = o.s;
  if (s.t === 2) {
    const r = R.Rc - MU_WALL, r2 = r * r;
    return grid.near(s.x, s.y, h => {
      const dx = h.x - s.x, dy = h.y - s.y;
      if (dx * dx + dy * dy > r2) return false;
      if (Math.abs(s.nx * h.x + s.ny * h.y - s.c) > R.Wmax + TOL) return false;
      return visibleFrom(F, bay, bi, h, o);
    });
  }
  const r = R.Rc - MU_COV, r2 = r * r;
  return grid.near(s.x, s.y, h => {
    const dx = h.x - s.x, dy = h.y - s.y;
    if (dx * dx + dy * dy > r2) return false;
    return visibleFrom(F, bay, bi, h, o);
  });
}
function visibleFrom(F, bay, bi, h, o) {
  if (bay.fast && h.bay === bi && o.inside) return true;
  return F.idx.visible(h, { x: o.s.vx, y: o.s.vy });
}

// Uniform grid over heads, cell = Rc, so any head within reach is in the 3 x 3 neighbourhood.
class HeadGrid {
  constructor(heads, cell) { this.cell = cell; this.map = new Map(); for (const h of heads) this.add(h); }
  add(h) {
    const k = Math.floor(h.x / this.cell) * 100003 + Math.floor(h.y / this.cell);
    let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(h);
  }
  near(x, y, fn) {
    const i0 = Math.floor(x / this.cell), j0 = Math.floor(y / this.cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const a = this.map.get(i * 100003 + j); if (!a) continue;
      for (const h of a) if (fn(h)) return true;
    }
    return false;
  }
}

// Demand of sample s on row I as a candidate index range [a, b], or null when no candidate serves it.
function demandRange(F, bay, bi, o, iv, I, C, R, probeOnly) {
  if (!C.length) return null;
  const s = o.s;
  const y = I.y;
  let ra = null;
  if (iv && s.t !== 2) {
    const h = I.Srect / 2 - TOL;
    ra = idxRange(C, Math.max(iv[0], s.x - h), Math.min(iv[1], s.x + h));
    // unclipped rect window is at least as wide as the circle window: skip the sight-line work
    if (ra && s.x - h >= iv[0] && s.x + h <= iv[1] && Math.abs(s.y - y) >= I.d - LAT) return ra;
  }
  let lo, hi;
  if (s.t === 2) {
    const r = R.Rc - MU_WALL, dy = s.y - y;
    if (Math.abs(dy) >= r) return ra;
    const hw = Math.sqrt(r * r - dy * dy);
    lo = s.x - hw; hi = s.x + hw;
    const W = R.Wmax + TOL * 0.6;
    if (Math.abs(s.nx) < 1e-9) { if (Math.abs(s.ny * y - s.c) > W) return null; }
    else {
      const u = (s.c - W - s.ny * y) / s.nx, v = (s.c + W - s.ny * y) / s.nx;
      lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
    }
  } else {
    const r = R.Rc - MU_COV, dy = s.y - y;
    if (Math.abs(dy) < r) { const hw = Math.sqrt(r * r - dy * dy); lo = s.x - hw; hi = s.x + hw; }
  }
  let ca = null;
  if (lo !== undefined && hi >= lo) {
    const rg = idxRange(C, lo, hi);
    if (rg) ca = visibleRun(F, bay, bi, o, C, rg, probeOnly);
  }
  if (ra && ca) {
    if (ca[0] <= ra[1] + 1 && ra[0] <= ca[1] + 1) return [Math.min(ra[0], ca[0]), Math.max(ra[1], ca[1])];
    return ra;
  }
  return ra || ca;
}

function idxRange(C, lo, hi) {
  if (hi < lo) return null;
  let a = 0, b = C.length;
  while (a < b) { const m = (a + b) >> 1; if (C[m].x < lo - 1e-9) a = m + 1; else b = m; }
  const first = a;
  a = first; b = C.length;
  while (a < b) { const m = (a + b) >> 1; if (C[m].x <= hi + 1e-9) a = m + 1; else b = m; }
  const last = a - 1;
  return first <= last ? [first, last] : null;
}

// Candidates in [a, b] that see the sample, as the contiguous run nearest to the sample's x.
// Visibility along the row line is computed once per sample as the complement of the "shadows"
// that wall edges cast from the sample onto the row line (closed shadows: grazing blocks).
function visibleRun(F, bay, bi, o, C, [a, b], probeOnly) {
  const s = o.s;
  const sv = { x: s.vx, y: s.vy };
  if (bay.fast && o.inside) return [a, b];
  const r = C[a].y, dy = r - sv.y;
  const xa = Math.min(C[a].x, sv.x) - 1, xb = Math.max(C[b].x, sv.x) + 1;
  const sh = [];
  const BIG = 1e12;
  if (Math.abs(dy) < 1e-6) {
    F.idx.forBox(xa, r - 1, xb, r + 1, e => {
      if (e.a.y === e.b.y || (e.a.y - r) * (e.b.y - r) > 0) return;
      const x = e.a.x + (r - e.a.y) * (e.b.x - e.a.x) / (e.b.y - e.a.y);
      sh.push(x < sv.x ? [-BIG, x] : [x, BIG]);
    });
  } else {
    const ylo = Math.min(sv.y, r), yhi = Math.max(sv.y, r);
    const proj = P => {
      const h = P.y - sv.y;
      if (Math.abs(h) < 1e-9) return P.x >= sv.x ? BIG : -BIG;
      return sv.x + (P.x - sv.x) * dy / h;
    };
    F.idx.forBox(xa, ylo, xb, yhi, e => {
      const p = e.a, q = e.b;
      let t0 = 0, t1 = 1;
      if (Math.abs(q.y - p.y) < 1e-12) { if (p.y <= ylo || p.y >= yhi) return; }
      else {
        const u = (ylo - p.y) / (q.y - p.y), v = (yhi - p.y) / (q.y - p.y);
        t0 = Math.max(0, Math.min(u, v)); t1 = Math.min(1, Math.max(u, v));
        if (t0 >= t1) return;
      }
      const P1 = { x: p.x + t0 * (q.x - p.x), y: p.y + t0 * (q.y - p.y) };
      const P2 = { x: p.x + t1 * (q.x - p.x), y: p.y + t1 * (q.y - p.y) };
      const X1 = proj(P1), X2 = proj(P2);
      sh.push([Math.min(X1, X2), Math.max(X1, X2)]);
    });
  }
  const shadows = mergeIntervals(sh);
  const free = k => { const x = C[k].x; for (const [u, v] of shadows) { if (x < u) return true; if (x <= v) return false; } return true; };
  let c0 = a;
  { let lo = a, hi = b; while (lo < hi) { const m = (lo + hi) >> 1; if (C[m].x < s.x) lo = m + 1; else hi = m; } c0 = lo; }
  if (c0 > a && Math.abs(C[c0 - 1].x - s.x) < Math.abs(C[c0].x - s.x)) c0--;
  const vis = free;
  let start = -1;
  for (let d = 0; c0 - d >= a || c0 + d <= b; d++) {
    if (c0 - d >= a && vis(c0 - d)) { start = c0 - d; break; }
    if (d > 0 && c0 + d <= b && vis(c0 + d)) { start = c0 + d; break; }
  }
  if (start < 0) return null;
  if (probeOnly) return [start, start];
  let l = start, rr = start;
  while (l - 1 >= a && vis(l - 1)) l--;
  while (rr + 1 <= b && vis(rr + 1)) rr++;
  const out = [l, rr];
  if (l > a || rr < b) out.shadowed = true;
  return out;
}

// --- Exact 1-D stabbing DP (§3.4 step 5) ------------------------------------------------------
// Candidates sorted by x; each demand is an index range that must contain a head. A transition
// i -> k is valid iff no demand lies strictly between i and k, and (same visible run) the gap is
// within [Smin, S_row] for the same segment, >= Smin otherwise. Objective: (count, cost).

function stabDP(C, demands, I, R, prefs, targets, pattern, grid) {
  if (!demands.length) return { idx: [], cost: 0 };
  const n = C.length;
  if (!n) return null;
  const INF = 1 << 30;
  const suf = new Int32Array(n + 1).fill(INF);
  let maxA = -1;
  for (const [a, b] of demands) { if (b < suf[a]) suf[a] = b; if (a > maxA) maxA = a; }
  for (let i = n - 1; i >= 0; i--) if (suf[i + 1] < suf[i]) suf[i] = suf[i + 1];
  const runs = I.runs;
  const sp = prefs.spacing, wp = prefs.wallDist;
  const gapCost = g => (sp ? (g - sp) ** 2 : g * g) / 1e6;
  const endCost = e => (wp ? (e - wp) ** 2 : 2 * e * e) / 1e6;
  const startC = i => endCost(C[i].x - runs[C[i].run][0]);
  const finC = i => endCost(runs[C[i].run][1] - C[i].x);
  const tsorted = targets.slice().sort((a, b) => a - b);
  const node = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    if (tsorted.length) {
      let dmin = Infinity;
      for (const t of tsorted) { const d = Math.abs(t - C[i].x); if (d < dmin) dmin = d; }
      const w = pattern === 'staggered' ? 4 : 0.6;
      c += w * Math.min(dmin, 600) ** 2 / 1e6;
    }
    if (grid && !C[i].stop) c += 4;
    node[i] = c;
  }
  const cnt = new Int32Array(n).fill(INF);
  const cst = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const better = (c1, k1, c2, k2) => c1 < c2 || (c1 === c2 && k1 < k2 - 1e-12);
  const allMinB = suf[0];
  for (let i = 0; i < n && i <= allMinB; i++) { cnt[i] = 1; cst[i] = node[i] + startC(i); }
  const smin = R.Smin - TOL, S = I.S + TOL;
  for (let i = 0; i < n; i++) {
    if (cnt[i] >= INF) continue;
    const lim = suf[i + 1];
    if (lim >= INF) continue;               // nothing left to the right: ending here is optimal
    for (let k = i + 1; k <= lim && k < n; k++) {
      const g = C[k].x - C[i].x;
      const sameRun = C[k].run === C[i].run;
      if (sameRun && g < smin) continue;
      const sameSeg = C[k].seg === C[i].seg;
      if (sameSeg && g > S) { // jump to the next segment
        let kk = k; while (kk + 1 <= lim && kk + 1 < n && C[kk + 1].seg === C[i].seg) kk++;
        k = kk; continue;
      }
      const c = cst[i] + node[k] + (sameSeg ? gapCost(g) : finC(i) + startC(k));
      const ct = cnt[i] + 1;
      if (better(ct, c, cnt[k], cst[k])) { cnt[k] = ct; cst[k] = c; prev[k] = i; }
    }
  }
  let bi = -1, bc = INF, bcost = Infinity;
  for (let i = Math.max(0, maxA); i < n; i++) {
    if (cnt[i] >= INF) continue;
    const c = cst[i] + finC(i);
    if (better(cnt[i], c, bc, bcost)) { bi = i; bc = cnt[i]; bcost = c; }
  }
  if (bi < 0) return null;
  const idx = [];
  for (let k = bi; k >= 0; k = prev[k]) idx.push(k);
  idx.reverse();
  return { idx, cost: bcost };
}

function bestGapFill(F, bay, bi, samples, rest, spHeads, R) {
  const U = rest.length > 120 ? rest.filter((_, i) => i % Math.ceil(rest.length / 120) === 0) : rest;
  const need = R.Wmin + 1, smin = R.Smin + TOL, reach = R.Rc - MU_COV;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of U) { x0 = Math.min(x0, o.s.x); y0 = Math.min(y0, o.s.y); x1 = Math.max(x1, o.s.x); y1 = Math.max(y1, o.s.y); }
  const sp = new HeadGrid(spHeads, R.Smin + 1);
  let best = null, bestN = 0;
  for (const o of samples.lat) {
    const p = o.s;
    if ((p.ix + p.iy) % 2) continue;
    if (p.x < x0 - reach || p.x > x1 + reach || p.y < y0 - reach || p.y > y1 + reach) continue;
    if (F.idx.clearance(p, need + 1) < need) continue;
    if (sp.near(p.x, p.y, h => { const dx = h.x - p.x, dy = h.y - p.y; return dx * dx + dy * dy < smin * smin && F.idx.visible(p, h); })) continue;
    const one = new HeadGrid([{ x: p.x, y: p.y, bay: bi }], R.Rc);
    let n = 0;
    for (const u of U) if (satisfied(F, bay, bi, u, one, R)) n++;
    if (n > bestN) { bestN = n; best = { x: p.x, y: p.y }; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------

function fail(code, where, message, at) {
  return { ok: false, heads: [], notes: null, error: { code, where: at ? [at] : where, outline: where, message } };
}
function centroidOf(r) { let x = 0, y = 0; for (const p of r) { x += p.x; y += p.y; } return { x: x / r.length, y: y / r.length }; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lexLess(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i] - 1e-12) return true; if (a[i] > b[i] + 1e-12) return false; } return false; }
function round3(v) { return Math.round(v * 1000) / 1000; }
