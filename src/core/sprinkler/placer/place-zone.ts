// Story 9.5 (FR73, A8, design §3): NZS 4541 sprinkler head placement.
//
// Frame search × bay decomposition × row sweep; each row is solved by an exact
// 1-D stabbing DP. Every hard constraint is a demand or a DP transition rule:
// there is no repair stage. Typed port of the Story 2.2 spike placer
// (spikes/4541-placement/src/placer.js), plus keep-out avoidance.
//
// Units: mm in and out (zone-local frame inside). Figures in metres / m² as
// the rule set stores them. Pure and deterministic: no Math.random, no Date,
// no caches, no module state.
//
// INDEPENDENCE (AR24): this module never imports the oracle, and the oracle
// never imports this module (ESLint + tests). Composition lives in ../engine.

import {
  SegIndex,
  bbox,
  cleanRing,
  distPointSeg,
  findSelfIntersection,
  isConvex,
  mergeIntervals,
  orientRing,
  pointInRegion,
  pointInRing,
  ringArea,
  ringRowIntervals,
  rotatePt,
  rotateRing,
  simplifyRing,
  subtractIntervals,
  type Box,
  type Interval,
  type Pt,
  type Seg,
} from "./geometry";

export type { Pt } from "./geometry";

// --- Public types ----------------------------------------------------------------------------

/** The rule figures of the zone's hazard class, metres and m². */
export type PlacerFigures = { Amax: number; Smax: number; Smin: number; Wmax: number; Wmin: number };
/** `wall`: the outline (exactly one); `column`: blocks spray, needs Wmin, no Wmax; `shaft`: a real wall. */
export type PlacerBarrier = { kind: "wall" | "column" | "shaft"; ring: readonly Pt[] };
export type PlacerOpenEdge = { a: Pt; b: Pt };
export type PlacerGuide = { a: Pt; b: Pt };
export type PlacerKeepOut = { ring: readonly Pt[]; clearance?: number } | { circle: { x: number; y: number; r: number }; clearance?: number };
/** A declared ceiling grid (design §3.7): tile-centre stops, `preferred` by default. */
export type CeilingGrid = { angleDeg?: number; pitchX: number; pitchY: number; originX?: number; originY?: number; mode: "off" | "preferred" | "required" };

export type PlaceInput = {
  zoneId: string;
  barriers: readonly PlacerBarrier[];
  openEdges?: readonly PlacerOpenEdge[];
  keepOuts?: readonly PlacerKeepOut[];
  pattern?: "rectangular" | "staggered";
  /** Preferred spacing and wall distance, mm (clamped to the rule figures). */
  prefs?: { spacing?: number; wallDist?: number };
  grid?: CeilingGrid | null;
  /** Heads the user fixed: kept as they are and counted for coverage and spacing. */
  locked?: readonly { id: string; x: number; y: number }[];
  /** Heads already placed in zones across open edges (spacing only). */
  neighbourHeads?: readonly Pt[];
  /** Frame override in degrees (rows run along this angle, and also tried turned 90°). */
  frameDeg?: number;
  /**
   * Head lines the designer drew (founder feedback 2026-11-12: heads follow the lights, not an even
   * split). The longest line sets the row direction. A line along the rows fixes a row there; a
   * line across the rows is where heads are preferred along each row it reaches. Rows are added
   * between the lines and the walls as the rules need. Head count still comes first along a row.
   */
  guides?: readonly PlacerGuide[];
};

export type HeadKind = "row" | "gapFill" | "locked";
export type PlacedHead = { id: string; x: number; y: number; kind: HeadKind; rowId?: string };

export type PlaceErrorCode = "INVALID_ZONE" | "NO_ADMISSIBLE_REGION" | "UNCOVERABLE_PIECE";
export type PlaceError = { code: PlaceErrorCode; where: Pt[]; outline?: Pt[]; message: string };

export type PlacementNotes = {
  frameDeg: number;
  decomposition: "none" | "cutH" | "cutV";
  bays: number;
  rows: number;
  exceptions: { gapFill: number };
  unresolved: number;
  h4Violations: number;
  variantsTried: number;
  /** True when the op budget cut the search short (the layout is still checked by the oracle). */
  searchTruncated: boolean;
  /** Operations counted for this zone (deterministic; a perf signal, not a timing). */
  ops: number;
  /** Figures in mm / mm², with Rc. */
  rule: Rule;
  tileAligned?: { onStop: number; total: number; extraHeadsVsUnaligned?: number };
  /** Set when a layout with aligned rows was taken over the fewest-heads layout: the heads it costs. */
  aligned?: { extraHeads: number };
  /** Head lines (guides): how many set a row, how many set positions along rows, how many were not used. */
  guides?: { rows: number; cross: number; ignored: number };
  /** What the zone's options asked for and what the layout achieved (FR74, Story 9.7). */
  preferences: PreferenceReport;
};

/** A preferred figure, mm: as requested, as used (clamped to the rule limits), and as achieved. */
export type PreferenceFigure = { requested: number; used: number; achieved: { min: number; max: number } | null; met: boolean };

export type PreferenceReport = {
  /** Along-row gaps between neighbouring heads of the same row run. */
  spacing?: PreferenceFigure;
  /** Along-row distance from each row run's end heads to the wall at the run's ends. */
  wallDist?: PreferenceFigure;
  pattern: { requested: "rectangular" | "staggered"; extraHeadsVsRectangular?: number };
  /** One plain sentence per preference that could not be met (shown in the zone report). */
  unmet: string[];
};

export type PlaceResult =
  | { ok: true; heads: PlacedHead[]; notes: PlacementNotes }
  | { ok: false; heads: PlacedHead[]; notes: PlacementNotes | null; error: PlaceError };

export type PlaceOptions = {
  idPrefix?: string;
  /**
   * Deterministic search budget in counted operations (DP transitions, sight-line edge tests).
   * Once spent, the remaining lower-priority variants are skipped and the best layout so far is
   * returned with `searchTruncated` (design §6). Never a wall-clock limit.
   */
  opBudget?: number;
  /**
   * Prefer a layout whose rows line up across the zone over the fewest-heads layout, when it costs
   * one head (or about 10 %) and clearly tidies the layout. Default true; false gives the
   * fewest-heads layout (the Story 2.2 spike's behaviour).
   */
  alignRows?: boolean;
};

/** Default per-zone budget (design §6: 50 M simple operations). */
export const DEFAULT_OP_BUDGET = 50_000_000;

// --- Constants -------------------------------------------------------------------------------

const MU_COV = 75; // reach margin for sampled coverage demands (100 mm lattice: any point is ≤71 mm from a sample)
const MU_WALL = 30; // reach margin for wall samples (50 mm step)
const TOL = 0.5; // tolerance on exact analytic limits (the oracle allows 1 mm)
const LAT = 100; // coverage lattice step
const BND = 50; // boundary sample step
const CSTEP = 50; // DP candidate step along a row
const NUDGE = 0.5; // boundary samples are tested for visibility from 0.5 mm inside the wall
const MAX_GAPFILL = 3;
/** Smaller than the oracle's 50 mm so the placer is never the more generous of the two. */
const TRACE_TOL = 40;
/** Distances tried between a moved row and a column band. */
const COL_GAP = [300, 700];
/** Smallest ceiling-grid pitch accepted (tile stops are DP candidates). */
const MIN_TILE_PITCH = 100;
/** A preferred figure counts as met within max(150 mm, 5 %) (the 50 mm candidate step plus fit). */
/** How many heads over the fewest a layout with aligned rows may use (one, or about 10 %). */
const alignAllowance = (n: number) => Math.max(1, Math.round(0.1 * n));
/** Row and column lines an aligned layout must save for each extra head. */
const ALIGN_GAIN = 2;
/** Heads within this of one line (mm) are on the same row or column line. */
const LINE_TOL = 100;
/** A guide counts as along (or across) the rows within this angle. */
const GUIDE_ANGLE = (10 * Math.PI) / 180;
/** Guides shorter than this are ignored (a stray click). */
const MIN_GUIDE = 100;
/** How far past a rule limit a guide may be drawn and still be moved back onto it. */
const GUIDE_SNAP = 50;
/** A cross guide reaches rows this far beyond its ends. */
const CROSS_REACH = 600;
/** DP cost of a head off every cross guide of its row (far above any spacing cost; below a head). */
const OFF_CROSS = 50;
const prefTol = (v: number) => Math.max(150, 0.05 * v);

// --- Internal types --------------------------------------------------------------------------

type Rule = { Amax: number; Smax: number; Smin: number; Wmax: number; Wmin: number; Rc: number };
type Prefs = { spacing: number | null; wallDist: number | null };
type Pattern = "rectangular" | "staggered";

/** t: 0 lattice, 1 boundary, 2 wall, 3 synthetic band corner. (vx, vy): the sight-line probe. */
type Sample = { t: 0 | 1 | 2 | 3; x: number; y: number; vx: number; vy: number; ix?: number; iy?: number; nx?: number; ny?: number; c?: number; sh?: { y: number; iv: Interval[] }[] };
type Owned = { s: Sample; bay?: number; inside: boolean };
type FHead = { x: number; y: number; bay: number; row?: number | "g"; kind?: HeadKind; id?: string; wx?: number; wy?: number };
type Cand = { x: number; y: number; run: number; stop: boolean; seg: number };
type DemandRange = [number, number] & { shadowed?: boolean };
type LocalKeepOut = { ring: Pt[] | null; circle: { x: number; y: number; r: number } | null; clearance: number };

type Prep = {
  ox: number;
  oy: number;
  outer: Pt[];
  holes: Pt[][];
  holeColumn: boolean[];
  outerOpen: boolean[];
  outerWorld: Pt[];
  locked: { x: number; y: number; id: string; wx: number; wy: number }[];
  neighbours: Pt[];
  keepOuts: LocalKeepOut[];
  gridLocal: (CeilingGrid & { originX: number; originY: number }) | null;
  guides: { a: Pt; b: Pt }[];
};

type GridF = { ox: number; oy: number; px: number; py: number; mode: CeilingGrid["mode"] };

type Frame = {
  theta: number;
  outer: Pt[];
  holes: Pt[][];
  holeColumn: boolean[];
  segs: Seg[];
  idx: SegIndex;
  bb: Box;
  lat: Sample[];
  bnd: Sample[];
  wall: Sample[];
  simplified: boolean;
  douter: Pt[];
  dholes: Pt[][];
  grid: GridF | null;
  keepOuts: LocalKeepOut[];
  locked: FHead[];
  neighbours: FHead[];
  /** Guides along the rows (a fixed row at y over [x0, x1]) and across them (preferred x over [y0, y1]). */
  rowGuides: { y: number; x0: number; x1: number }[];
  crossGuides: { x: number; y0: number; y1: number }[];
  /** Sight-line query half-width: every demand window lies within it (Rc + margin). */
  reach: number;
  /** The zone's deterministic operation counter (design §6), shared by every frame. */
  ops: Ops;
};

/** `armed`: a complete layout exists, so the budget may stop the search (never before the first). */
type Ops = { n: number; budget: number; truncated: boolean; armed: boolean };

type Bay = { id: number; ring: Pt[]; holes: Pt[][]; bb: Box; area: number; convex: boolean; fast: boolean };
type Decomposition = { name: "none" | "cutH" | "cutV"; bays: Bay[] };
type BaySamples = { lat: Owned[]; bnd: Owned[]; wall: Owned[] };
type RowInfo = { y: number; d: number; Srect: number; S: number; runs: Interval[]; clean: Interval[]; base: Cand[] };
type BayCtx = { R: Rule; prefs: Prefs; pattern: Pattern; placedCov: FHead[]; placedSp: FHead[]; alignXs: number[]; alignRows: boolean };
type RowsResult = { heads: FHead[]; rest: Owned[]; unresolved: Sample[]; gapFill: number; cost: number; rows: number; sawShadow: boolean; alignedExtra?: number };
type DecResult = { heads: FHead[]; unresolved: Sample[]; gapFill: number; cost: number; h4: FHead[]; rowCount: number; alignedExtra: number };

// --- Public entry point ----------------------------------------------------------------------

/** Places the heads of one zone. Pure and deterministic; never throws for bad geometry (typed errors). */
export function placeZone(input: PlaceInput, figures: PlacerFigures, opts: PlaceOptions = {}): PlaceResult {
  return place(input, figures, opts, false);
}

function place(input: PlaceInput, hz: PlacerFigures, opts: PlaceOptions, noDelta: boolean): PlaceResult {
  const R: Rule = { Amax: hz.Amax * 1e6, Smax: hz.Smax * 1000, Smin: hz.Smin * 1000, Wmax: hz.Wmax * 1000, Wmin: hz.Wmin * 1000, Rc: 0 };
  R.Rc = 0.5 * Math.sqrt(R.Smax ** 2 + (R.Amax / R.Smax) ** 2);

  const prep = prepare(input);
  if ("error" in prep) return { ok: false, heads: [], notes: null, error: prep.error };

  const prefs: Prefs = {
    spacing: input.prefs?.spacing ? clamp(input.prefs.spacing, R.Smin, R.Smax) : null,
    wallDist: input.prefs?.wallDist ? clamp(input.prefs.wallDist, R.Wmin + 1, R.Wmax) : null,
  };
  const pattern: Pattern = input.pattern === "staggered" ? "staggered" : "rectangular";
  const grid = input.grid && input.grid.mode !== "off" ? input.grid : null;

  // Admissible region: some point must keep Wmin from every wall.
  if (!admissibleProbe(prep, R)) {
    return fail(
      "NO_ADMISSIBLE_REGION",
      prep.outerWorld,
      `No point in this zone is ${R.Wmin} mm or more from every wall (zone narrower than 2 × Wmin = ${2 * R.Wmin} mm). No heads placed.`,
      centroidOf(prep.outerWorld),
    );
  }

  const alignRows = opts.alignRows !== false;
  const frames = frameCandidates(prep, grid, input.frameDeg);
  const ops: Ops = { n: 0, budget: opts.opBudget ?? DEFAULT_OP_BUDGET, truncated: false, armed: false };
  type Candidate = DecResult & { score: number[]; frame: Frame; decName: Decomposition["name"]; bays: Bay[] };
  let best: Candidate | null = null;
  // Complete layouts, kept for the aligned-rows choice below.
  const complete: Candidate[] = [];
  let tried = 0;
  // Variants run in priority order (frame peaks, then none / cutH / cutV); the budget only ever
  // skips the tail of that order, so the answer stays deterministic.
  search: for (let fi = 0; fi < frames.length; fi++) {
    if (best && ops.n > ops.budget) {
      ops.truncated = true;
      break;
    }
    const F = buildFrame(prep, frames[fi], R, grid, ops);
    const decs = decompositions(F);
    for (let di = 0; di < decs.length; di++) {
      if (best && ops.n > ops.budget) {
        ops.truncated = true;
        break search;
      }
      // Exact bound: once a layout resolves everything with n heads, a decomposition that needs more
      // than n heads can never win (heads rank right after unresolved), so its sweeps stop early.
      ops.armed = best != null;
      // (the aligned-rows choice may take a layout with a few more heads, so the bound leaves room for it)
      // Only a decomposition with fewer bays than the best so far can be the tidier one, so only it
      // gets the room (the others keep the exact bound, and the search stays as fast as before).
      const room = alignRows && best && decs[di].bays.length < best.bays.length ? alignAllowance(best.heads.length) : 0;
      const cap = best && best.score[0] === 0 ? best.heads.length + room : null;
      const res = layoutDecomposition(F, decs[di], R, prefs, pattern, cap, alignRows);
      tried++;
      const score = [res.unresolved.length + res.h4.length, res.heads.length, res.gapFill, res.cost, fi, di];
      const cand: Candidate = { ...res, score, frame: F, decName: decs[di].name, bays: decs[di].bays };
      if (score[0] === 0) complete.push(cand);
      if (!best || lexLess(score, best.score)) best = cand;
    }
  }
  if (!best) throw new Error("placeZone: no frame candidates");

  // Aligned rows (founder feedback 2026-11-12: a layout should look like a person placed it). The
  // fewest-heads layout can leave the heads of neighbouring bays out of step. A complete layout with
  // a few more heads (alignAllowance) replaces it when its heads sit on clearly fewer row and column
  // lines: at least ALIGN_GAIN fewer lines for each extra head.
  let alignedExtra = 0;
  if (alignRows && best.score[0] === 0) {
    const fewest: Candidate = best;
    const n = fewest.heads.length;
    const base = lineCount(fewest.heads);
    // the fewest heads any complete layout needed (a bay may already have taken an aligned layout)
    const least = Math.min(...complete.map((c) => c.heads.length - c.alignedExtra));
    let pick = fewest;
    let pickLines = base;
    for (const c of complete) {
      const extra = c.heads.length - n;
      if (extra <= 0 || extra > alignAllowance(n)) continue;
      const l = lineCount(c.heads);
      if (base - l < ALIGN_GAIN * extra) continue;
      if (l < pickLines || (l === pickLines && c.heads.length < pick.heads.length)) {
        pick = c;
        pickLines = l;
      }
    }
    alignedExtra = pick.heads.length - least;
    best = pick;
    // An aligned layout must not open the rows up: when a row's next row straight across is more
    // than Smax away (the oracle's nearest-peer check cannot see that), the fewest-heads search is
    // used as it stands.
    if (rowsTooFarApart(best.frame, best.heads, R)) return place(input, hz, { ...opts, alignRows: false }, noDelta);
  }

  // Back to world coordinates.
  const F = best.frame;
  const toWorld = (p: Pt): Pt => {
    const q = rotatePt(p, F.theta);
    return { x: q.x + prep.ox, y: q.y + prep.oy };
  };
  const heads: PlacedHead[] = [];
  const counters = new Map<string, number>();
  for (const h of best.heads) {
    if (h.kind === "locked") {
      heads.push({ id: h.id!, x: h.wx!, y: h.wy!, kind: "locked" });
      continue;
    }
    const w = toWorld(h);
    const key = `${h.bay}:${h.row}`;
    const k = counters.get(key) ?? 0;
    counters.set(key, k + 1);
    heads.push({ id: `${opts.idPrefix ?? ""}${input.zoneId || "Z"}:${key}:${k}`, x: round3(w.x), y: round3(w.y), kind: h.kind ?? "row", rowId: key });
  }
  const unresolvedWorld = best.unresolved.map((s) => toWorld(s));
  const notes: PlacementNotes = {
    frameDeg: round3((F.theta * 180) / Math.PI),
    decomposition: best.decName,
    bays: best.bays.length,
    rows: best.rowCount,
    exceptions: { gapFill: best.gapFill },
    unresolved: unresolvedWorld.length,
    h4Violations: best.h4.length,
    variantsTried: tried,
    searchTruncated: ops.truncated,
    ops: ops.n,
    rule: R,
    preferences: { pattern: { requested: pattern }, unmet: [] },
    ...(alignedExtra > 0 ? { aligned: { extraHeads: alignedExtra } } : {}),
  };
  const pr = notes.preferences;
  if (input.prefs?.spacing || input.prefs?.wallDist) {
    const m = rowMeasures(best.heads, F);
    if (input.prefs.spacing && prefs.spacing) pr.spacing = prefFigure(input.prefs.spacing, prefs.spacing, m.gaps);
    if (input.prefs.wallDist && prefs.wallDist) pr.wallDist = prefFigure(input.prefs.wallDist, prefs.wallDist, m.ends);
    for (const [name, f] of [
      ["spacing", pr.spacing],
      ["wall distance", pr.wallDist],
    ] as const) {
      if (!f) continue;
      if (f.used !== f.requested) pr.unmet.push(`Preferred ${name} ${f.requested} mm is outside the rule limits; ${f.used} mm was used.`);
      if (!f.met && f.achieved) pr.unmet.push(`Preferred ${name} ${f.used} mm could not be kept everywhere (head count comes first): ${f.achieved.min}–${f.achieved.max} mm placed.`);
    }
  }
  if (pattern === "staggered" && !noDelta) {
    const rect = place({ ...input, pattern: "rectangular" }, hz, opts, true);
    if (rect.ok) {
      pr.pattern.extraHeadsVsRectangular = heads.length - rect.heads.length;
      if (pr.pattern.extraHeadsVsRectangular > 0) pr.unmet.push(`Staggered layout uses ${pr.pattern.extraHeadsVsRectangular} more head(s) than rectangular.`);
    }
  }
  if (grid) {
    notes.tileAligned = { onStop: heads.filter((h) => onTileStop(h, grid)).length, total: heads.length };
    if (grid.mode === "required" && !noDelta) {
      const free = place({ ...input, grid: null }, hz, opts, true);
      if (free.ok) notes.tileAligned.extraHeadsVsUnaligned = heads.length - free.heads.length;
    }
    const t = notes.tileAligned;
    if (t.extraHeadsVsUnaligned) pr.unmet.push(`Tile alignment (required) uses ${t.extraHeadsVsUnaligned} more head(s) than an unaligned layout.`);
    if (grid.mode === "preferred" && t.onStop < t.total) pr.unmet.push(`${t.total - t.onStop} of ${t.total} heads are off tile centres (head count comes first).`);
  }
  if (input.guides?.length) {
    const ignored = input.guides.length - F.rowGuides.length - F.crossGuides.length;
    notes.guides = { rows: F.rowGuides.length, cross: F.crossGuides.length, ignored };
    if (ignored > 0) pr.unmet.push(`${ignored} head line(s) were not used (too short, or neither along nor across the rows).`);
  }
  if (unresolvedWorld.length) {
    return {
      ok: false,
      heads,
      notes,
      error: {
        code: "UNCOVERABLE_PIECE",
        where: unresolvedWorld.slice(0, 50),
        message: `${unresolvedWorld.length} sample point(s) could not be reached by any admissible head position under the hard constraints.`,
      },
    };
  }
  return { ok: true, heads, notes };
}

/** The tile-centre stop nearest to (x, y), world mm. */
export function tileStopAt(grid: CeilingGrid, x: number, y: number): Pt {
  const a = ((grid.angleDeg ?? 0) * Math.PI) / 180;
  const p = rotatePt({ x: x - (grid.originX ?? 0), y: y - (grid.originY ?? 0) }, -a);
  const i = Math.round(p.x / grid.pitchX - 0.5);
  const j = Math.round(p.y / grid.pitchY - 0.5);
  const q = rotatePt({ x: (i + 0.5) * grid.pitchX, y: (j + 0.5) * grid.pitchY }, a);
  return { x: q.x + (grid.originX ?? 0), y: q.y + (grid.originY ?? 0) };
}

function onTileStop(h: Pt, grid: CeilingGrid): boolean {
  const s = tileStopAt(grid, h.x, h.y);
  return Math.hypot(s.x - h.x, s.y - h.y) < 1.5;
}

// --- Preparation (§3.6): zone-local mm, clean, orient, validate --------------------------------

function prepare(input: PlaceInput): Prep | { error: PlaceError } {
  const walls = input.barriers.filter((b) => b.kind === "wall");
  const raw = (walls[0]?.ring ?? []).map((p) => ({ x: +p.x, y: +p.y }));
  if (walls.length !== 1) return { error: { code: "INVALID_ZONE", where: raw, message: "A zone has exactly one outline (wall barrier)." } };
  if (raw.length < 3 || raw.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { error: { code: "INVALID_ZONE", where: raw, message: "Zone outline needs at least 3 valid points." } };
  }
  const bb = bbox(raw);
  const ox = bb.x0;
  const oy = bb.y0;
  const loc = (p: Pt): Pt => ({ x: +p.x - ox, y: +p.y - oy });
  const world = (p: Pt): Pt => ({ x: p.x + ox, y: p.y + oy });
  const outer = orientRing(cleanRing(raw.map(loc)), true);
  // Holes are tagged column or shaft (founder decision 4). Columns block spray and need Wmin but
  // carry no Wmax and never cut bays; shafts and voids are real walls.
  const holes: Pt[][] = [];
  const holeColumn: boolean[] = [];
  for (const b of input.barriers) {
    if (b.kind === "wall") continue;
    if (b.ring.some((p) => !Number.isFinite(+p.x) || !Number.isFinite(+p.y))) {
      return { error: { code: "INVALID_ZONE", where: raw, message: "A hole has an invalid point." } };
    }
    const r = orientRing(cleanRing(b.ring.map(loc)), false);
    if (r.length < 3) continue;
    holes.push(r);
    holeColumn.push(b.kind === "column");
  }
  const si = outer.length >= 3 ? findSelfIntersection([outer, ...holes]) : null;
  if (si) {
    return { error: { code: "INVALID_ZONE", where: [world(si)], outline: raw, message: "Zone outline crosses itself (or a hole crosses the outline) at the marked point." } };
  }
  if (outer.length < 3 || Math.abs(ringArea(outer)) < 1e4) {
    return { error: { code: "INVALID_ZONE", where: raw, message: "Zone area is zero or too small." } };
  }
  for (const h of holes) {
    if (!h.every((p) => pointInRing(p, outer))) {
      return { error: { code: "INVALID_ZONE", where: h.map(world), message: "A hole (column or shaft) lies outside the zone outline." } };
    }
  }
  const open = (input.openEdges ?? []).map((e) => ({ a: loc(e.a), b: loc(e.b) }));
  const outerOpen = outer.map((p, i) => {
    const q = outer[(i + 1) % outer.length];
    return open.some((e) => distPointSeg(p, e.a, e.b) < 2 && distPointSeg(q, e.a, e.b) < 2);
  });
  const g = input.grid;
  if (g && g.mode !== "off" && !(g.pitchX >= MIN_TILE_PITCH && g.pitchY >= MIN_TILE_PITCH && g.pitchX <= 1e6 && g.pitchY <= 1e6)) {
    return { error: { code: "INVALID_ZONE", where: raw, message: `Ceiling grid pitch must be between ${MIN_TILE_PITCH} mm and 1 km.` } };
  }
  const keepOuts: LocalKeepOut[] = (input.keepOuts ?? []).map((k) =>
    "circle" in k
      ? { ring: null, circle: { ...loc(k.circle), r: k.circle.r }, clearance: k.clearance ?? 0 }
      : { ring: k.ring.map(loc), circle: null, clearance: k.clearance ?? 0 },
  );
  return {
    ox,
    oy,
    outer,
    holes,
    holeColumn,
    outerOpen,
    outerWorld: raw,
    locked: (input.locked ?? []).map((h) => ({ ...loc(h), id: h.id, wx: h.x, wy: h.y })),
    neighbours: (input.neighbourHeads ?? []).map(loc),
    keepOuts,
    gridLocal: input.grid ? { ...input.grid, originX: (input.grid.originX ?? 0) - ox, originY: (input.grid.originY ?? 0) - oy } : null,
    guides: (input.guides ?? [])
      .filter((g) => [g.a.x, g.a.y, g.b.x, g.b.y].every((v) => Number.isFinite(+v)) && Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) >= MIN_GUIDE)
      .map((g) => ({ a: loc(g.a), b: loc(g.b) })),
  };
}

// Sight lines from samples near a wall are tested from a probe pushed TRACE_TOL into the room.
function pushProbe(v: Pt, nx: number, ny: number, a: Pt, outer: Pt[], holes: Pt[][], idx: SegIndex): Pt {
  const d0 = Math.abs((v.x - a.x) * nx + (v.y - a.y) * ny);
  for (let t = TRACE_TOL - d0; t > 0.5; t /= 2) {
    const q = { x: v.x + nx * t, y: v.y + ny * t };
    if (pointInRegion(q, outer, holes) && idx.visible(v, q)) return q;
  }
  return v;
}

function latticeProbe(p: Pt, outer: Pt[], holes: Pt[][], idx: SegIndex): Pt {
  let best: Seg | null = null;
  let bd = TRACE_TOL;
  idx.forBox(p.x - TRACE_TOL, p.y - TRACE_TOL, p.x + TRACE_TOL, p.y + TRACE_TOL, (s) => {
    const d = distPointSeg(p, s.a, s.b);
    if (d < bd) {
      bd = d;
      best = s;
    }
  });
  const b = best as Seg | null;
  return b ? pushProbe(p, b.nx, b.ny, b.a, outer, holes, idx) : p;
}

function barrierSegs(outer: Pt[], holes: Pt[][], outerOpen: boolean[]): Seg[] {
  const segs: Seg[] = [];
  const add = (a: Pt, b: Pt) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-9) return;
    const nx = -(b.y - a.y) / L;
    const ny = (b.x - a.x) / L;
    segs.push({ a, b, nx, ny, c: nx * a.x + ny * a.y });
  };
  outer.forEach((p, i) => {
    if (!outerOpen[i]) add(p, outer[(i + 1) % outer.length]);
  });
  for (const h of holes) h.forEach((p, i) => add(p, h[(i + 1) % h.length]));
  return segs;
}

function admissibleProbe(prep: Prep, R: Rule): boolean {
  const idx = new SegIndex(barrierSegs(prep.outer, prep.holes, prep.outerOpen));
  const need = R.Wmin + 1;
  const ok = (p: Pt) => pointInRegion(p, prep.outer, prep.holes) && idx.clearance(p, need + 1) >= need;
  const bb = bbox(prep.outer);
  for (let y = bb.y0 + 50; y < bb.y1; y += 100) for (let x = bb.x0 + 50; x < bb.x1; x += 100) if (ok({ x, y })) return true;
  // fine probe along every wall, offset inward by the clearance (catches slim zones)
  for (const r of [prep.outer, ...prep.holes]) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / L;
      const ny = (b.x - a.x) / L;
      for (let s = 0; s <= L; s += 20) {
        const p = { x: a.x + ((b.x - a.x) * s) / L + nx * (need + 0.5), y: a.y + ((b.y - a.y) * s) / L + ny * (need + 0.5) };
        if (ok(p)) return true;
      }
    }
  }
  return false;
}

// --- Frames (§3.2): length-weighted edge-angle histogram mod 90°, top two peaks plus 0° ----------
// Rows run along the frame x axis, so each angle is also tried turned by 90°.

function frameCandidates(prep: Prep, grid: CeilingGrid | null, override: number | undefined): number[] {
  let base: number[];
  if (override != null) base = [(override * Math.PI) / 180];
  else if (grid) base = [((grid.angleDeg ?? 0) * Math.PI) / 180];
  else {
    const edges: { a: number; L: number }[] = [];
    for (const r of [prep.outer, ...prep.holes])
      r.forEach((p, i) => {
        const q = r[(i + 1) % r.length];
        const L = Math.hypot(q.x - p.x, q.y - p.y);
        let a = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
        a = ((a % 90) + 90) % 90;
        edges.push({ a, L });
      });
    const bins = new Float64Array(360);
    for (const e of edges) bins[Math.floor(e.a / 0.25) % 360] += e.L;
    const sm = new Float64Array(360);
    for (let i = 0; i < 360; i++) for (let k = -6; k <= 6; k++) sm[i] += bins[(i + k + 360) % 360];
    let p1 = 0;
    for (let i = 1; i < 360; i++) if (sm[i] > sm[p1]) p1 = i;
    let p2 = -1;
    for (let i = 0; i < 360; i++) {
      const dd = Math.min(Math.abs(i - p1), 360 - Math.abs(i - p1));
      if (dd <= 12 || sm[i] < 0.15 * sm[p1]) continue;
      if (p2 < 0 || sm[i] > sm[p2]) p2 = i;
    }
    const peakAngle = (pi: number) => {
      const c = pi * 0.25 + 0.125;
      let sx = 0;
      let sy = 0;
      for (const e of edges) {
        let d = Math.abs(e.a - c);
        d = Math.min(d, 90 - d);
        if (d <= 1.5) {
          sx += e.L * Math.cos((e.a * 4 * Math.PI) / 180);
          sy += e.L * Math.sin((e.a * 4 * Math.PI) / 180);
        }
      }
      let a = (Math.atan2(sy, sx) * 180) / Math.PI / 4;
      if (a < 0) a += 90;
      return a;
    };
    const list = [peakAngle(p1)];
    if (p2 >= 0) list.push(peakAngle(p2));
    // 0° (the drawing's axes) is a fallback for outlines the peaks do not explain (curves, many
    // angles). When the peaks carry >= 90 % of the edge length, rows on 0° run across every wall and
    // cannot beat the peak frames, so it is not tried (Story 9.6, D2).
    const total = edges.reduce((t, e) => t + e.L, 0);
    const near = (e: { a: number }, pi: number) => {
      const d = Math.abs(e.a - (pi * 0.25 + 0.125));
      return Math.min(d, 90 - d) <= 1.75;
    };
    const explained = edges.reduce((t, e) => t + (near(e, p1) || (p2 >= 0 && near(e, p2)) ? e.L : 0), 0);
    if (!list.some((a) => Math.min(a, 90 - a) < 1) && explained < 0.9 * total) list.push(0);
    base = list.map((a) => ((Math.min(a, 90 - a) < 1e-6 ? 0 : a) * Math.PI) / 180);
  }
  const out: number[] = [];
  for (const a of base)
    for (const t of [a, a + Math.PI / 2]) {
      if (!out.some((b) => Math.abs(b - t) < 1e-9)) out.push(t);
    }
  if (!prep.guides.length) return out;
  // Head lines: rows run along the longest line. A frame the zone already offers is used when it
  // is within 1° (clean numbers). With a ceiling grid or a frame override the frame must stay on
  // their axes: the nearest axis is used when the line is within GUIDE_ANGLE of it, and the lines
  // are ignored otherwise.
  const longest = prep.guides.reduce((m, g) => (lenOf(g) > lenOf(m) ? g : m));
  const ga = Math.atan2(longest.b.y - longest.a.y, longest.b.x - longest.a.x);
  let near = out[0];
  for (const t of out) if (angleApart(t, ga) < angleApart(near, ga)) near = t;
  const fixed = override != null || grid != null;
  if (angleApart(near, ga) <= (fixed ? GUIDE_ANGLE : Math.PI / 180)) return [near];
  return fixed ? out : [((ga % Math.PI) + Math.PI) % Math.PI];
}

/**
 * Is some row head's next row, straight across the rows and before any wall, more than Smax away?
 * Rows are the placer's own (bay and row index); gap-fill and locked heads are not rows.
 */
function rowsTooFarApart(F: Frame, heads: readonly FHead[], R: Rule): boolean {
  const rows = new Map<string, { y: number; x0: number; x1: number }>();
  for (const h of heads) {
    if (h.kind === "locked" || typeof h.row !== "number") continue;
    const key = `${h.bay}:${h.row}`;
    const r = rows.get(key);
    if (!r) rows.set(key, { y: h.y, x0: h.x, x1: h.x });
    else {
      r.x0 = Math.min(r.x0, h.x);
      r.x1 = Math.max(r.x1, h.x);
    }
  }
  for (const h of heads) {
    if (h.kind === "locked" || typeof h.row !== "number") continue;
    const own = `${h.bay}:${h.row}`;
    for (const side of [1, -1]) {
      let best = Infinity;
      for (const [key, r] of rows) {
        if (key === own) continue;
        const d = (r.y - h.y) * side;
        if (d <= 1 || d >= best || h.x < r.x0 - R.Smax / 2 || h.x > r.x1 + R.Smax / 2) continue;
        best = d;
      }
      if (Number.isFinite(best) && best > R.Smax + 3 && F.idx.visible(h, { x: h.x, y: h.y + side * best })) return true;
    }
  }
  return false;
}

/** How many row lines plus column lines the placed heads sit on (frame coordinates; fewer is tidier). */
function lineCount(heads: readonly FHead[]): number {
  const count = (vs: number[]) => {
    vs.sort((a, b) => a - b);
    let n = 0;
    let last = -Infinity;
    for (const v of vs) {
      if (v - last > LINE_TOL) n++;
      last = v;
    }
    return n;
  };
  const own = heads.filter((h) => h.kind !== "locked");
  return count(own.map((h) => h.y)) + count(own.map((h) => h.x));
}

const lenOf = (g: { a: Pt; b: Pt }) => Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
/** The angle between two undirected lines, 0 … π/2. */
function angleApart(a: number, b: number): number {
  const d = Math.abs((((a - b) % Math.PI) + Math.PI) % Math.PI);
  return Math.min(d, Math.PI - d);
}

// --- Frame context: rotated geometry, barrier index, samples -----------------------------------

function buildFrame(prep: Prep, theta: number, R: Rule, grid: CeilingGrid | null, ops: Ops): Frame {
  const rot = -theta;
  const outer = rotateRing(prep.outer, rot);
  const holes = prep.holes.map((h) => rotateRing(h, rot));
  const segs = barrierSegs(outer, holes, prep.outerOpen);
  const idx = new SegIndex(segs);
  const bb = bbox(outer);

  const lat: Sample[] = [];
  const ix0 = Math.ceil((bb.x0 - 50) / LAT);
  const ix1 = Math.floor((bb.x1 - 50) / LAT);
  const iy0 = Math.ceil((bb.y0 - 50) / LAT);
  const iy1 = Math.floor((bb.y1 - 50) / LAT);
  for (let iy = iy0; iy <= iy1; iy++) {
    const y = 50 + iy * LAT;
    const runs = subtractIntervals(
      ringRowIntervals(outer, y),
      holes.flatMap((h) => ringRowIntervals(h, y)),
    );
    for (const [a, b] of runs) {
      for (let ix = Math.max(ix0, Math.ceil((a - 50) / LAT)); ix <= ix1 && 50 + ix * LAT <= b; ix++) {
        const x = 50 + ix * LAT;
        const lp = latticeProbe({ x, y }, outer, holes, idx);
        lat.push({ t: 0, x, y, vx: lp.x, vy: lp.y, ix, iy });
      }
    }
  }
  const bnd: Sample[] = [];
  const wall: Sample[] = [];
  // columns: block sight, need Wmin, but no Wmax rule (founder decision 2026-10-17)
  const rings: { r: Pt[]; open: boolean[] | null; column: boolean }[] = [
    { r: outer, open: prep.outerOpen, column: false },
    ...holes.map((h, i) => ({ r: h, open: null, column: prep.holeColumn[i] })),
  ];
  for (const { r, open, column } of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-6) continue;
      const dx = (b.x - a.x) / L;
      const dy = (b.y - a.y) / L;
      const nx = -dy;
      const ny = dx; // left normal points into the region
      const n = Math.max(1, Math.ceil(L / BND));
      const isWall = !(open && open[i]) && !column;
      for (let k = 0; k <= n; k++) {
        const s = (k * L) / n; // includes both vertices
        const x = a.x + dx * s;
        const y = a.y + dy * s;
        // probe point just inside the room (tighter than the oracle's, so the placer is never more
        // generous about sight lines in corner pockets); shrinks in acute corners
        let v: Pt | null = null;
        const end = k === 0 ? 1 : k === n ? -1 : 0;
        for (let dl = NUDGE; dl > 1e-4; dl /= 3) {
          const q = { x: x + nx * dl + dx * end * dl * 2, y: y + ny * dl + dy * end * dl * 2 };
          if (pointInRegion(q, outer, holes)) {
            v = q;
            break;
          }
          const tws = end ? [end] : [1, -1];
          for (const tw of tws) {
            for (const [fn, fa] of [
              [0.25, 1],
              [0.05, 2],
            ]) {
              const q2 = { x: x + nx * dl * fn + dx * tw * dl * fa, y: y + ny * dl * fn + dy * tw * dl * fa };
              if (pointInRegion(q2, outer, holes)) {
                v = q2;
                break;
              }
            }
            if (v) break;
          }
          if (v) break;
        }
        if (!v) v = { x, y }; // sliver corner: test sight lines from the boundary point itself
        v = pushProbe(v, nx, ny, a, outer, holes, idx);
        bnd.push({ t: 1, x, y, vx: v.x, vy: v.y });
        if (isWall) wall.push({ t: 2, x, y, vx: v.x, vy: v.y, nx, ny, c: nx * a.x + ny * a.y });
      }
    }
  }

  // Decomposition geometry: noisy outlines are simplified for bay cutting only.
  const simplified = outer.length > 40;
  const douter = simplified ? orientRing(simplifyRing(outer, 40), true) : outer;
  const dholes = holes.map((h) => (h.length > 40 ? orientRing(simplifyRing(h, 40), false) : h));

  const rotP = (p: Pt) => rotatePt(p, rot);
  let gridF: GridF | null = null;
  if (grid && prep.gridLocal) {
    const o = rotP({ x: prep.gridLocal.originX, y: prep.gridLocal.originY });
    // frame is the grid angle or the grid angle + 90° (pitches swap; tile centres are symmetric)
    const rel = Math.abs((((theta - ((grid.angleDeg ?? 0) * Math.PI) / 180) % Math.PI) + Math.PI) % Math.PI);
    const turned = Math.abs(rel - Math.PI / 2) < 1e-6;
    gridF = { ox: o.x, oy: o.y, px: turned ? grid.pitchY : grid.pitchX, py: turned ? grid.pitchX : grid.pitchY, mode: grid.mode };
  }
  const keepOuts = prep.keepOuts.map((k) => ({
    ring: k.ring ? rotateRing(k.ring, rot) : null,
    circle: k.circle ? { ...rotP(k.circle), r: k.circle.r } : null,
    clearance: k.clearance,
  }));
  const rowGuides: Frame["rowGuides"] = [];
  const crossGuides: Frame["crossGuides"] = [];
  for (const g of prep.guides) {
    const a = rotP(g.a);
    const b = rotP(g.b);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (angleApart(ang, 0) <= GUIDE_ANGLE) rowGuides.push({ y: (a.y + b.y) / 2, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
    else if (angleApart(ang, Math.PI / 2) <= GUIDE_ANGLE) crossGuides.push({ x: (a.x + b.x) / 2, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
  }
  return {
    theta,
    outer,
    holes,
    holeColumn: prep.holeColumn,
    rowGuides,
    crossGuides,
    segs,
    idx,
    bb,
    lat,
    bnd,
    wall,
    simplified,
    douter,
    dholes,
    grid: gridF,
    keepOuts,
    locked: prep.locked.map((h) => ({ ...rotP(h), id: h.id, wx: h.wx, wy: h.wy, kind: "locked" as const, bay: -1 })),
    neighbours: prep.neighbours.map((h) => ({ ...rotP(h), bay: -2 })),
    reach: R.Rc + 100,
    ops,
  };
}

/** A head at p would sit in a keep-out or its clearance (with a margin over the oracle's limit). */
function inKeepOut(F: Frame, p: Pt): boolean {
  for (const k of F.keepOuts) {
    if (k.circle) {
      if (Math.hypot(p.x - k.circle.x, p.y - k.circle.y) < k.circle.r + k.clearance + TOL) return true;
    } else if (k.ring) {
      if (pointInRing(p, k.ring)) return true;
      for (let i = 0; i < k.ring.length; i++) if (distPointSeg(p, k.ring[i], k.ring[(i + 1) % k.ring.length]) < k.clearance + TOL) return true;
    }
  }
  return false;
}

// --- Bay decomposition (§3.3): none | cutH | cutV ------------------------------------------------
// Cuts are trapezoid slabs at the vertices of the outline and of large holes, merged back wherever
// no vertex interrupts the slab boundary; this equals cutting with axis-parallel rays from the
// reflex vertices.

function decompositions(F: Frame): Decomposition[] {
  const large = F.dholes.filter((_, i) => !F.holeColumn[i]); // shafts and voids cut bays
  const small = F.holes.filter((_, i) => F.holeColumn[i]); // columns never cut bays
  const mkBay = (ring: Pt[], holes: Pt[][], id: number): Bay => {
    const bb = bbox(ring);
    const hs = holes.filter((h) => {
      const b = bbox(h);
      return b.x1 > bb.x0 && b.x0 < bb.x1 && b.y1 > bb.y0 && b.y0 < bb.y1;
    });
    const convex = isConvex(ring);
    return {
      id,
      ring,
      holes: hs,
      bb,
      area: Math.abs(ringArea(ring)) - hs.reduce((s, h) => s + Math.abs(ringArea(h)), 0),
      convex,
      fast: convex && hs.length === 0 && !F.simplified,
    };
  };
  const out: Decomposition[] = [{ name: "none", bays: [mkBay(F.douter, F.dholes, 0)] }];
  let reflex = large.reduce((s, h) => s + h.length, 0);
  const n = F.douter.length;
  for (let i = 0; i < n; i++) {
    const a = F.douter[(i + n - 1) % n];
    const b = F.douter[i];
    const c = F.douter[(i + 1) % n];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < -1e-6) reflex++;
  }
  if (reflex === 0) return out;
  const rings = [F.douter, ...large];
  const cutH = trapezoidBays(rings).map((r, i) => mkBay(r, small, i));
  const T = (r: Pt[]) => r.map((p) => ({ x: p.y, y: p.x }));
  const cutV = trapezoidBays(rings.map(T))
    .map((r) => orientRing(T(r), true))
    .map((r, i) => mkBay(r, small, i));
  const cuts = (
    [
      { name: "cutH", bays: cutH },
      { name: "cutV", bays: cutV },
    ] as Decomposition[]
  ).filter((d) => d.bays.length > 1);
  if (reflex > 12 && cuts.length === 2) cuts.splice(cuts[0].bays.length <= cuts[1].bays.length ? 1 : 0, 1);
  return out.concat(cuts);
}

type Trap = { id: number; k: number; ylo: number; yhi: number; xlb: number; xlt: number; xrb: number; xrt: number };

function trapezoidBays(rings: Pt[][]): Pt[][] {
  const ys0 = rings
    .flat()
    .map((p) => p.y)
    .sort((a, b) => a - b);
  const ys: number[] = [];
  for (const y of ys0) if (!ys.length || y - ys[ys.length - 1] > 0.5) ys.push(y);
  const edges: [Pt, Pt][] = [];
  for (const r of rings)
    r.forEach((p, i) => {
      const q = r[(i + 1) % r.length];
      if (Math.abs(q.y - p.y) > 1e-9) edges.push([p, q]);
    });
  const slabs: Trap[][] = [];
  let id = 0;
  for (let k = 0; k + 1 < ys.length; k++) {
    const ylo = ys[k];
    const yhi = ys[k + 1];
    const ym = (ylo + yhi) / 2;
    const xs: { m: number; b: number; t: number }[] = [];
    for (const [a, b] of edges) {
      if (Math.min(a.y, b.y) < ym && Math.max(a.y, b.y) > ym) {
        const f = (y: number) => a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
        xs.push({ m: f(ym), b: f(ylo), t: f(yhi) });
      }
    }
    xs.sort((p, q) => p.m - q.m);
    const traps: Trap[] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) {
      traps.push({ id: id++, k, ylo, yhi, xlb: xs[i].b, xlt: xs[i].t, xrb: xs[i + 1].b, xrt: xs[i + 1].t });
    }
    slabs.push(traps);
  }
  const all = slabs.flat();
  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let k = 0; k + 1 < slabs.length; k++) {
    for (const Tr of slabs[k]) {
      const ups = slabs[k + 1].filter((U) => U.xlb < Tr.xrt - 1 && U.xrb > Tr.xlt + 1);
      if (ups.length !== 1) continue;
      const U = ups[0];
      const downs = slabs[k].filter((S) => S.xrt > U.xlb + 1 && S.xlt < U.xrb - 1);
      if (downs.length === 1 && Math.abs(Tr.xlt - U.xlb) < 1 && Math.abs(Tr.xrt - U.xrb) < 1) parent[find(U.id)] = find(Tr.id);
    }
  }
  const groups = new Map<number, Trap[]>();
  for (const Tr of all) {
    const g = find(Tr.id);
    let arr = groups.get(g);
    if (!arr) groups.set(g, (arr = []));
    arr.push(Tr);
  }
  const out: Pt[][] = [];
  for (const g of [...groups.keys()].sort((a, b) => a - b)) {
    const st = groups.get(g)!.sort((a, b) => a.k - b.k);
    const ring: Pt[] = [{ x: st[0].xlb, y: st[0].ylo }];
    for (const Tr of st) ring.push({ x: Tr.xlt, y: Tr.yhi });
    for (let i = st.length - 1; i >= 0; i--) {
      ring.push({ x: st[i].xrt, y: st[i].yhi });
      ring.push({ x: st[i].xrb, y: st[i].ylo });
    }
    const r = cleanRing(ring, 1);
    if (r.length >= 3 && Math.abs(ringArea(r)) > 1e3) out.push(orientRing(r, true));
  }
  return out;
}

// --- Layout for one decomposition: bays largest first, each bay picks its best row-set variant ---

function layoutDecomposition(F: Frame, dec: Decomposition, R: Rule, prefs: Prefs, pattern: Pattern, cap: number | null, alignRows: boolean): DecResult {
  const bays = dec.bays;
  const per: BaySamples[] = bays.map(() => ({ lat: [], bnd: [], wall: [] }));
  const assign = (s: Sample, key: keyof BaySamples) => {
    let bi = -1;
    let inside = false;
    for (let i = 0; i < bays.length; i++) {
      const b = bays[i].bb;
      if (s.vx < b.x0 - 1 || s.vx > b.x1 + 1 || s.vy < b.y0 - 1 || s.vy > b.y1 + 1) continue;
      if (pointInRing({ x: s.vx, y: s.vy }, bays[i].ring)) {
        bi = i;
        inside = true;
        break;
      }
    }
    if (bi < 0) {
      let bd = Infinity;
      for (let i = 0; i < bays.length; i++) {
        const r = bays[i].ring;
        for (let k = 0; k < r.length; k++) {
          const d = distPointSeg({ x: s.vx, y: s.vy }, r[k], r[(k + 1) % r.length]);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
      }
    }
    per[bi][key].push({ s, bay: bi, inside });
  };
  for (const s of F.lat) assign(s, "lat");
  for (const s of F.bnd) assign(s, "bnd");
  for (const s of F.wall) assign(s, "wall");

  const order = bays.map((_, i) => i).sort((a, b) => bays[b].area - bays[a].area || a - b);
  const placedCov: FHead[] = F.locked.slice();
  const placedSp: FHead[] = F.locked.concat(F.neighbours);
  const heads: FHead[] = F.locked.slice();
  let unresolved: Sample[] = [];
  let gapFill = 0;
  let cost = 0;
  let rowCount = 0;
  let alignedExtra = 0;
  const alignXs: number[] = [];
  for (const bi of order) {
    const room = cap == null ? null : cap - heads.length; // both counts include locked heads
    const res = layoutBay(F, bays[bi], bi, per[bi], { R, prefs, pattern, placedCov, placedSp, alignXs, alignRows }, room);
    for (const h of res.heads) {
      heads.push(h);
      placedCov.push(h);
      placedSp.push(h);
      alignXs.push(h.x);
    }
    unresolved = unresolved.concat(res.unresolved);
    gapFill += res.gapFill;
    alignedExtra += res.alignedExtra ?? 0;
    cost += res.cost;
    rowCount += res.rows;
    // A complete layout already exists (cap): one that leaves samples unresolved, or needs more
    // heads, can never beat it, so the remaining bays are skipped (exact; the result still loses).
    if (cap != null && (unresolved.length || heads.length > cap)) break;
  }
  // H4 self-check (max spacing to the nearest visible peer): an engine claim the oracle verifies.
  const h4: FHead[] = [];
  for (const h of heads) {
    if (h.kind === "locked") continue;
    let nn = Infinity;
    let any = false;
    for (const g of heads.concat(F.neighbours)) {
      if (g === h) continue;
      const d = Math.hypot(g.x - h.x, g.y - h.y);
      if (d >= nn) continue;
      if (F.idx.visible(h, g)) {
        any = true;
        nn = d;
      }
    }
    if (any && nn > R.Smax + TOL) h4.push(h);
  }
  return { heads, unresolved, gapFill, cost, h4, rowCount, alignedExtra };
}

function layoutBay(F: Frame, bay: Bay, bi: number, samples: BaySamples, ctx: BayCtx, room: number | null): RowsResult {
  const variants = rowVariants(F, bay, ctx);
  const modes = bay.fast ? [false] : [false, true];
  const all: RowsResult[] = [];
  // Exact pruning: once a variant resolves every sample with n heads, a variant that needs more than
  // n heads can never win (cmpBay ranks unresolved first, then heads), so its sweep stops early.
  let bound: number | null = room;
  let lastShadow = true;
  sweep: for (const rows of variants)
    for (const defer of modes) {
      if (F.ops.armed && all.length && F.ops.n > F.ops.budget) {
        F.ops.truncated = true;
        break sweep;
      }
      if (defer && !lastShadow) continue; // identical to the run without deferral
      const res = layoutRows(F, bay, bi, samples, rows, ctx, defer, bound);
      lastShadow = res === null ? true : res.sawShadow;
      if (res === null) continue;
      // (with aligned rows, a variant may use a few more heads than the fewest and still be taken)
      if (!res.unresolved.length) {
        const lim = res.heads.length + (ctx.alignRows ? alignAllowance(res.heads.length) : 0);
        if (bound == null || lim < bound) bound = lim;
      }
      all.push(res);
    }
  if (!all.length) return { heads: [], rest: [], unresolved: samples.lat.map((o) => o.s), gapFill: 0, cost: 0, rows: 0, sawShadow: false };
  all.sort(cmpBay);
  // only the most promising layouts get gap-fill heads, and only when a head still fits under the
  // cap (a gap-fill head is one more head; with no room the layout cannot win either way)
  if (all[0].unresolved.length && (room == null || all[0].heads.length < room)) {
    const top = all.slice(0, 3).map((r) => (room == null || r.heads.length < room ? applyGapFill(F, bay, bi, samples, r, ctx) : r));
    all.splice(0, 3, ...top);
    all.sort(cmpBay);
  }
  // Aligned rows inside the bay: rows that hold different numbers of heads (5-4-4-5) give way to a
  // row set whose heads line up, when it costs no more than alignAllowance and saves ALIGN_GAIN
  // lines for each extra head.
  const fewest = all[0];
  if (ctx.alignRows && !fewest.unresolved.length && !fewest.gapFill) {
    const n = fewest.heads.length;
    const base = lineCount(fewest.heads);
    let pick = fewest;
    let pickLines = base;
    for (const c of all) {
      const extra = c.heads.length - n;
      if (c.unresolved.length || c.gapFill || extra <= 0 || extra > alignAllowance(n)) continue;
      const l = lineCount(c.heads);
      if (base - l < ALIGN_GAIN * extra) continue;
      if (l < pickLines || (l === pickLines && c.heads.length < pick.heads.length)) {
        pick = c;
        pickLines = l;
      }
    }
    if (pick !== fewest) return { ...pick, alignedExtra: pick.heads.length - n };
  }
  return fewest;
}

function cmpBay(a: RowsResult, b: RowsResult): number {
  return a.unresolved.length - b.unresolved.length || a.heads.length - b.heads.length || a.gapFill - b.gapFill || a.cost - b.cost;
}

function rowVariants(F: Frame, bay: Bay, ctx: BayCtx): number[][] {
  const { R, prefs } = ctx;
  const grid = F.grid;
  const y0 = bay.bb.y0;
  const y1 = bay.bb.y1;
  const H = y1 - y0;
  let m = Math.max(1, Math.ceil(H / R.Smax - 1e-9));
  while (H / (2 * m) > R.Wmax + TOL) m++;
  const out: number[][] = [];
  const unis: number[][] = [];
  const push = (rows: number[]) => {
    if (!out.some((o) => o.length === rows.length && o.every((y, i) => Math.abs(y - rows[i]) < 0.5))) out.push(rows);
  };
  const okD = (rows: number[]) => rows.every((_, i) => i === 0 || (rows[i] - rows[i - 1] >= R.Smin - TOL && rows[i] - rows[i - 1] <= R.Smax + TOL));
  // each row moved to the nearest tile-stop line (null if two rows collapse onto one line)
  const snapRows = (rows: number[]): number[] | null => {
    if (!grid) return null;
    const snapped: number[] = [];
    for (const y of rows) {
      const j = Math.round((y - grid.oy) / grid.py - 0.5);
      let best: number | null = null;
      for (const jj of [j - 1, j, j + 1]) {
        const ys = grid.oy + (jj + 0.5) * grid.py;
        if (ys <= y0 + R.Wmin || ys >= y1 - R.Wmin) continue;
        if (best == null || Math.abs(ys - y) < Math.abs(best - y)) best = ys;
      }
      const b = best;
      if (b != null && !snapped.some((v) => Math.abs(v - b) < 1)) snapped.push(b);
    }
    return snapped.length === rows.length ? snapped : null;
  };
  // Head lines along the rows that cross this bay: those rows are fixed, and rows are added between
  // them and the walls (evenly, the fewest the rules allow, and one more). When no such set is
  // valid (lines closer than Smin, say), the bay is laid out as if it had no lines.
  const fixed: number[] = [];
  for (const g of F.rowGuides.slice().sort((a, b) => a.y - b.y)) {
    if (g.x1 <= bay.bb.x0 || g.x0 >= bay.bb.x1 || g.y <= y0 + R.Wmin || g.y >= y1 - R.Wmin) continue;
    if (fixed.length && g.y - fixed[fixed.length - 1] < R.Smin) continue;
    fixed.push(g.y);
  }
  if (fixed.length) {
    // A hand-drawn line is not exact: a line up to GUIDE_SNAP past a limit (Wmax from a wall, Smax
    // from the line before it) is moved back onto the limit, so it does not cost a whole extra row.
    const over = (v: number, lim: number) => (v > lim && v <= lim + GUIDE_SNAP ? v - lim : 0);
    fixed[0] -= over(fixed[0] - y0, R.Wmax);
    for (let i = 1; i < fixed.length; i++) fixed[i] -= over(fixed[i] - fixed[i - 1], R.Smax);
    const last = fixed.length - 1;
    const up = over(y1 - fixed[last], R.Wmax);
    if (up && (last === 0 || fixed[last] + up - fixed[last - 1] <= R.Smax)) fixed[last] += up;
    for (let k = 0; k < 2; k++) {
      const rows: number[] = [];
      const edge = (L: number, from: number, dir: 1 | -1) => {
        const n = Math.max(0, Math.ceil((L - R.Wmax) / R.Smax - 1e-9)) + k;
        if (!n) return;
        let D = L / (n + 0.5);
        if (D / 2 > R.Wmax) D = (L - (R.Wmax - 1)) / n;
        for (let i = 1; i <= n; i++) rows.push(from + dir * i * D);
      };
      edge(fixed[0] - y0, fixed[0], -1);
      fixed.forEach((y, i) => {
        rows.push(y);
        if (i + 1 === fixed.length) return;
        const L = fixed[i + 1] - y;
        const n = Math.max(0, Math.ceil(L / R.Smax - 1e-9) - 1) + k;
        for (let q = 1; q <= n; q++) rows.push(y + (q * L) / (n + 1));
      });
      edge(y1 - fixed[fixed.length - 1], fixed[fixed.length - 1], 1);
      rows.sort((a, b) => a - b);
      const mmr = rows.length;
      if (rows[0] - y0 <= R.Wmax + TOL && y1 - rows[mmr - 1] <= R.Wmax + TOL && rows[0] > y0 + R.Wmin && rows[mmr - 1] < y1 - R.Wmin && okD(rows)) push(rows);
    }
    if (out.length) return out;
  }
  for (let k = 0; k < 3; k++) {
    const mm = m + k;
    if (mm > 1 && H / mm < R.Smin - TOL) break;
    const uni = Array.from({ length: mm }, (_, i) => y0 + ((i + 0.5) * H) / mm);
    if (k <= 1) unis.push(uni);
    if (!grid || grid.mode !== "required") push(uni);
    if (mm > 2) {
      // edge rows pulled out to Wmax: interior rows bunch up (helps rows see both faces of columns)
      const o = R.Wmax - 1;
      const D = (H - 2 * o) / (mm - 1);
      if (D >= R.Smin && D <= R.Smax) push(Array.from({ length: mm }, (_, i) => y0 + o + i * D));
    }
    if (prefs.wallDist && mm > 1) {
      const o = prefs.wallDist;
      const D = (H - 2 * o) / (mm - 1);
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
  // a time.
  const bands = columnBands(F, bay, R);
  if (bands.length) {
    for (const rows of unis) {
      const mm = rows.length;
      for (let j = 0; j < mm; j++) {
        const band = bands.find((b) => rows[j] > b[0] && rows[j] < b[1]);
        if (!band) continue;
        for (const p of COL_GAP.flatMap((g) => [band[0] - g, band[1] + g])) {
          if (p <= y0 + R.Wmin || p >= y1 - R.Wmin) continue;
          const na = mm - 1 - j;
          const o = R.Wmax - 1;
          // other rows spread evenly (half a gap at the walls), or with the wall rows at Wmax
          for (const [Db, Da] of [
            [j ? (p - y0) / (j + 0.5) : 0, na ? (y1 - p) / (na + 0.5) : 0],
            [j ? (p - y0 - o) / j : 0, na ? (y1 - o - p) / na : 0],
          ]) {
            const moved = rows.map((_, i) => (i < j ? p - (j - i) * Db : i > j ? p + (i - j) * Da : p));
            const edgeOk = (r: number[]) => r[0] - y0 <= R.Wmax + TOL && y1 - r[mm - 1] <= R.Wmax + TOL;
            if (!grid || grid.mode !== "required") {
              if (edgeOk(moved) && okD(moved)) push(moved);
            }
            const sn = grid ? snapRows(moved) : null;
            if (sn && edgeOk(sn) && okD(sn) && !bands.some((b) => sn[j] > b[0] && sn[j] < b[1])) push(sn);
          }
        }
      }
    }
  }
  return out;
}

/** y-bands (frame coordinates) of the columns inside a bay, widened by Wmin and merged. */
function columnBands(F: Frame, bay: Bay, R: Rule): Interval[] {
  const raw: Interval[] = [];
  F.holes.forEach((h, i) => {
    if (!F.holeColumn[i]) return;
    const b = bbox(h);
    if (b.x1 <= bay.bb.x0 || b.x0 >= bay.bb.x1 || b.y1 <= bay.bb.y0 || b.y0 >= bay.bb.y1) return;
    raw.push([b.y0 - R.Wmin, b.y1 + R.Wmin]);
  });
  raw.sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const r of raw) {
    const l = out[out.length - 1];
    if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// --- Row sweep for one bay and one row set ------------------------------------------------------

type BandItem = { o: Owned; iv: Interval | null };
type DemandItem = { o: Owned; iv: Interval | null; own: boolean; pulled?: boolean };

/** null when pruned by `bound` (it can no longer beat a complete variant). */
function layoutRows(F: Frame, bay: Bay, bi: number, samples: BaySamples, rows: number[], ctx: BayCtx, defer: boolean, bound: number | null): RowsResult | null {
  const { R, prefs, pattern } = ctx;
  const m = rows.length;
  const y0 = bay.bb.y0;
  const y1 = bay.bb.y1;
  const lo = rows.map((y, j) => (j === 0 ? y0 : (rows[j - 1] + y) / 2));
  const hi = rows.map((y, j) => (j === m - 1 ? y1 : (y + rows[j + 1]) / 2));
  const bandOf = (y: number) => {
    for (let j = 0; j < m - 1; j++) if (y < hi[j]) return j;
    return m - 1;
  };

  const info: RowInfo[] = rows.map((y, j) => {
    const d = Math.max(y - lo[j], hi[j] - y);
    const Srect = d < R.Rc ? 2 * Math.sqrt(R.Rc * R.Rc - d * d) : 0;
    const S = Math.min(R.Smax, Srect, R.Amax / (2 * Math.max(d, 1)));
    const runs = rowRuns(bay, y);
    const clean = cleanIntervals(bay, runs, lo[j], hi[j]);
    return { y, d, Srect, S, runs, clean, base: rowCandidates(F, y, runs, R, prefs) };
  });

  // bucket samples by band; drop lattice samples dominated inside clean columns
  const bands: BandItem[][] = rows.map(() => []);
  // the first and last lattice row of each band (only those survive inside clean columns)
  const iyLo = rows.map((_, j) => Math.ceil((lo[j] - 50) / LAT - 1e-9));
  const iyHi = rows.map((_, j) => (j === m - 1 ? Math.floor((hi[j] - 50) / LAT + 1e-9) : Math.ceil((hi[j] - 50) / LAT - 1e-9) - 1));
  for (const o of samples.lat) {
    const j = bandOf(o.s.y);
    const iy = o.s.iy;
    if (iy !== iyLo[j] && iy !== iyHi[j]) {
      const clean = info[j].clean;
      if (clean.length && findIv(clean, o.s.x)) continue;
      bands[j].push({ o, iv: null });
      continue;
    }
    bands[j].push({ o, iv: findIv(info[j].clean, o.s.x) });
  }
  for (const o of samples.bnd) {
    const j = bandOf(o.s.y);
    bands[j].push({ o, iv: findIv(info[j].clean, o.s.x) });
  }
  for (const o of samples.wall) {
    const j = bandOf(o.s.y);
    bands[j].push({ o, iv: null });
  }
  for (let j = 0; j < m; j++) {
    for (const iv of info[j].clean)
      for (const x of [iv[0], iv[1]])
        for (const y of [lo[j] + 1, hi[j] - 1]) {
          if (hi[j] - lo[j] < 3 || !pointInRegion({ x, y }, F.outer, F.holes)) continue;
          bands[j].push({ o: { s: { t: 3, x, y, vx: x, vy: y }, inside: true }, iv });
        }
  }

  const heads: FHead[] = [];
  const unresolved: Owned[] = [];
  const cov = new HeadGrid(ctx.placedCov, R.Rc);
  let carry: Owned[] = [];
  let cost = 0;
  let prevRowXs: number[] | null = null;
  let row0: number[] | null = null;
  let row0S = 0;
  let sawShadow = false;
  for (let j = 0; j < m; j++) {
    if (bound != null && heads.length > bound) return null;
    const I = info[j];
    const spHeads = ctx.placedSp.concat(heads);
    // targets for alignment / stagger
    let targets: number[] = [];
    let restrict = false;
    if (pattern === "staggered" && row0 && row0.length) {
      // staggered (§3.10): odd rows on the half-offset lattice of the first row, even rows on it;
      // heads beyond the lattice span are free (end heads near walls)
      targets = j % 2 ? staggerTargets(row0, row0S) : row0.slice();
      restrict = true;
    } else if (prevRowXs && prevRowXs.length) targets = prevRowXs.slice();
    else if (pattern !== "staggered") targets = ctx.alignXs.filter((x) => x >= bay.bb.x0 && x <= bay.bb.x1);
    const cross = F.crossGuides.filter((c) => I.y >= c.y0 - CROSS_REACH && I.y <= c.y1 + CROSS_REACH).map((c) => c.x);
    let cands = finalCandidates(F, I, cross.length ? targets.concat(cross) : targets, spHeads, R);
    if (restrict && targets.length) {
      const tmin = targets[0];
      const tmax = targets[targets.length - 1];
      const keep = cands.filter((c) => c.x < tmin - 1 || c.x > tmax + 1 || targets.some((t) => Math.abs(t - c.x) < 1) || cross.some((t) => Math.abs(t - c.x) < 1));
      if (keep.length) cands = keep;
    }

    const items: DemandItem[] = bands[j].map((b) => ({ o: b.o, iv: b.iv, own: true }));
    for (const o of carry) items.push({ o, iv: null, own: false });
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
    const demands: DemandRange[] = [];
    const dItems: DemandItem[] = [];
    for (const it of items) {
      if (satisfied(F, bay, bi, it.o, cov, R)) continue;
      const r = demandRange(F, bay, bi, it.o, it.own ? it.iv : null, I, cands, R, false);
      if (!r) {
        if (it.pulled) continue; // stays with its own band
        if (j + 1 < m) carry.push(it.o);
        else unresolved.push(it.o);
        continue;
      }
      if (r.shadowed) sawShadow = true;
      if (r.shadowed && defer && j + 1 < m && !it.pulled) {
        // partly in a wall's shadow from this row: let the next row serve it when it can
        const N = info[j + 1];
        if (demandRange(F, bay, bi, it.o, null, N, N.base, R, true)) {
          carry.push(it.o);
          continue;
        }
      }
      demands.push(r);
      dItems.push(it);
    }
    let sol = stabDP(cands, demands, I, R, prefs, targets, pattern, F.grid, F.ops, cross);
    // Demands that cannot all be met on this row (two narrow windows closer than Smin): hand the
    // narrowest on to the next row (or report it) and solve again. Bounded.
    for (let tries = 0; !sol && demands.length && tries < 40; tries++) {
      let k = 0;
      for (let i = 1; i < demands.length; i++) if (demands[i][1] - demands[i][0] < demands[k][1] - demands[k][0]) k = i;
      const it = dItems[k];
      demands.splice(k, 1);
      dItems.splice(k, 1);
      if (!it.pulled) (j + 1 < m ? carry : unresolved).push(it.o);
      sol = stabDP(cands, demands, I, R, prefs, targets, pattern, F.grid, F.ops, cross);
    }
    if (!sol) {
      for (const it of dItems) if (!it.pulled) (j + 1 < m ? carry : unresolved).push(it.o);
      prevRowXs = [];
      continue;
    }
    cost += sol.cost;
    const xs: number[] = [];
    for (const k of sol.idx) {
      const c = cands[k];
      const h: FHead = { x: c.x, y: I.y, bay: bi, row: j, kind: "row" };
      heads.push(h);
      cov.add(h);
      xs.push(c.x);
    }
    prevRowXs = xs;
    if (!row0 && xs.length) {
      row0 = xs.slice();
      row0S = I.S;
    }
  }

  const rest = unresolved.filter((o) => !satisfied(F, bay, bi, o, cov, R));
  return { heads, rest, unresolved: rest.map((o) => o.s), gapFill: 0, cost, rows: m, sawShadow };
}

/** Gap-fill (§3.4 step 6): bounded, labelled exceptions, applied to a finished row layout. */
function applyGapFill(F: Frame, bay: Bay, bi: number, samples: BaySamples, res: RowsResult, ctx: BayCtx): RowsResult {
  const { R } = ctx;
  let rest = res.rest;
  let gapFill = 0;
  const heads = res.heads.slice();
  for (let it = 0; it < MAX_GAPFILL && rest.length; it++) {
    const h = bestGapFill(F, bay, bi, samples, rest, ctx.placedSp.concat(heads), R);
    if (!h) break;
    const g: FHead = { ...h, bay: bi, row: "g", kind: "gapFill" };
    heads.push(g);
    gapFill++;
    rest = rest.filter((o) => !servedBy(F, bay, bi, o, g, R));
  }
  return { ...res, heads, rest, unresolved: rest.map((o) => o.s), gapFill, cost: res.cost + gapFill * 50 };
}

/** Half-offset lattice of a row: midpoints of consecutive heads (beyond the span stays free). */
function staggerTargets(xs: number[], S: number): number[] {
  const s = xs.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i + 1 < s.length; i++) if (s[i + 1] - s[i] <= S + 1) out.push((s[i] + s[i + 1]) / 2);
  return out;
}

function rowRuns(bay: Bay, y: number): Interval[] {
  const base = ringRowIntervals(bay.ring, y);
  const cuts = bay.holes.flatMap((h) => ringRowIntervals(h, y));
  return subtractIntervals(base, cuts);
}

/** x-intervals where the whole band [lo, hi] above / below the row is free of walls. */
function cleanIntervals(bay: Bay, runs: Interval[], lo: number, hi: number): Interval[] {
  const a = lo + 0.5;
  const b = hi - 0.5;
  const blocked: Interval[] = [];
  for (const r of [bay.ring, ...bay.holes]) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      const ylo = Math.min(p.y, q.y);
      const yhi = Math.max(p.y, q.y);
      if (yhi <= a || ylo >= b) continue;
      if (Math.abs(q.y - p.y) < 1e-9) {
        blocked.push([Math.min(p.x, q.x), Math.max(p.x, q.x)]);
        continue;
      }
      const f = (y: number) => p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y);
      const xa = f(Math.max(ylo, a));
      const xb = f(Math.min(yhi, b));
      blocked.push([Math.min(xa, xb), Math.max(xa, xb)]);
    }
  }
  return subtractIntervals(
    runs,
    mergeIntervals(blocked).map(([u, v]) => [u - 1e-6, v + 1e-6] as Interval),
  );
}

function findIv(ivs: Interval[], x: number): Interval | null {
  for (const iv of ivs) if (x >= iv[0] && x <= iv[1]) return iv;
  return null;
}

/** An admissible head position: inside, Wmin clear of every wall and column, outside keep-outs. */
function admissibleAt(F: Frame, p: Pt, R: Rule): boolean {
  const need = R.Wmin + 1;
  return pointInRegion(p, F.outer, F.holes) && F.idx.clearance(p, need + 1) >= need && !inKeepOut(F, p);
}

function rowCandidates(F: Frame, y: number, runs: Interval[], R: Rule, prefs: Prefs): Cand[] {
  const out: Cand[] = [];
  const need = R.Wmin + 1;
  runs.forEach(([a, b], ri) => {
    const xs: number[] = [];
    for (let x = Math.ceil(a / CSTEP) * CSTEP; x <= b; x += CSTEP) xs.push(x);
    const L = b - a;
    const n0 = Math.max(1, Math.ceil(L / R.Smax - 1e-9));
    for (let n = n0; n <= n0 + 2; n++) for (let k = 0; k < n; k++) xs.push(a + ((k + 0.5) * L) / n);
    if (prefs.wallDist) {
      const o = prefs.wallDist;
      for (let n = n0; n <= n0 + 2; n++) for (let k = 0; k < n; k++) xs.push(n === 1 ? a + L / 2 : a + o + (k * (L - 2 * o)) / (n - 1));
    }
    xs.push(a + need, b - need);
    if (F.grid) {
      const i0 = Math.ceil((a - F.grid.ox) / F.grid.px - 0.5);
      const i1 = Math.floor((b - F.grid.ox) / F.grid.px - 0.5);
      for (let i = i0; i <= i1; i++) xs.push(F.grid.ox + (i + 0.5) * F.grid.px);
    }
    for (const x of xs) {
      if (x < a || x > b) continue;
      const p = { x, y };
      if (!admissibleAt(F, p, R)) continue;
      out.push({ x, y, run: ri, stop: F.grid ? isStop(F.grid, x, y) : false, seg: 0 });
    }
  });
  out.sort((p, q) => p.x - q.x);
  const ded: Cand[] = [];
  for (const c of out) {
    const l = ded[ded.length - 1];
    if (l && Math.abs(l.x - c.x) < 1) {
      l.stop = l.stop || c.stop;
      continue;
    }
    ded.push(c);
  }
  return ded;
}

function isStop(g: GridF, x: number, y: number): boolean {
  const fx = (x - g.ox) / g.px - 0.5;
  const fy = (y - g.oy) / g.py - 0.5;
  return Math.abs(fx - Math.round(fx)) * g.px < 1 && Math.abs(fy - Math.round(fy)) * g.py < 1;
}

function finalCandidates(F: Frame, I: RowInfo, targets: number[], spHeads: FHead[], R: Rule): Cand[] {
  let list = I.base;
  if (targets.length) {
    const extra: Cand[] = [];
    for (const x of targets) {
      const ri = I.runs.findIndex(([a, b]) => x >= a && x <= b);
      if (ri < 0) continue;
      const p = { x, y: I.y };
      if (!admissibleAt(F, p, R)) continue;
      extra.push({ x, y: I.y, run: ri, stop: F.grid ? isStop(F.grid, x, I.y) : false, seg: 0 });
    }
    if (extra.length) {
      list = list.concat(extra).sort((p, q) => p.x - q.x);
      const ded: Cand[] = [];
      for (const c of list) {
        const l = ded[ded.length - 1];
        if (l && Math.abs(l.x - c.x) < 0.5) continue;
        ded.push(c);
      }
      list = ded;
    }
  }
  const req = F.grid && F.grid.mode === "required";
  const smin = R.Smin + TOL;
  const out: Cand[] = [];
  let seg = 0;
  let last: Cand | null = null;
  let excludedSince = false;
  for (const c of list) {
    if (req && !c.stop) continue;
    let bad = false;
    for (const h of spHeads) {
      const dx = h.x - c.x;
      const dy = h.y - c.y;
      if (dx * dx + dy * dy < smin * smin && F.idx.visible(c, h)) {
        bad = true;
        break;
      }
    }
    if (bad) {
      excludedSince = true;
      continue;
    }
    if (!last || last.run !== c.run || excludedSince || c.x - last.x > (req && F.grid ? F.grid.px + 1 : 110)) seg++;
    out.push({ ...c, seg });
    last = c;
    excludedSince = false;
  }
  return out;
}

/** Is sample o already served by one of the heads in `grid`? */
function satisfied(F: Frame, bay: Bay, bi: number, o: Owned, grid: HeadGrid, R: Rule): boolean {
  return grid.near(o.s.x, o.s.y, (h) => servedBy(F, bay, bi, o, h, R));
}

/** Does head h serve sample o (reach, the wall-distance rule for wall samples, sight line)? */
function servedBy(F: Frame, bay: Bay, bi: number, o: Owned, h: FHead, R: Rule): boolean {
  const s = o.s;
  const dx = h.x - s.x;
  const dy = h.y - s.y;
  if (s.t === 2) {
    const r = R.Rc - MU_WALL;
    if (dx * dx + dy * dy > r * r) return false;
    if (Math.abs(s.nx! * h.x + s.ny! * h.y - s.c!) > R.Wmax + TOL) return false;
    return visibleFrom(F, bay, bi, h, o);
  }
  const r = R.Rc - MU_COV;
  if (dx * dx + dy * dy > r * r) return false;
  return visibleFrom(F, bay, bi, h, o);
}

function visibleFrom(F: Frame, bay: Bay, bi: number, h: FHead, o: Owned): boolean {
  if (bay.fast && h.bay === bi && o.inside) return true;
  return F.idx.visible(h, { x: o.s.vx, y: o.s.vy });
}

/** Uniform grid over heads, cell = Rc, so any head within reach is in the 3 × 3 neighbourhood. */
class HeadGrid {
  private readonly cell: number;
  private readonly map = new Map<number, FHead[]>();
  constructor(heads: readonly FHead[], cell: number) {
    this.cell = cell;
    for (const h of heads) this.add(h);
  }
  add(h: FHead): void {
    const k = Math.floor(h.x / this.cell) * 100003 + Math.floor(h.y / this.cell);
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(h);
  }
  near(x: number, y: number, fn: (h: FHead) => boolean): boolean {
    const i0 = Math.floor(x / this.cell);
    const j0 = Math.floor(y / this.cell);
    for (let i = i0 - 1; i <= i0 + 1; i++)
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const a = this.map.get(i * 100003 + j);
        if (!a) continue;
        for (const h of a) if (fn(h)) return true;
      }
    return false;
  }
}

/** The demand of a sample on row I as a candidate index range [a, b], or null when no candidate serves it. */
function demandRange(F: Frame, bay: Bay, bi: number, o: Owned, iv: Interval | null, I: RowInfo, C: Cand[], R: Rule, probeOnly: boolean): DemandRange | null {
  if (!C.length) return null;
  const s = o.s;
  const y = I.y;
  let ra: DemandRange | null = null;
  if (iv && s.t !== 2) {
    const h = I.Srect / 2 - TOL;
    ra = idxRange(C, Math.max(iv[0], s.x - h), Math.min(iv[1], s.x + h));
    // unclipped rect window is at least as wide as the circle window: skip the sight-line work
    if (ra && s.x - h >= iv[0] && s.x + h <= iv[1] && Math.abs(s.y - y) >= I.d - LAT) return ra;
  }
  let lo: number | undefined;
  let hi: number | undefined;
  if (s.t === 2) {
    const r = R.Rc - MU_WALL;
    const dy = s.y - y;
    if (Math.abs(dy) >= r) return ra;
    const hw = Math.sqrt(r * r - dy * dy);
    lo = s.x - hw;
    hi = s.x + hw;
    const W = R.Wmax + TOL * 0.6;
    const nx = s.nx!;
    const ny = s.ny!;
    const c = s.c!;
    if (Math.abs(nx) < 1e-9) {
      if (Math.abs(ny * y - c) > W) return null;
    } else {
      const u = (c - W - ny * y) / nx;
      const v = (c + W - ny * y) / nx;
      lo = Math.max(lo, Math.min(u, v));
      hi = Math.min(hi, Math.max(u, v));
    }
  } else {
    const r = R.Rc - MU_COV;
    const dy = s.y - y;
    if (Math.abs(dy) < r) {
      const hw = Math.sqrt(r * r - dy * dy);
      lo = s.x - hw;
      hi = s.x + hw;
    }
  }
  let ca: DemandRange | null = null;
  if (lo !== undefined && hi !== undefined && hi >= lo) {
    const rg = idxRange(C, lo, hi);
    if (rg) ca = visibleRun(F, bay, o, C, rg, probeOnly);
  }
  if (ra && ca) {
    if (ca[0] <= ra[1] + 1 && ra[0] <= ca[1] + 1) return [Math.min(ra[0], ca[0]), Math.max(ra[1], ca[1])];
    return ra;
  }
  return ra ?? ca;
}

function idxRange(C: Cand[], lo: number, hi: number): DemandRange | null {
  if (hi < lo) return null;
  let a = 0;
  let b = C.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (C[m].x < lo - 1e-9) a = m + 1;
    else b = m;
  }
  const first = a;
  a = first;
  b = C.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (C[m].x <= hi + 1e-9) a = m + 1;
    else b = m;
  }
  const last = a - 1;
  return first <= last ? [first, last] : null;
}

// The shadows that wall edges cast from sample s onto the row line y (closed shadows: grazing
// blocks), memoised per (sample, row) within a frame: row-set variants and both deferral modes
// revisit the same pairs (R1: 1.7 M queries, 0.32 M distinct). The query box spans every candidate a
// demand window can reach (|x − s.x| ≤ Rc), so the memo gives the same answer as a box fitted to one
// window: an edge outside the box only shadows row points outside it.
function rowShadows(F: Frame, s: Sample, r: number): Interval[] {
  const memo = (s.sh ??= []);
  for (const m of memo) if (m.y === r) return m.iv;
  const sv = { x: s.vx, y: s.vy };
  const dy = r - sv.y;
  const xa = sv.x - F.reach;
  const xb = sv.x + F.reach;
  const sh: Interval[] = [];
  const BIG = 1e12;
  if (Math.abs(dy) < 1e-6) {
    F.idx.forBox(xa, r - 1, xb, r + 1, (e) => {
      F.ops.n++;
      if (e.a.y === e.b.y || (e.a.y - r) * (e.b.y - r) > 0) return;
      const x = e.a.x + ((r - e.a.y) * (e.b.x - e.a.x)) / (e.b.y - e.a.y);
      sh.push(x < sv.x ? [-BIG, x] : [x, BIG]);
    });
  } else {
    const ylo = Math.min(sv.y, r);
    const yhi = Math.max(sv.y, r);
    const proj = (px: number, py: number) => {
      const h = py - sv.y;
      if (Math.abs(h) < 1e-9) return px >= sv.x ? BIG : -BIG;
      return sv.x + ((px - sv.x) * dy) / h;
    };
    F.idx.forBox(xa, ylo, xb, yhi, (e) => {
      F.ops.n++;
      const p = e.a;
      const q = e.b;
      let t0 = 0;
      let t1 = 1;
      if (Math.abs(q.y - p.y) < 1e-12) {
        if (p.y <= ylo || p.y >= yhi) return;
      } else {
        const u = (ylo - p.y) / (q.y - p.y);
        const v = (yhi - p.y) / (q.y - p.y);
        t0 = Math.max(0, Math.min(u, v));
        t1 = Math.min(1, Math.max(u, v));
        if (t0 >= t1) return;
      }
      const X1 = proj(p.x + t0 * (q.x - p.x), p.y + t0 * (q.y - p.y));
      const X2 = proj(p.x + t1 * (q.x - p.x), p.y + t1 * (q.y - p.y));
      sh.push([Math.min(X1, X2), Math.max(X1, X2)]);
    });
  }
  const iv = mergeIntervals(sh);
  memo.push({ y: r, iv });
  return iv;
}

// Candidates in [a, b] that see the sample, as the contiguous run nearest to the sample's x.
// Visibility along the row line is computed once per sample as the complement of the "shadows"
// that wall edges cast from the sample onto the row line (closed shadows: grazing blocks).
function visibleRun(F: Frame, bay: Bay, o: Owned, C: Cand[], [a, b]: DemandRange, probeOnly: boolean): DemandRange | null {
  const s = o.s;
  if (bay.fast && o.inside) return [a, b];
  F.ops.n++;
  const sh = rowShadows(F, s, C[a].y);
  // the candidate nearest the sample's x
  let c0 = lowerIdx(C, a, b + 1, s.x);
  if (c0 > b) c0 = b;
  if (c0 > a && Math.abs(C[c0 - 1].x - s.x) < Math.abs(C[c0].x - s.x)) c0--;
  // the visible candidate nearest c0 by index (left first on a tie), found shadow by shadow
  let start = c0;
  const j = shadowAt(sh, C[c0].x);
  if (j >= 0) {
    let kL = -1;
    for (let jj = j; ; ) {
      const k = lowerIdx(C, a, b + 1, sh[jj][0]) - 1; // last candidate left of the shadow
      if (k < a) break;
      const in2 = shadowAt(sh, C[k].x);
      if (in2 < 0) {
        kL = k;
        break;
      }
      jj = in2;
    }
    let kR = -1;
    for (let jj = j; ; ) {
      const k = upperIdx(C, a, b + 1, sh[jj][1]); // first candidate right of the shadow
      if (k > b) break;
      const in2 = shadowAt(sh, C[k].x);
      if (in2 < 0) {
        kR = k;
        break;
      }
      jj = in2;
    }
    if (kL < 0 && kR < 0) return null;
    start = kL >= 0 && (kR < 0 || c0 - kL <= kR - c0) ? kL : kR;
  }
  if (probeOnly) return [start, start];
  // grow the run index by index until a shadowed candidate (a shadow with no candidate in it
  // does not break the run)
  const x0 = C[start].x;
  let l = a;
  let rr = b;
  for (let i = sh.length - 1; i >= 0; i--) {
    const [u, v] = sh[i];
    if (u >= x0) continue;
    const k = upperIdx(C, a, start + 1, v) - 1; // last candidate at or left of the shadow's end
    if (k >= a && C[k].x >= u) {
      l = k + 1;
      break;
    }
  }
  for (const [u, v] of sh) {
    if (v <= x0) continue;
    const k = lowerIdx(C, start, b + 1, u); // first candidate at or right of the shadow's start
    if (k <= b && C[k].x <= v) {
      rr = k - 1;
      break;
    }
  }
  const out: DemandRange = [l, rr];
  if (l > a || rr < b) out.shadowed = true;
  return out;
}

/** Index of the closed shadow interval containing x, or -1. */
function shadowAt(sh: Interval[], x: number): number {
  let lo = 0;
  let hi = sh.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sh[m][0] <= x) lo = m + 1;
    else hi = m;
  }
  const k = lo - 1;
  return k >= 0 && x <= sh[k][1] ? k : -1;
}

/** First index in [lo, hi) with C[i].x >= x (hi when none). */
function lowerIdx(C: Cand[], lo: number, hi: number, x: number): number {
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (C[m].x < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** First index in [lo, hi) with C[i].x > x (hi when none). */
function upperIdx(C: Cand[], lo: number, hi: number, x: number): number {
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (C[m].x <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

// --- Exact 1-D stabbing DP (§3.4 step 5) --------------------------------------------------------
// Candidates sorted by x; each demand is an index range that must contain a head. A transition
// i → k is valid iff no demand lies strictly between i and k, and (same visible run) the gap is
// within [Smin, S_row] for the same segment, ≥ Smin otherwise. Objective: (count, cost).

function stabDP(
  C: Cand[],
  demands: DemandRange[],
  I: RowInfo,
  R: Rule,
  prefs: Prefs,
  targets: number[],
  pattern: Pattern,
  grid: GridF | null,
  ops: Ops,
  cross: number[] = [],
): { idx: number[]; cost: number } | null {
  if (!demands.length) return { idx: [], cost: 0 };
  const n = C.length;
  if (!n) return null;
  const INF = 1 << 30;
  const suf = new Int32Array(n + 1).fill(INF);
  let maxA = -1;
  for (const [a, b] of demands) {
    if (b < suf[a]) suf[a] = b;
    if (a > maxA) maxA = a;
  }
  for (let i = n - 1; i >= 0; i--) if (suf[i + 1] < suf[i]) suf[i] = suf[i + 1];
  const runs = I.runs;
  const sp = prefs.spacing;
  const wp = prefs.wallDist;
  const gapCost = (g: number) => (sp ? (g - sp) ** 2 : g * g) / 1e6;
  const endCost = (e: number) => (wp ? (e - wp) ** 2 : 2 * e * e) / 1e6;
  const startC = (i: number) => endCost(C[i].x - runs[C[i].run][0]);
  const finC = (i: number) => endCost(runs[C[i].run][1] - C[i].x);
  const tsorted = targets.slice().sort((a, b) => a - b);
  const node = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let c = 0;
    if (tsorted.length) {
      let dmin = Infinity;
      for (const t of tsorted) {
        const d = Math.abs(t - C[i].x);
        if (d < dmin) dmin = d;
      }
      const w = pattern === "staggered" ? 4 : 0.6;
      c += (w * Math.min(dmin, 600) ** 2) / 1e6;
    }
    if (grid && !C[i].stop) c += 4;
    if (cross.length && !cross.some((x) => Math.abs(x - C[i].x) < 1)) c += OFF_CROSS;
    node[i] = c;
  }
  const cnt = new Int32Array(n).fill(INF);
  const cst = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const better = (c1: number, k1: number, c2: number, k2: number) => c1 < c2 || (c1 === c2 && k1 < k2 - 1e-12);
  const allMinB = suf[0];
  for (let i = 0; i < n && i <= allMinB; i++) {
    cnt[i] = 1;
    cst[i] = node[i] + startC(i);
  }
  const smin = R.Smin - TOL;
  const S = I.S + TOL;
  let steps = n;
  for (let i = 0; i < n; i++) {
    if (cnt[i] >= INF) continue;
    const lim = suf[i + 1];
    if (lim >= INF) continue; // nothing left to the right: ending here is optimal
    for (let k = i + 1; k <= lim && k < n; k++) {
      steps++;
      const g = C[k].x - C[i].x;
      const sameRun = C[k].run === C[i].run;
      if (sameRun && g < smin) continue;
      const sameSeg = C[k].seg === C[i].seg;
      if (sameSeg && g > S) {
        // jump to the next segment
        let kk = k;
        while (kk + 1 <= lim && kk + 1 < n && C[kk + 1].seg === C[i].seg) kk++;
        k = kk;
        continue;
      }
      const c = cst[i] + node[k] + (sameSeg ? gapCost(g) : finC(i) + startC(k));
      const ct = cnt[i] + 1;
      if (better(ct, c, cnt[k], cst[k])) {
        cnt[k] = ct;
        cst[k] = c;
        prev[k] = i;
      }
    }
  }
  let bi = -1;
  let bc = INF;
  let bcost = Infinity;
  for (let i = Math.max(0, maxA); i < n; i++) {
    if (cnt[i] >= INF) continue;
    const c = cst[i] + finC(i);
    if (better(cnt[i], c, bc, bcost)) {
      bi = i;
      bc = cnt[i];
      bcost = c;
    }
  }
  ops.n += steps;
  if (bi < 0) return null;
  const idx: number[] = [];
  for (let k = bi; k >= 0; k = prev[k]) idx.push(k);
  idx.reverse();
  return { idx, cost: bcost };
}

function bestGapFill(F: Frame, bay: Bay, bi: number, samples: BaySamples, rest: Owned[], spHeads: FHead[], R: Rule): Pt | null {
  const U = rest.length > 120 ? rest.filter((_, i) => i % Math.ceil(rest.length / 120) === 0) : rest;
  const smin = R.Smin + TOL;
  const reach = R.Rc - MU_COV;
  const reach2 = Math.max(R.Rc - MU_COV, R.Rc - MU_WALL) ** 2;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const o of U) {
    x0 = Math.min(x0, o.s.x);
    y0 = Math.min(y0, o.s.y);
    x1 = Math.max(x1, o.s.x);
    y1 = Math.max(y1, o.s.y);
  }
  const sp = new HeadGrid(spHeads, R.Smin + 1);
  let best: Pt | null = null;
  let bestN = 0;
  for (const o of samples.lat) {
    const p = o.s;
    if ((p.ix! + p.iy!) % 2) continue;
    if (p.x < x0 - reach || p.x > x1 + reach || p.y < y0 - reach || p.y > y1 + reach) continue;
    if (!admissibleAt(F, p, R)) continue;
    if (
      sp.near(p.x, p.y, (h) => {
        const dx = h.x - p.x;
        const dy = h.y - p.y;
        return dx * dx + dy * dy < smin * smin && F.idx.visible(p, h);
      })
    )
      continue;
    // exact skip: the samples within reach bound the count, and only a strictly larger count wins
    let inReach = 0;
    for (const u of U) {
      const dx = u.s.x - p.x;
      const dy = u.s.y - p.y;
      if (dx * dx + dy * dy <= reach2) inReach++;
    }
    if (inReach <= bestN) continue;
    const one: FHead = { x: p.x, y: p.y, bay: bi };
    let n = 0;
    for (const u of U) if (servedBy(F, bay, bi, u, one, R)) n++;
    if (n > bestN) {
      bestN = n;
      best = { x: p.x, y: p.y };
    }
  }
  return best;
}

// --- Preference report (Story 9.7) --------------------------------------------------------------

/**
 * Along-row gaps and run-end distances of the row heads (frame mm). Runs are cut by the zone's
 * walls and shafts only: bay seams are not walls, and columns carry no wall-distance rule.
 */
function rowMeasures(heads: readonly FHead[], F: Frame): { gaps: number[]; ends: number[] } {
  const walls = F.holes.filter((_, i) => !F.holeColumn[i]);
  const groups = new Map<string, FHead[]>();
  for (const h of heads) {
    if (h.kind !== "row" || typeof h.row !== "number") continue;
    const k = `${h.bay}:${h.row}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(h);
  }
  const gaps: number[] = [];
  const ends: number[] = [];
  for (const g of groups.values()) {
    const y = g[0].y;
    const runs = subtractIntervals(
      ringRowIntervals(F.outer, y),
      walls.flatMap((h) => ringRowIntervals(h, y)),
    );
    for (const [a, b] of runs) {
      const xs = g
        .filter((h) => h.x >= a - 1 && h.x <= b + 1)
        .map((h) => h.x)
        .sort((p, q) => p - q);
      if (!xs.length) continue;
      for (let i = 1; i < xs.length; i++) gaps.push(xs[i] - xs[i - 1]);
      ends.push(xs[0] - a, b - xs[xs.length - 1]);
    }
  }
  return { gaps, ends };
}

function prefFigure(requested: number, used: number, values: number[]): PreferenceFigure {
  if (!values.length) return { requested, used, achieved: null, met: true };
  const min = Math.round(Math.min(...values));
  const max = Math.round(Math.max(...values));
  const tol = prefTol(used);
  return { requested, used, achieved: { min, max }, met: values.every((v) => Math.abs(v - used) <= tol) };
}

// --- Helpers -------------------------------------------------------------------------------------

function fail(code: PlaceErrorCode, outline: Pt[], message: string, at: Pt): PlaceResult {
  return { ok: false, heads: [], notes: null, error: { code, where: [at], outline, message } };
}

function centroidOf(r: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of r) {
    x += p.x;
    y += p.y;
  }
  return { x: x / r.length, y: y / r.length };
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-12) return true;
    if (a[i] > b[i] + 1e-12) return false;
  }
  return false;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
