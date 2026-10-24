// Vector segments of a page for snapping (Story 4.1, FR29). Framework-free.
//
// Refactored from the founder's prototype (tool/src/core/30-vectors.js:
// extractVectors, Tx, Ap): the same idea (replay pdf.js's operator list,
// keep the transform stack, keep every straight piece) rebuilt for this app:
// typed, no globals, coordinates in PDF user space (points; the prototype
// worked in render pixels), Béziers flattened to a tolerance in points rather
// than a fixed 6 pieces, and every segment tagged with which of its points are
// real geometry (a corner or a line end) so a flattened curve offers no false
// endpoints or midpoints.
//
// What is a snap target:
// - stroked and filled paths (lines, polylines, rectangles, Béziers) under
//   the full CTM, form XObjects included;
// - NOT paths that are only used as a clip, or never painted (endPath);
// - NOT paths only filled in white (wipeouts, masks: invisible on the sheet);
// - NOT text: glyphs are drawn by showText (their outlines never appear as
//   paths in the operator list), image masks (rawFillPath) are skipped too.
// Geometry hidden by a clip is still a target (clipping the segments would
// need polygon clipping per path; drawings rarely clip their linework).
// Segments wholly outside `bounds` (the page box, when given) are dropped.

/** pdf.js OPS codes the extraction needs (pass pdf.js's OPS table). */
export type SnapOps = {
  save: number;
  restore: number;
  transform: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  constructPath: number;
  setFillRGBColor: number;
  setStrokeRGBColor: number;
  stroke: number;
  closeStroke: number;
  fill: number;
  eoFill: number;
  fillStroke: number;
  eoFillStroke: number;
  closeFillStroke: number;
  closeEOFillStroke: number;
  endPath: number;
  beginText: number;
  endText: number;
};

/** pdf.js path data opcodes (DrawOPS, pdf.js 6.4). */
export const PATH_OP = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

/** Segment flags: which points are real geometry. */
export const SEG_START_POINT = 1;
export const SEG_END_POINT = 2;
/** A straight segment of the drawing (its midpoint is a target); unset for a piece of a curve. */
export const SEG_STRAIGHT = 4;

export type Segments = {
  /** x1, y1, x2, y2 per segment, PDF user space (points). */
  coords: Float64Array;
  /** SEG_* flags per segment. */
  flags: Uint8Array;
  count: number;
  /** True when MAX_SEGMENTS was reached and the rest of the page was not read. */
  truncated: boolean;
};

export type ExtractOptions = {
  /** Largest distance (points) between a curve and its straight pieces. */
  curveTolerance?: number;
  /** Stop after this many segments (memory bound; `truncated` is set). */
  maxSegments?: number;
  /** [x0, y0, x1, y1] in user space: segments wholly outside are dropped. */
  bounds?: readonly [number, number, number, number];
  /** Called every CHECK_EVERY operators; return true to stop (cancelled). */
  shouldStop?: () => boolean;
};

export const DEFAULT_CURVE_TOLERANCE = 0.1;
export const MAX_SEGMENTS = 1_000_000;
/** Segments shorter than this (points) carry no geometry worth snapping to. */
const MIN_LENGTH = 0.01;
export const CHECK_EVERY = 4096;
const MAX_CURVE_PIECES = 64;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m ∘ n: n applied first, then m (PDF: the new matrix is concatenated in front). */
function concat(m: Matrix, n: readonly number[]): Matrix {
  return [
    n[0] * m[0] + n[1] * m[2],
    n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2],
    n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4],
    n[4] * m[1] + n[5] * m[3] + m[5],
  ];
}

class SegmentBuffer {
  coords: Float64Array;
  flags: Uint8Array;
  count = 0;
  truncated = false;
  private readonly max: number;
  private readonly bounds: readonly [number, number, number, number] | undefined;
  // Plain fields (no parameter properties): src/core also runs under Node's type stripping.
  constructor(max: number, bounds: readonly [number, number, number, number] | undefined) {
    this.max = max;
    this.bounds = bounds;
    this.coords = new Float64Array(4 * 4096);
    this.flags = new Uint8Array(4096);
  }

  push(ax: number, ay: number, bx: number, by: number, flags: number): void {
    if (this.count >= this.max) {
      this.truncated = true;
      return;
    }
    if (!(Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(bx) && Number.isFinite(by))) return;
    if (Math.abs(ax - bx) < MIN_LENGTH && Math.abs(ay - by) < MIN_LENGTH) return;
    const b = this.bounds;
    if (b && (Math.max(ax, bx) < b[0] || Math.min(ax, bx) > b[2] || Math.max(ay, by) < b[1] || Math.min(ay, by) > b[3])) return;
    if (this.count === this.flags.length) {
      const coords = new Float64Array(this.coords.length * 2);
      coords.set(this.coords);
      this.coords = coords;
      const flagsGrown = new Uint8Array(this.flags.length * 2);
      flagsGrown.set(this.flags);
      this.flags = flagsGrown;
    }
    const i = this.count++;
    this.coords[4 * i] = ax;
    this.coords[4 * i + 1] = ay;
    this.coords[4 * i + 2] = bx;
    this.coords[4 * i + 3] = by;
    this.flags[i] = flags;
  }

  result(): Segments {
    return {
      coords: this.coords.slice(0, 4 * this.count),
      flags: this.flags.slice(0, this.count),
      count: this.count,
      truncated: this.truncated,
    };
  }
}

/** How many straight pieces keep a cubic within `tolerance` of its curve (Wang's formula). */
export function cubicPieces(p: readonly number[], tolerance: number): number {
  // p: x0 y0 x1 y1 x2 y2 x3 y3 (already in user space).
  const ddx = Math.max(Math.abs(p[0] - 2 * p[2] + p[4]), Math.abs(p[2] - 2 * p[4] + p[6]));
  const ddy = Math.max(Math.abs(p[1] - 2 * p[3] + p[5]), Math.abs(p[3] - 2 * p[5] + p[7]));
  const n = Math.ceil(Math.sqrt((0.75 * Math.hypot(ddx, ddy)) / tolerance));
  return Math.min(MAX_CURVE_PIECES, Math.max(1, Number.isFinite(n) ? n : MAX_CURVE_PIECES));
}

/** A colour from pdf.js (hex "#rrggbb" in 6.4; [r, g, b] 0-255 in older builds) is white. */
function isWhite(color: unknown): boolean {
  if (typeof color === "string") return /^#?f{6}$/i.test(color.trim());
  if (Array.isArray(color) && color.length >= 3) return color[0] >= 255 && color[1] >= 255 && color[2] >= 255;
  return false;
}

/**
 * Reads the snap segments of one page from its operator list (pdf.js
 * `getOperatorList()`: fnArray, argsArray, with `ops` its OPS table).
 */
export function extractSegments(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: SnapOps, options: ExtractOptions = {}): Segments {
  const tolerance = options.curveTolerance ?? DEFAULT_CURVE_TOLERANCE;
  const out = new SegmentBuffer(options.maxSegments ?? MAX_SEGMENTS, options.bounds);
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let fillWhite = false;
  const fillStack: boolean[] = [];
  let inText = 0;

  for (let i = 0; i < fnArray.length; i++) {
    if (i % CHECK_EVERY === 0 && options.shouldStop?.()) break;
    if (out.truncated) break;
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    if (fn === ops.save) {
      stack.push(ctm);
      fillStack.push(fillWhite);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
      fillWhite = fillStack.pop() ?? false;
    } else if (fn === ops.transform) {
      if (args) ctm = concat(ctm, args as number[]);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      fillStack.push(fillWhite);
      const m = args?.[0] as number[] | null | undefined;
      if (m && m.length === 6) ctm = concat(ctm, m);
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
      fillWhite = fillStack.pop() ?? false;
    } else if (fn === ops.setFillRGBColor) {
      fillWhite = isWhite(args?.[0] ?? args);
    } else if (fn === ops.beginText) {
      inText++;
    } else if (fn === ops.endText) {
      inText = Math.max(0, inText - 1);
    } else if (fn === ops.constructPath && args && inText === 0) {
      const paint = args[0] as number;
      const stroked =
        paint === ops.stroke || paint === ops.closeStroke || paint === ops.fillStroke || paint === ops.eoFillStroke || paint === ops.closeFillStroke || paint === ops.closeEOFillStroke;
      const filled = paint === ops.fill || paint === ops.eoFill;
      // Clip-only or never-painted paths and white-only fills are invisible: not targets.
      if (!stroked && !(filled && !fillWhite)) continue;
      const data = (args[1] as unknown[] | undefined)?.[0];
      if (!data || typeof (data as ArrayLike<number>).length !== "number") continue;
      readPath(data as ArrayLike<number>, ctm, tolerance, out);
    }
  }
  return out.result();
}

/** Appends the straight pieces of one pdf.js path (DrawOPS data) under `m`. */
function readPath(d: ArrayLike<number>, m: Matrix, tolerance: number, out: SegmentBuffer): void {
  const X = (x: number, y: number) => m[0] * x + m[2] * y + m[4];
  const Y = (x: number, y: number) => m[1] * x + m[3] * y + m[5];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let open = false;
  for (let j = 0; j < d.length; ) {
    const op = d[j++];
    if (op === PATH_OP.moveTo) {
      cx = X(d[j], d[j + 1]);
      cy = Y(d[j], d[j + 1]);
      j += 2;
      sx = cx;
      sy = cy;
      open = true;
    } else if (op === PATH_OP.lineTo) {
      const nx = X(d[j], d[j + 1]);
      const ny = Y(d[j], d[j + 1]);
      j += 2;
      if (open) out.push(cx, cy, nx, ny, SEG_START_POINT | SEG_END_POINT | SEG_STRAIGHT);
      cx = nx;
      cy = ny;
    } else if (op === PATH_OP.curveTo || op === PATH_OP.quadraticCurveTo) {
      let p: number[];
      if (op === PATH_OP.curveTo) {
        p = [cx, cy, X(d[j], d[j + 1]), Y(d[j], d[j + 1]), X(d[j + 2], d[j + 3]), Y(d[j + 2], d[j + 3]), X(d[j + 4], d[j + 5]), Y(d[j + 4], d[j + 5])];
        j += 6;
      } else {
        // Quadratic as a cubic: control points 2/3 of the way to the quadratic one.
        const qx = X(d[j], d[j + 1]);
        const qy = Y(d[j], d[j + 1]);
        const ex = X(d[j + 2], d[j + 3]);
        const ey = Y(d[j + 2], d[j + 3]);
        j += 4;
        p = [cx, cy, cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey];
      }
      if (open) flattenCubic(p, tolerance, out);
      cx = p[6];
      cy = p[7];
    } else if (op === PATH_OP.closePath) {
      if (open) out.push(cx, cy, sx, sy, SEG_START_POINT | SEG_END_POINT | SEG_STRAIGHT);
      cx = sx;
      cy = sy;
    } else {
      return; // An opcode this version does not know: stop reading this path rather than misread it.
    }
  }
}

function flattenCubic(p: readonly number[], tolerance: number, out: SegmentBuffer): void {
  const n = cubicPieces(p, tolerance);
  let px = p[0];
  let py = p[1];
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const e = t * t * t;
    const nx = a * p[0] + b * p[2] + c * p[4] + e * p[6];
    const ny = a * p[1] + b * p[3] + c * p[5] + e * p[7];
    // Only the curve's own ends are endpoints; no piece has a meaningful midpoint.
    out.push(px, py, nx, ny, (k === 1 ? SEG_START_POINT : 0) | (k === n ? SEG_END_POINT : 0));
    px = nx;
    py = ny;
  }
}
