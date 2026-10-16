// Independent verification oracle for NZS 4541 head layouts (design §4).
//
// INDEPENDENCE RULES: this module imports nothing (not the placer, not its geometry kernel, not
// the rule module). It receives only the original zone polygon in mm, the heads and the raw rule
// figures. It never sees frames, rows, bays or the placer's samples. It samples its own lattice
// (100 mm, phase 37/61 mm from the bbox corner) and its own boundary points (every 50 mm).
// Exact limits with a 1 mm tolerance, no safety margin.

const TOL_MM = 1;
const STEP = 100, PHASE_X = 37, PHASE_Y = 61, EDGE_STEP = 50;
// Trace tolerance: a sample closer than this to a wall is judged for sight lines from a probe point
// pushed this far into the room, so sub-50 mm tracing artefacts (stair-step pockets) cannot decide
// visibility. Coverage distance is still measured from the sample itself.
const TRACE_TOL = 50;
const COLUMN_MAX_MM = 1000;

// ---- own minimal kernel (deliberately duplicated, written differently) ------------------------

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[i === poly.length - 1 ? 0 : i + 1];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return -s / 2;
}

function insideRing(px, py, poly) {
  let wn = 0; // winding number
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.y <= py) {
      if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) wn++;
    } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) wn--;
  }
  return wn !== 0;
}

function segPointDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Parametric test: does the open segment p->q touch the closed edge e (excluding contact at p or q)?
function crosses(px, py, qx, qy, e) {
  const rx = qx - px, ry = qy - py, sx = e.bx - e.ax, sy = e.by - e.ay;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return false; // parallel / collinear: not a blocker
  const wx = e.ax - px, wy = e.ay - py;
  const t = (wx * sy - wy * sx) / den;
  const u = (wx * ry - wy * rx) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-12 && u <= 1 + 1e-12;
}

class EdgeBuckets {
  constructor(edges, size) {
    this.edges = edges; this.size = size; this.cells = new Map(); this.seen = new Uint32Array(edges.length); this.tick = 1;
    edges.forEach((e, k) => {
      const c0 = Math.floor(Math.min(e.ax, e.bx) / size), c1 = Math.floor(Math.max(e.ax, e.bx) / size);
      const r0 = Math.floor(Math.min(e.ay, e.by) / size), r1 = Math.floor(Math.max(e.ay, e.by) / size);
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
        const key = `${c},${r}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(k);
      }
    });
  }
  each(x0, y0, x1, y1, fn) {
    const s = this.size; this.tick++;
    for (let c = Math.floor(x0 / s); c <= Math.floor(x1 / s); c++) {
      for (let r = Math.floor(y0 / s); r <= Math.floor(y1 / s); r++) {
        const list = this.cells.get(`${c},${r}`);
        if (!list) continue;
        for (const k of list) {
          if (this.seen[k] === this.tick) continue;
          this.seen[k] = this.tick;
          if (fn(this.edges[k])) return true;
        }
      }
    }
    return false;
  }
  clearSight(px, py, qx, qy) {
    return !this.each(Math.min(px, qx), Math.min(py, qy), Math.max(px, qx), Math.max(py, qy), e => crosses(px, py, qx, qy, e));
  }
}

// ---- zone model ----------------------------------------------------------------------------------

function buildZone(zone) {
  const fix = (ring, wantPositive) => {
    const pts = ring.map(p => ({ x: +p.x, y: +p.y }));
    return (signedArea(pts) > 0) === wantPositive ? pts : pts.reverse();
  };
  const outer = fix(zone.outer, true);
  const holes = (zone.holes || []).map(h => fix(h, false));
  const open = zone.openEdges || [];
  const isOpen = (a, b) => open.some(o =>
    segPointDistance(a.x, a.y, o.a.x, o.a.y, o.b.x, o.b.y) < 2 && segPointDistance(b.x, b.y, o.a.x, o.a.y, o.b.x, o.b.y) < 2);
  const walls = [];      // barriers: block sight, carry the wall-distance rule
  const allEdges = [];
  // Column = a hole whose largest extent is at most COLUMN_MAX_MM. Columns block spray and need Wmin
  // clearance, but carry no Wmax rule (founder decision 2026-10-17, option a). Larger holes (shafts,
  // voids) are real walls.
  const isColumn = ring => {
    const xs = ring.map(p => p.x), ys = ring.map(p => p.y);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) <= COLUMN_MAX_MM;
  };
  const addRing = (ring, outerRing) => {
    const column = !outerRing && isColumn(ring);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const e = { ax: a.x, ay: a.y, bx: b.x, by: b.y, len, open: outerRing && isOpen(a, b), column };
      // inward unit normal: region lies to the left for a positive outer ring and a negative hole ring
      e.inx = -(b.y - a.y) / len; e.iny = (b.x - a.x) / len;
      allEdges.push(e);
      if (!e.open) walls.push(e);
    }
  };
  addRing(outer, true);
  holes.forEach(h => addRing(h, false));
  let area = Math.abs(signedArea(outer));
  for (const h of holes) area -= Math.abs(signedArea(h));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of outer) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { outer, holes, walls, allEdges, area, box: { x0, y0, x1, y1 }, buckets: new EdgeBuckets(walls, 1000) };
}

// Push a probe point along the inward normal of edge e until it is tol mm from that wall, as long
// as it stays in the room and in sight of where it started.
function pushInto(Z, x, y, e, tol) {
  const d0 = Math.abs((x - e.ax) * e.inx + (y - e.ay) * e.iny);
  for (let t = tol - d0; t > 0.5; t /= 2) {
    const cx = x + e.inx * t, cy = y + e.iny * t;
    if (inRegion(Z, cx, cy) && Z.buckets.clearSight(x, y, cx, cy)) return { x: cx, y: cy };
  }
  return { x, y };
}
function latticeProbe(Z, p) {
  let best = null, bd = TRACE_TOL;
  Z.buckets.each(p.x - TRACE_TOL, p.y - TRACE_TOL, p.x + TRACE_TOL, p.y + TRACE_TOL, e => {
    const d = segPointDistance(p.x, p.y, e.ax, e.ay, e.bx, e.by);
    if (d < bd) { bd = d; best = e; }
    return false;
  });
  if (best) { const q = pushInto(Z, p.x, p.y, best, TRACE_TOL); p.px = q.x; p.py = q.y; }
  return p;
}

function inRegion(Z, x, y) {
  if (!insideRing(x, y, Z.outer)) return false;
  for (const h of Z.holes) if (insideRing(x, y, h)) return false;
  return true;
}

function figures(ruleset, hazard, reduced) {
  const f = ruleset.hazards[hazard];
  const Smax = f.Smax * 1000, Amax = f.Amax * 1e6;
  return {
    Smax, Amax, Smin: f.Smin * 1000, Wmin: f.Wmin * 1000,
    Wmax: (reduced ? f.WmaxReduced : f.Wmax) * 1000,
    Rc: Math.sqrt(Smax * Smax + (Amax / Smax) * (Amax / Smax)) / 2,
  };
}

// ---- main check --------------------------------------------------------------------------------

/**
 * @param zone {outer, holes?, openEdges?} in mm (original polygon)
 * @param heads [{id, x, y}] in mm
 * @param ruleset raw rule set data, hazard 'ELH'|'OH1'|'OH2'|'OH3'
 * @param opts {neighbours?: [{zone, heads}], reducedWallDist?}
 */
export function checkZone(zone, heads, ruleset, hazard, opts = {}) {
  const fig = figures(ruleset, hazard, opts.reducedWallDist);
  const Z = buildZone(zone);
  const flags = [];
  const H = heads.map(h => ({ id: h.id, x: +h.x, y: +h.y }));
  const nb = (opts.neighbours || []).map(n => ({ Z: buildZone(n.zone), heads: n.heads.map(h => ({ id: h.id, x: +h.x, y: +h.y })) }));

  const see = (a, b) => Z.buckets.clearSight(a.x, a.y, b.x, b.y);
  const seeAcross = (a, b) => see(a, b) && nb.every(n => n.Z.buckets.clearSight(a.x, a.y, b.x, b.y));

  // head grid for neighbourhood queries
  const cell = fig.Rc;
  const grid = new Map();
  H.forEach((h, i) => {
    const key = `${Math.floor(h.x / cell)},${Math.floor(h.y / cell)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  const near = (x, y, fn) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      const list = grid.get(`${i},${j}`);
      if (list) for (const k of list) if (fn(H[k], k)) return true;
    }
    return false;
  };

  // C6 inside / clearance
  let minWall = Infinity;
  for (const h of H) {
    if (!inRegion(Z, h.x, h.y)) {
      flags.push({ code: 'OUTSIDE', severity: 'error', headIds: [h.id], where: { x: h.x, y: h.y }, message: 'Head is outside the zone or inside a column/hole.' });
      continue;
    }
    let d = Infinity;
    for (const e of Z.walls) d = Math.min(d, segPointDistance(h.x, h.y, e.ax, e.ay, e.bx, e.by));
    minWall = Math.min(minWall, d);
    if (d < fig.Wmin - TOL_MM) {
      flags.push({ code: 'WALL_CLEARANCE', severity: 'error', headIds: [h.id], where: { x: h.x, y: h.y }, value: d, limit: fig.Wmin,
        message: `Head is ${fmtM(d)} from a wall; minimum is ${fmtM(fig.Wmin)}.` });
    }
  }

  // samples
  const lattice = [];
  const { x0, y0, x1, y1 } = Z.box;
  let gi = 0;
  for (let y = y0 + PHASE_Y, gj = 0; y < y1; y += STEP, gj++) {
    gi = 0;
    for (let x = x0 + PHASE_X; x < x1; x += STEP, gi++) if (inRegion(Z, x, y)) lattice.push(latticeProbe(Z, { x, y, gi, gj }));
  }
  const boundary = [];
  for (const e of Z.allEdges) {
    for (let s = 0; s < e.len; s += EDGE_STEP) {
      const t = s / e.len;
      const x = e.ax + (e.bx - e.ax) * t, y = e.ay + (e.by - e.ay) * t;
      // probe point for sight lines: just inside the room (shrinks in acute corners; at a vertex
      // it also steps along the edge)
      const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
      let px = x, py = y;
      for (let d = 1; d > 1e-4; d /= 3) {
        const along = s === 0 ? 4 * d : (e.len - s < 4 * d ? -2 * d : 0);
        const cx = x + e.inx * d + ux * along, cy = y + e.iny * d + uy * along;
        if (inRegion(Z, cx, cy)) { px = cx; py = cy; break; }
        const bx = x + e.inx * d * 0.1 + ux * along, by = y + e.iny * d * 0.1 + uy * along; // sliver corners
        if (along && inRegion(Z, bx, by)) { px = bx; py = by; break; }
      }
      const pr = pushInto(Z, px, py, e, TRACE_TOL);
      boundary.push({ x, y, e, px: pr.x, py: pr.y });
    }
  }

  // C1 coverage (lattice + boundary)
  const reach = fig.Rc + TOL_MM;
  const covered = p => near(p.x, p.y, h => {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    return d <= reach && see(h, { x: p.px ?? p.x, y: p.py ?? p.y });
  });
  const holesL = [];
  let coveredCount = 0;
  for (const p of lattice) { if (covered(p)) coveredCount++; else holesL.push(p); }
  const holesB = boundary.filter(p => !covered(p));
  const clusters = clusterGaps(holesL, holesB);
  for (const c of clusters) {
    flags.push({ code: 'UNCOVERED', severity: 'error', headIds: [], where: c.at, value: c.areaM2,
      message: `Uncovered area ≈ ${c.areaM2.toFixed(2)} m² (${c.n} sample point${c.n > 1 ? 's' : ''}) — no visible head within ${fmtM(fig.Rc)}.` });
  }

  // C2 wall distance (perpendicular to the wall line, head visible and within Rc)
  let worstWall = 0;
  const wallBad = [];
  for (const p of boundary) {
    if (p.e.open || p.e.column) continue;   // Wmax applies to real walls only
    let best = Infinity;
    near(p.x, p.y, h => {
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d > reach) return false;
      const perp = Math.abs((h.x - p.e.ax) * p.e.inx + (h.y - p.e.ay) * p.e.iny);
      if (perp < best && see(h, { x: p.px, y: p.py })) best = perp;
      return false;
    });
    if (best > worstWall) worstWall = best;
    if (best > fig.Wmax + TOL_MM) wallBad.push({ p, best });
  }
  // one flag per run of consecutive failing samples on the same edge
  for (let i = 0; i < wallBad.length; i++) {
    const run = [wallBad[i]];
    while (i + 1 < wallBad.length && wallBad[i + 1].p.e === wallBad[i].p.e) run.push(wallBad[++i]);
    const mid = run[Math.floor(run.length / 2)];
    const worst = Math.max(...run.map(r => r.best));
    flags.push({ code: 'WALL_DIST', severity: 'error', headIds: [], where: { x: mid.p.x, y: mid.p.y }, value: worst, limit: fig.Wmax,
      message: isFinite(worst)
        ? `Wall stretch ${(run.length * EDGE_STEP / 1000).toFixed(2)} m long: nearest visible head is ${fmtM(worst)} from the wall line (max ${fmtM(fig.Wmax)}).`
        : `Wall stretch ${(run.length * EDGE_STEP / 1000).toFixed(2)} m long has no visible head within ${fmtM(fig.Rc)}.` });
  }

  // C3 / C4 spacing (visible pairs only; neighbours across open edges included)
  const peers = H.map(h => ({ ...h, own: true })).concat(nb.flatMap(n => n.heads.map(h => ({ ...h, own: false }))));
  let minSp = Infinity, maxNN = 0;
  for (let i = 0; i < H.length; i++) {
    const h = H[i];
    let nn = Infinity;
    for (let j = 0; j < peers.length; j++) {
      if (j === i) continue;
      const g = peers[j];
      const d = Math.hypot(g.x - h.x, g.y - h.y);
      if (d >= nn && d >= fig.Smin) continue;
      if (!(g.own ? see(h, g) : seeAcross(h, g))) continue;
      if (d < nn) nn = d;
      if (d < minSp) minSp = d;
      if (d < fig.Smin - TOL_MM && (!g.own || j > i)) {
        flags.push({ code: 'MIN_SPACING', severity: 'error', headIds: [h.id, g.id], where: { x: (h.x + g.x) / 2, y: (h.y + g.y) / 2 }, value: d, limit: fig.Smin,
          message: `Heads ${fmtM(d)} apart${g.own ? '' : ' (across the open edge to the next zone)'}; minimum is ${fmtM(fig.Smin)}.` });
      }
    }
    if (isFinite(nn)) {
      maxNN = Math.max(maxNN, nn);
      if (nn > fig.Smax + TOL_MM) {
        flags.push({ code: 'MAX_SPACING', severity: 'error', headIds: [h.id], where: { x: h.x, y: h.y }, value: nn, limit: fig.Smax,
          message: `Nearest visible head is ${fmtM(nn)} away; maximum spacing is ${fmtM(fig.Smax)}.` });
      }
    }
  }

  // C5 area per head (warnings only, founder decision 2). Local cells: lattice points given to the
  // nearest visible head (own discrete Voronoi, clipped by sight lines).
  const areaM2 = Z.area / 1e6;
  const perHead = H.length ? areaM2 / H.length : Infinity;
  if (H.length && perHead > fig.Amax / 1e6 + 1e-9) {
    flags.push({ code: 'AREA_ZONE', severity: 'warning', headIds: [], where: centroid(Z.outer), value: perHead, limit: fig.Amax / 1e6,
      message: `Zone area per head ${perHead.toFixed(2)} m² exceeds ${fig.Amax / 1e6} m².` });
  }
  const cellCount = new Array(H.length).fill(0);
  if (H.length) {
    for (const p of lattice) {
      const cand = [];
      near(p.x, p.y, (h, k) => { cand.push([(h.x - p.x) ** 2 + (h.y - p.y) ** 2, k]); return false; });
      cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, k] of cand) if (see(H[k], p)) { cellCount[k]++; break; }
    }
  }
  let maxLocal = 0;
  cellCount.forEach((n, k) => {
    const a = n * STEP * STEP / 1e6;
    maxLocal = Math.max(maxLocal, a);
    if (a > fig.Amax / 1e6 * 1.0 + 0.05) {
      flags.push({ code: 'AREA_LOCAL', severity: 'warning', headIds: [H[k].id], where: { x: H[k].x, y: H[k].y }, value: a, limit: fig.Amax / 1e6,
        message: `Local cell of this head ≈ ${a.toFixed(1)} m² (over ${fig.Amax / 1e6} m²).` });
    }
  });

  if (!H.length) {
    flags.push({ code: 'NO_HEADS', severity: 'error', headIds: [], where: centroid(Z.outer), message: 'No heads in this zone.' });
  }
  if (!ruleset.verified) flags.push({ code: 'RULES_UNVERIFIED', severity: 'warning', headIds: [], message: 'Rule figures are not verified.' });

  const errors = flags.filter(f => f.severity === 'error');
  return {
    hazard, ruleSet: { id: ruleset.id, version: ruleset.version, verified: !!ruleset.verified },
    figures: fig,
    headCount: H.length,
    areaM2,
    areaPerHeadM2: perHead,
    maxLocalAreaM2: maxLocal,
    minSpacingM: isFinite(minSp) ? minSp / 1000 : null,
    maxNNSpacingM: H.length > 1 ? maxNN / 1000 : null,
    worstWallDistM: isFinite(worstWall) ? worstWall / 1000 : Infinity,
    minWallDistM: isFinite(minWall) ? minWall / 1000 : null,
    coverage: lattice.length ? coveredCount / lattice.length : 0,
    samples: { lattice: lattice.length, boundary: boundary.length },
    flags,
    errors: errors.length,
    warnings: flags.length - errors.length,
    pass: errors.length === 0,
  };
}

// 4-connected clusters of uncovered lattice points; uncovered boundary points join the nearest
// cluster within 150 mm or form their own.
function clusterGaps(lat, bnd) {
  const key = (i, j) => `${i},${j}`;
  const idx = new Map(lat.map((p, k) => [key(p.gi, p.gj), k]));
  const comp = new Array(lat.length).fill(-1);
  const groups = [];
  for (let k = 0; k < lat.length; k++) {
    if (comp[k] >= 0) continue;
    const g = [k]; comp[k] = groups.length;
    for (let q = 0; q < g.length; q++) {
      const p = lat[g[q]];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = idx.get(key(p.gi + di, p.gj + dj));
        if (n !== undefined && comp[n] < 0) { comp[n] = groups.length; g.push(n); }
      }
    }
    groups.push(g.map(i => lat[i]));
  }
  for (const b of bnd) {
    let gi = -1, bd = 150;
    groups.forEach((g, i) => { for (const p of g) { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd) { bd = d; gi = i; } } });
    if (gi >= 0) groups[gi].push(b); else groups.push([b]);
  }
  return groups.map(g => {
    let sx = 0, sy = 0; for (const p of g) { sx += p.x; sy += p.y; }
    const cx = sx / g.length, cy = sy / g.length;
    let at = g[0], bd = Infinity;
    for (const p of g) { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; at = p; } }
    const nLat = g.filter(p => p.gi !== undefined).length;
    return { at: { x: at.x, y: at.y }, n: g.length, areaM2: Math.max(nLat, 1) * STEP * STEP / 1e6 };
  });
}

function centroid(r) { let x = 0, y = 0; for (const p of r) { x += p.x; y += p.y; } return { x: x / r.length, y: y / r.length }; }
function fmtM(mm) { return isFinite(mm) ? `${(mm / 1000).toFixed(3)} m` : '∞'; }

/**
 * Per-head coverage polygons for the overlay (design §9.5 hook: the overlay draws polygons, so
 * baffled shapes can drop in later). Visual only — verdicts always come from checkZone.
 * shape: 'circle' (radius Rc) or 'square' (side Rc·√2, turned to frameRad).
 */
export function coveragePolygons(zone, heads, ruleset, hazard, shape = 'circle', frameRad = 0, rays = 96) {
  const fig = figures(ruleset, hazard);
  const Z = buildZone(zone);
  return heads.map(h => {
    const pts = [];
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      let r = fig.Rc;
      if (shape === 'square') {
        const half = fig.Rc / Math.SQRT2;
        const lx = Math.abs(dx * Math.cos(frameRad) + dy * Math.sin(frameRad));
        const ly = Math.abs(-dx * Math.sin(frameRad) + dy * Math.cos(frameRad));
        r = half / Math.max(lx, ly);
      }
      // clip at the first wall hit
      const qx = h.x + dx * r, qy = h.y + dy * r;
      Z.buckets.each(Math.min(h.x, qx), Math.min(h.y, qy), Math.max(h.x, qx), Math.max(h.y, qy), e => {
        const sx = e.bx - e.ax, sy = e.by - e.ay;
        const den = dx * sy - dy * sx;
        if (Math.abs(den) < 1e-12) return false;
        const wx = e.ax - h.x, wy = e.ay - h.y;
        const t = (wx * sy - wy * sx) / den, u = (wx * dy - wy * dx) / den;
        if (t > 0 && t < r && u >= 0 && u <= 1) r = t;
        return false;
      });
      pts.push({ x: h.x + dx * r, y: h.y + dy * r });
    }
    return { id: h.id, pts };
  });
}
