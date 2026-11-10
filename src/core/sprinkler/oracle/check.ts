// Story 9.4 (FR77, NFR9, design §4): the independent coverage oracle.
//
// INDEPENDENCE (AR24): this module imports only its own kernel. It never sees
// the placer's frame, rows, bays, simplified polygon or samples; it receives
// the original zone (its barriers), the heads and the raw rule figures, and
// samples its own lattice (100 mm, phase 37 / 61 mm from the bbox corner) and
// its own boundary points (every 50 mm). Exact limits with a 1 mm tolerance.
// A lint rule and oracle-independence.test.ts enforce the imports.
//
// Units: millimetres in, figures in metres / m² (as the rule set stores them).

import { EdgeBuckets, centroidOf, insideRing, segPointDistance, signedArea, type Edge, type Pt } from "./kernel";

export type { Pt } from "./kernel";

const TOL_MM = 1;
const STEP = 100;
const PHASE_X = 37;
const PHASE_Y = 61;
const EDGE_STEP = 50;
/**
 * A sample closer than this to a wall is judged for sight lines from a probe
 * pushed this far into the room, so sub-50 mm tracing artefacts (stair-step
 * pockets from a dynamic fill) cannot decide visibility. Coverage distance is
 * still measured from the sample itself.
 */
const TRACE_TOL = 50;

/**
 * What blocks spray and bounds the zone (design §9.5 hook: future obstructions
 * add kinds here). `wall`: the zone's outline (exactly one). `column`: a hole
 * that blocks spray and needs Wmin clearance, with no Wmax on its faces
 * (founder decision 4). `shaft`: a shaft or void, a real wall with Wmax.
 */
export type BarrierKind = "wall" | "column" | "shaft";
export type Barrier = { kind: BarrierKind; ring: readonly Pt[] };
/** An outline edge with no wall: the zone touches the next zone there (founder decision 6). */
export type OpenEdge = { a: Pt; b: Pt };
/** A light fitting, grille or downlight no head may sit in (plus `clearance` mm). */
export type KeepOut = { ring: readonly Pt[]; clearance?: number } | { circle: { x: number; y: number; r: number }; clearance?: number };

export type OracleZone = { barriers: readonly Barrier[]; openEdges?: readonly OpenEdge[]; keepOuts?: readonly KeepOut[] };
/** The rule figures of the zone's hazard class, metres and m². */
export type OracleFigures = { Amax: number; Smax: number; Smin: number; Wmax: number; Wmin: number };
export type OracleHead = { id: string; x: number; y: number };

export type FlagCode =
  | "UNCOVERED"
  | "WALL_DIST"
  | "MIN_SPACING"
  | "MAX_SPACING"
  | "AREA_ZONE"
  | "AREA_LOCAL"
  | "WALL_CLEARANCE"
  | "OUTSIDE"
  | "IN_KEEPOUT"
  | "NO_HEADS"
  | "RULES_UNVERIFIED";

export type Flag = {
  code: FlagCode;
  severity: "error" | "warning";
  headIds: string[];
  where?: Pt;
  value?: number;
  limit?: number;
  message: string;
};

export type OracleReport = {
  ruleSet: { id: string; version: string; verified: boolean } | null;
  /** The figures in mm / mm², with the coverage radius Rc = ½·√(Smax² + (Amax/Smax)²). */
  figures: { Amax: number; Smax: number; Smin: number; Wmax: number; Wmin: number; Rc: number };
  headCount: number;
  areaM2: number;
  areaPerHeadM2: number;
  maxLocalAreaM2: number;
  minSpacingM: number | null;
  maxNNSpacingM: number | null;
  worstWallDistM: number;
  minWallDistM: number | null;
  /** Covered share of the interior lattice, 0..1. */
  coverage: number;
  samples: { lattice: number; boundary: number };
  flags: Flag[];
  errors: number;
  warnings: number;
  pass: boolean;
};

export type CheckOptions = {
  /** Zones that share open edges with this one, with their heads (coverage and spacing across the edge). */
  neighbours?: readonly { zone: OracleZone; heads: readonly OracleHead[] }[];
  ruleSet?: { id: string; version: string; verified: boolean };
};

type ZoneModel = {
  outer: Pt[];
  holes: Pt[][];
  walls: Edge[];
  allEdges: Edge[];
  area: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  buckets: EdgeBuckets;
};

type Sample = { x: number; y: number; px: number; py: number; gi?: number; gj?: number; e?: Edge };

function figuresMm(f: OracleFigures) {
  const Smax = f.Smax * 1000;
  const Amax = f.Amax * 1e6;
  return { Smax, Amax, Smin: f.Smin * 1000, Wmin: f.Wmin * 1000, Wmax: f.Wmax * 1000, Rc: Math.sqrt(Smax * Smax + (Amax / Smax) * (Amax / Smax)) / 2 };
}

function buildZone(zone: OracleZone): ZoneModel {
  const outlines = zone.barriers.filter((b) => b.kind === "wall");
  if (outlines.length !== 1) throw new Error("A zone has exactly one wall barrier (its outline).");
  const oriented = (ring: readonly Pt[], positive: boolean): Pt[] => {
    const pts = ring.map((p) => ({ x: +p.x, y: +p.y }));
    return signedArea(pts) > 0 === positive ? pts : pts.reverse();
  };
  const outer = oriented(outlines[0].ring, true);
  const holeBarriers = zone.barriers.filter((b) => b.kind !== "wall");
  const holes = holeBarriers.map((b) => oriented(b.ring, false));
  const open = zone.openEdges ?? [];
  const isOpen = (a: Pt, b: Pt) =>
    open.some((o) => segPointDistance(a.x, a.y, o.a.x, o.a.y, o.b.x, o.b.y) < 2 && segPointDistance(b.x, b.y, o.a.x, o.a.y, o.b.x, o.b.y) < 2);
  const walls: Edge[] = [];
  const allEdges: Edge[] = [];
  const addRing = (ring: Pt[], isOuter: boolean, kind: BarrierKind) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      // Inward normal: the region lies to the left of a positive outer ring and of a negative hole ring.
      const e: Edge = {
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        len,
        inx: -(b.y - a.y) / len,
        iny: (b.x - a.x) / len,
        open: isOuter && isOpen(a, b),
        column: kind === "column",
      };
      allEdges.push(e);
      if (!e.open) walls.push(e);
    }
  };
  addRing(outer, true, "wall");
  holes.forEach((h, i) => addRing(h, false, holeBarriers[i].kind));
  let area = Math.abs(signedArea(outer));
  for (const h of holes) area -= Math.abs(signedArea(h));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of outer) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { outer, holes, walls, allEdges, area, box: { x0, y0, x1, y1 }, buckets: new EdgeBuckets(walls, 1000) };
}

function inRegion(Z: ZoneModel, x: number, y: number): boolean {
  if (!insideRing(x, y, Z.outer)) return false;
  for (const h of Z.holes) if (insideRing(x, y, h)) return false;
  return true;
}

/** Pushes a probe along edge e's inward normal until it is `tol` from that wall, while it stays in the room and in sight. */
function pushInto(Z: ZoneModel, x: number, y: number, e: Edge, tol: number): Pt {
  const d0 = Math.abs((x - e.ax) * e.inx + (y - e.ay) * e.iny);
  for (let t = tol - d0; t > 0.5; t /= 2) {
    const cx = x + e.inx * t;
    const cy = y + e.iny * t;
    if (inRegion(Z, cx, cy) && Z.buckets.clearSight(x, y, cx, cy)) return { x: cx, y: cy };
  }
  return { x, y };
}

function latticeProbe(Z: ZoneModel, p: Sample): Sample {
  let best = null as Edge | null;
  let bd = TRACE_TOL;
  Z.buckets.each(p.x - TRACE_TOL, p.y - TRACE_TOL, p.x + TRACE_TOL, p.y + TRACE_TOL, (e) => {
    const d = segPointDistance(p.x, p.y, e.ax, e.ay, e.bx, e.by);
    if (d < bd) {
      bd = d;
      best = e;
    }
    return false;
  });
  if (best) {
    const q = pushInto(Z, p.x, p.y, best, TRACE_TOL);
    p.px = q.x;
    p.py = q.y;
  }
  return p;
}

function boundarySamples(Z: ZoneModel): Sample[] {
  const out: Sample[] = [];
  for (const e of Z.allEdges) {
    const ux = (e.bx - e.ax) / e.len;
    const uy = (e.by - e.ay) / e.len;
    for (let s = 0; s < e.len; s += EDGE_STEP) {
      const t = s / e.len;
      const x = e.ax + (e.bx - e.ax) * t;
      const y = e.ay + (e.by - e.ay) * t;
      // The sight-line probe: just inside the room (shrinks in acute corners; at a vertex it also steps along the edge).
      let px = x;
      let py = y;
      for (let d = 1; d > 1e-4; d /= 3) {
        const along = s === 0 ? 4 * d : e.len - s < 4 * d ? -2 * d : 0;
        const cx = x + e.inx * d + ux * along;
        const cy = y + e.iny * d + uy * along;
        if (inRegion(Z, cx, cy)) {
          px = cx;
          py = cy;
          break;
        }
        const bx = x + e.inx * d * 0.1 + ux * along;
        const by = y + e.iny * d * 0.1 + uy * along;
        if (along && inRegion(Z, bx, by)) {
          px = bx;
          py = by;
          break;
        }
      }
      const pr = pushInto(Z, px, py, e, TRACE_TOL);
      out.push({ x, y, e, px: pr.x, py: pr.y });
    }
  }
  return out;
}

function inKeepOut(k: KeepOut, x: number, y: number): boolean {
  const c = k.clearance ?? 0;
  if ("circle" in k) return Math.hypot(x - k.circle.x, y - k.circle.y) < k.circle.r + c - TOL_MM;
  if (insideRing(x, y, k.ring)) return true;
  if (c <= TOL_MM) return false;
  for (let i = 0; i < k.ring.length; i++) {
    const a = k.ring[i];
    const b = k.ring[(i + 1) % k.ring.length];
    if (segPointDistance(x, y, a.x, a.y, b.x, b.y) < c - TOL_MM) return true;
  }
  return false;
}

const fmtM = (mm: number) => (Number.isFinite(mm) ? `${(mm / 1000).toFixed(3)} m` : "∞");

/** Checks `heads` in `zone` against `figures` (design §4.2, C1–C7). Pure and deterministic. */
export function checkZone(zone: OracleZone, heads: readonly OracleHead[], figures: OracleFigures, opts: CheckOptions = {}): OracleReport {
  const fig = figuresMm(figures);
  const Z = buildZone(zone);
  const flags: Flag[] = [];
  const H = heads.map((h) => ({ id: h.id, x: +h.x, y: +h.y }));
  const nb = (opts.neighbours ?? []).map((n) => ({ Z: buildZone(n.zone), heads: n.heads.map((h) => ({ id: h.id, x: +h.x, y: +h.y })) }));

  const see = (a: Pt, b: Pt) => Z.buckets.clearSight(a.x, a.y, b.x, b.y);
  const seeAcross = (a: Pt, b: Pt) => see(a, b) && nb.every((n) => n.Z.buckets.clearSight(a.x, a.y, b.x, b.y));

  // A grid of heads (cell Rc) for neighbourhood queries.
  const cell = fig.Rc;
  const grid = new Map<string, number[]>();
  H.forEach((h, i) => {
    const key = `${Math.floor(h.x / cell)},${Math.floor(h.y / cell)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  // Every head within Rc + the tolerance of (x, y) is visited: the cells are taken from that
  // reach, not from the sample's own cell ± 1, which misses a head up to 1 mm past Rc when the
  // sample lies at the far side of its cell (the verdict then depended on where the zone sat).
  const span = fig.Rc + TOL_MM;
  const near = (x: number, y: number, fn: (h: OracleHead, k: number) => boolean): boolean => {
    for (let i = Math.floor((x - span) / cell); i <= Math.floor((x + span) / cell); i++)
      for (let j = Math.floor((y - span) / cell); j <= Math.floor((y + span) / cell); j++) {
        const list = grid.get(`${i},${j}`);
        if (list) for (const k of list) if (fn(H[k], k)) return true;
      }
    return false;
  };

  // C6: inside, clearance from every wall and hole face, keep-outs.
  let minWall = Infinity;
  for (const h of H) {
    if (!inRegion(Z, h.x, h.y)) {
      flags.push({ code: "OUTSIDE", severity: "error", headIds: [h.id], where: { x: h.x, y: h.y }, message: "Head is outside the zone or inside a column or hole." });
      continue;
    }
    let d = Infinity;
    for (const e of Z.walls) d = Math.min(d, segPointDistance(h.x, h.y, e.ax, e.ay, e.bx, e.by));
    minWall = Math.min(minWall, d);
    if (d < fig.Wmin - TOL_MM) {
      flags.push({
        code: "WALL_CLEARANCE",
        severity: "error",
        headIds: [h.id],
        where: { x: h.x, y: h.y },
        value: d,
        limit: fig.Wmin,
        message: `Head is ${fmtM(d)} from a wall; the minimum is ${fmtM(fig.Wmin)}.`,
      });
    }
    if ((zone.keepOuts ?? []).some((k) => inKeepOut(k, h.x, h.y))) {
      flags.push({ code: "IN_KEEPOUT", severity: "error", headIds: [h.id], where: { x: h.x, y: h.y }, message: "Head is in a keep-out (light fitting, grille or its clearance)." });
    }
  }

  // Samples: the interior lattice and the boundary.
  const lattice: Sample[] = [];
  const { x0, y0, x1, y1 } = Z.box;
  for (let y = y0 + PHASE_Y, gj = 0; y < y1; y += STEP, gj++) {
    let gi = 0;
    for (let x = x0 + PHASE_X; x < x1; x += STEP, gi++) if (inRegion(Z, x, y)) lattice.push(latticeProbe(Z, { x, y, px: x, py: y, gi, gj }));
  }
  const boundary = boundarySamples(Z);

  // C1: coverage — a visible head within Rc of every sample.
  const reach = fig.Rc + TOL_MM;
  const covered = (p: Sample) => near(p.x, p.y, (h) => Math.hypot(h.x - p.x, h.y - p.y) <= reach && see(h, { x: p.px, y: p.py }));
  const gapsL: Sample[] = [];
  let coveredCount = 0;
  for (const p of lattice) {
    if (covered(p)) coveredCount++;
    else gapsL.push(p);
  }
  const gapsB = boundary.filter((p) => !covered(p));
  for (const c of clusterGaps(gapsL, gapsB)) {
    flags.push({
      code: "UNCOVERED",
      severity: "error",
      headIds: [],
      where: c.at,
      value: c.areaM2,
      message: `Uncovered area ≈ ${c.areaM2.toFixed(2)} m² (${c.n} sample point${c.n > 1 ? "s" : ""}): no visible head within ${fmtM(fig.Rc)}.`,
    });
  }

  // C2: wall distance — perpendicular to the wall line, from a visible head within Rc (real walls only).
  let worstWall = 0;
  const wallBad: { p: Sample; best: number }[] = [];
  for (const p of boundary) {
    const e = p.e!;
    if (e.open || e.column) continue;
    let best = Infinity;
    near(p.x, p.y, (h) => {
      if (Math.hypot(h.x - p.x, h.y - p.y) > reach) return false;
      const perp = Math.abs((h.x - e.ax) * e.inx + (h.y - e.ay) * e.iny);
      if (perp < best && see(h, { x: p.px, y: p.py })) best = perp;
      return false;
    });
    if (best > worstWall) worstWall = best;
    if (best > fig.Wmax + TOL_MM) wallBad.push({ p, best });
  }
  // One flag per run of failing samples on the same edge.
  for (let i = 0; i < wallBad.length; i++) {
    const run = [wallBad[i]];
    while (i + 1 < wallBad.length && wallBad[i + 1].p.e === wallBad[i].p.e) run.push(wallBad[++i]);
    const mid = run[Math.floor(run.length / 2)];
    const worst = Math.max(...run.map((r) => r.best));
    const stretch = ((run.length * EDGE_STEP) / 1000).toFixed(2);
    flags.push({
      code: "WALL_DIST",
      severity: "error",
      headIds: [],
      where: { x: mid.p.x, y: mid.p.y },
      value: worst,
      limit: fig.Wmax,
      message: Number.isFinite(worst)
        ? `Wall stretch ${stretch} m long: the nearest visible head is ${fmtM(worst)} from the wall line (max ${fmtM(fig.Wmax)}).`
        : `Wall stretch ${stretch} m long has no visible head within ${fmtM(fig.Rc)}.`,
    });
  }

  // C3 / C4: spacing between visible pairs (heads of neighbour zones across open edges included).
  const peers = [...H.map((h) => ({ ...h, own: true })), ...nb.flatMap((n) => n.heads.map((h) => ({ ...h, own: false })))];
  let minSp = Infinity;
  let maxNN = 0;
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
        flags.push({
          code: "MIN_SPACING",
          severity: "error",
          headIds: [h.id, g.id],
          where: { x: (h.x + g.x) / 2, y: (h.y + g.y) / 2 },
          value: d,
          limit: fig.Smin,
          message: `Heads ${fmtM(d)} apart${g.own ? "" : " (across the open edge to the next zone)"}; the minimum is ${fmtM(fig.Smin)}.`,
        });
      }
    }
    if (Number.isFinite(nn)) {
      maxNN = Math.max(maxNN, nn);
      if (nn > fig.Smax + TOL_MM) {
        flags.push({
          code: "MAX_SPACING",
          severity: "error",
          headIds: [h.id],
          where: { x: h.x, y: h.y },
          value: nn,
          limit: fig.Smax,
          message: `The nearest visible head is ${fmtM(nn)} away; the maximum spacing is ${fmtM(fig.Smax)}.`,
        });
      }
    }
  }

  // C5: area per head — warnings only (founder decision 2). Local cells: lattice points given to
  // the nearest visible head (a discrete Voronoi diagram clipped by sight lines).
  const areaM2 = Z.area / 1e6;
  const amaxM2 = fig.Amax / 1e6;
  const perHead = H.length ? areaM2 / H.length : Infinity;
  if (H.length && perHead > amaxM2 + 1e-9) {
    flags.push({
      code: "AREA_ZONE",
      severity: "warning",
      headIds: [],
      where: centroidOf(Z.outer),
      value: perHead,
      limit: amaxM2,
      message: `Zone area per head ${perHead.toFixed(2)} m² is over ${amaxM2} m².`,
    });
  }
  const cellCount = new Array<number>(H.length).fill(0);
  if (H.length) {
    for (const p of lattice) {
      const cand: [number, number][] = [];
      near(p.x, p.y, (h, k) => {
        cand.push([(h.x - p.x) ** 2 + (h.y - p.y) ** 2, k]);
        return false;
      });
      cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, k] of cand)
        if (see(H[k], p)) {
          cellCount[k]++;
          break;
        }
    }
  }
  let maxLocal = 0;
  cellCount.forEach((n, k) => {
    const a = (n * STEP * STEP) / 1e6;
    maxLocal = Math.max(maxLocal, a);
    if (a > amaxM2 + 0.05) {
      flags.push({
        code: "AREA_LOCAL",
        severity: "warning",
        headIds: [H[k].id],
        where: { x: H[k].x, y: H[k].y },
        value: a,
        limit: amaxM2,
        message: `This head's local cell is ≈ ${a.toFixed(1)} m² (over ${amaxM2} m²).`,
      });
    }
  });

  if (!H.length) flags.push({ code: "NO_HEADS", severity: "error", headIds: [], where: centroidOf(Z.outer), message: "No heads in this zone." });
  if (opts.ruleSet && !opts.ruleSet.verified) flags.push({ code: "RULES_UNVERIFIED", severity: "warning", headIds: [], message: "The rule figures are not verified." });

  const errors = flags.filter((f) => f.severity === "error").length;
  return {
    ruleSet: opts.ruleSet ?? null,
    figures: fig,
    headCount: H.length,
    areaM2,
    areaPerHeadM2: perHead,
    maxLocalAreaM2: maxLocal,
    minSpacingM: Number.isFinite(minSp) ? minSp / 1000 : null,
    maxNNSpacingM: H.length > 1 ? maxNN / 1000 : null,
    worstWallDistM: Number.isFinite(worstWall) ? worstWall / 1000 : Infinity,
    minWallDistM: Number.isFinite(minWall) ? minWall / 1000 : null,
    coverage: lattice.length ? coveredCount / lattice.length : 0,
    samples: { lattice: lattice.length, boundary: boundary.length },
    flags,
    errors,
    warnings: flags.length - errors,
    pass: errors === 0,
  };
}

/** 4-connected clusters of uncovered lattice points; an uncovered boundary point joins the nearest cluster within 150 mm, else forms its own. */
function clusterGaps(lat: readonly Sample[], bnd: readonly Sample[]): { at: Pt; n: number; areaM2: number }[] {
  const key = (i: number, j: number) => `${i},${j}`;
  const idx = new Map(lat.map((p, k) => [key(p.gi!, p.gj!), k]));
  const comp = new Array<number>(lat.length).fill(-1);
  const groups: Sample[][] = [];
  for (let k = 0; k < lat.length; k++) {
    if (comp[k] >= 0) continue;
    const g = [k];
    comp[k] = groups.length;
    for (let q = 0; q < g.length; q++) {
      const p = lat[g[q]];
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = idx.get(key(p.gi! + di, p.gj! + dj));
        if (n !== undefined && comp[n] < 0) {
          comp[n] = groups.length;
          g.push(n);
        }
      }
    }
    groups.push(g.map((i) => lat[i]));
  }
  for (const b of bnd) {
    let gi = -1;
    let bd = 150;
    groups.forEach((g, i) => {
      for (const p of g) {
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < bd) {
          bd = d;
          gi = i;
        }
      }
    });
    if (gi >= 0) groups[gi].push(b);
    else groups.push([b]);
  }
  return groups.map((g) => {
    let sx = 0;
    let sy = 0;
    for (const p of g) {
      sx += p.x;
      sy += p.y;
    }
    const cx = sx / g.length;
    const cy = sy / g.length;
    let at: Pt = g[0];
    let bd = Infinity;
    for (const p of g) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) {
        bd = d;
        at = p;
      }
    }
    const nLat = g.filter((p) => p.gi !== undefined).length;
    return { at: { x: at.x, y: at.y }, n: g.length, areaM2: (Math.max(nLat, 1) * STEP * STEP) / 1e6 };
  });
}
