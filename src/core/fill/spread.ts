// Dynamic fill spread (Story 4.10, FR28, NFR5, A12). Framework-free.
//
// The fill spreads from its seeds over the grid's open cells in a near circle
// (chamfer distances: 10 a side step, 14 a diagonal one), one band of
// distance per call, so the caller can show it growing every animation frame.
// Distances are settled with Dial's bucket queue (16 buckets suffice: a step
// costs at most 14). Walls stop it; a fill that reaches the grid's border has
// leaked (the room is open, or bigger than the window) and stops.
//
// Brushes: paint fills the cells under it (walls too: it bridges a gap) and
// lets the spread carry on from them; erase empties them and keeps the spread
// out until they are painted again. Every hold, paint or erase is a stroke;
// undoing one restores the cells it changed.
//
// Refactored from the prototype (C:\bluebeam\tool\src\core\60-fill.js:
// fillSeed / fillGrow / fillPaintDisc / fillEraseDisc / fillUndoStroke).

import type { FillGrid } from "./grid";

const SIDE = 10;
const DIAGONAL = 14;
const BUCKETS = 16;
/** Not reached. */
const FAR = 0xffffffff;
/** Strokes kept for undo. */
export const MAX_STROKES = 60;

export type Brush = "grow" | "paint" | "erase";
export type Dirty = { x0: number; y0: number; x1: number; y1: number };

type Stroke = { brush: Brush; cells: number[]; leakedBefore: boolean };

export class FillSpread {
  readonly grid: FillGrid;
  /** 1 where filled. */
  readonly filled: Uint8Array;
  /** 1 where erased (a barrier to the spread; erased islands become holes). */
  readonly erased: Uint8Array;
  private readonly dist: Uint32Array;
  private buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  /** The distance band settled next. */
  private level = 0;
  private strokes: Stroke[] = [];
  private stroke: Stroke | null = null;
  /** Filled cells. */
  count = 0;
  /** The fill reached the border: it stops until a stroke is undone or erased. */
  leaked = false;

  constructor(grid: FillGrid) {
    this.grid = grid;
    const n = grid.w * grid.h;
    this.filled = new Uint8Array(n);
    this.erased = new Uint8Array(n);
    this.dist = new Uint32Array(n).fill(FAR);
  }

  get strokeCount(): number {
    return this.strokes.length;
  }

  /** Starts a stroke (a hold, a paint or an erase); the previous one ends. */
  beginStroke(brush: Brush): void {
    this.endStroke();
    this.stroke = { brush, cells: [], leakedBefore: this.leaked };
  }

  /** Ends the stroke in progress; a stroke that changed nothing is not kept. */
  endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s || s.cells.length === 0) return;
    this.strokes.push(s);
    if (this.strokes.length > MAX_STROKES) this.strokes.shift();
  }

  private open(i: number): boolean {
    return this.grid.walls[i] === 0 && this.erased[i] === 0;
  }

  private push(i: number, d: number): void {
    this.dist[i] = d;
    this.buckets[d % BUCKETS].push(i);
  }

  /** Seeds the spread at cell (x, y) when it is open and not reached yet; true when it did. */
  seed(x: number, y: number): boolean {
    const { w, h } = this.grid;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = y * w + x;
    if (!this.open(i) || this.dist[i] !== FAR) return false;
    this.push(i, this.level);
    return true;
  }

  /** Seeds every open cell along the line between two cells (a drag while holding). */
  seedLine(ax: number, ay: number, bx: number, by: number): void {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let t = 0; t <= n; t++) this.seed(Math.round(ax + ((bx - ax) * t) / n), Math.round(ay + ((by - ay) * t) / n));
  }

  private fill(i: number, dirty: Dirty, w: number): void {
    this.filled[i] = 1;
    this.count++;
    this.stroke?.cells.push(i);
    const y = (i / w) | 0;
    const x = i - y * w;
    if (x < dirty.x0) dirty.x0 = x;
    if (x > dirty.x1) dirty.x1 = x;
    if (y < dirty.y0) dirty.y0 = y;
    if (y > dirty.y1) dirty.y1 = y;
  }

  /**
   * Spreads by `band` distance units (10 per cell) and returns the cells it filled as a box
   * (null when none). Stops at a leak.
   */
  step(band: number): Dirty | null {
    if (this.leaked) return null;
    const { w, h } = this.grid;
    const dist = this.dist;
    const dirty: Dirty = { x0: w, y0: h, x1: -1, y1: -1 };
    const target = this.level + Math.max(1, Math.round(band));
    const relax = (j: number, d: number) => {
      if (d < dist[j] && this.open(j)) this.push(j, d);
    };
    for (; this.level <= target && !this.leaked; this.level++) {
      const c = this.level;
      const bucket = this.buckets[c % BUCKETS];
      if (bucket.length === 0) continue;
      this.buckets[c % BUCKETS] = [];
      for (const i of bucket) {
        if (dist[i] !== c) continue; // settled earlier at a shorter distance
        const y = (i / w) | 0;
        const x = i - y * w;
        if (!this.filled[i]) {
          this.fill(i, dirty, w);
          if (x === 0 || y === 0 || x === w - 1 || y === h - 1) this.leaked = true;
        }
        if (x > 0) relax(i - 1, c + SIDE);
        if (x < w - 1) relax(i + 1, c + SIDE);
        if (y > 0) relax(i - w, c + SIDE);
        if (y < h - 1) relax(i + w, c + SIDE);
        if (x > 0 && y > 0) relax(i - w - 1, c + DIAGONAL);
        if (x < w - 1 && y > 0) relax(i - w + 1, c + DIAGONAL);
        if (x > 0 && y < h - 1) relax(i + w - 1, c + DIAGONAL);
        if (x < w - 1 && y < h - 1) relax(i + w + 1, c + DIAGONAL);
      }
    }
    return dirty.x1 < 0 ? null : dirty;
  }

  /** True while the spread has cells waiting (it is still growing). */
  get growing(): boolean {
    return !this.leaked && this.buckets.some((b) => b.length > 0);
  }

  /** Cells of a round brush of radius `r` cells at (cx, cy). */
  private brushCells(cx: number, cy: number, r: number, visit: (i: number) => void): void {
    const { w, h } = this.grid;
    const R = Math.max(1, Math.round(r));
    for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++) {
      const span = Math.floor(Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy))));
      for (let x = Math.max(0, cx - span); x <= Math.min(w - 1, cx + span); x++) visit(y * w + x);
    }
  }

  /** Paints fill under the brush; the spread carries on from it (it bridges walls). Returns the changed box. */
  paint(cx: number, cy: number, r: number): Dirty | null {
    const w = this.grid.w;
    const dirty: Dirty = { x0: this.grid.w, y0: this.grid.h, x1: -1, y1: -1 };
    this.brushCells(cx, cy, r, (i) => {
      this.erased[i] = 0;
      if (this.filled[i]) return;
      this.fill(i, dirty, w);
      this.push(i, this.level);
    });
    if (dirty.x1 >= 0) this.leaked = false;
    return dirty.x1 < 0 ? null : dirty;
  }

  /** Erases fill under the brush and keeps the spread out of it. Returns the changed box. */
  erase(cx: number, cy: number, r: number): Dirty | null {
    const w = this.grid.w;
    const dirty: Dirty = { x0: this.grid.w, y0: this.grid.h, x1: -1, y1: -1 };
    this.brushCells(cx, cy, r, (i) => {
      if (!this.filled[i] || this.erased[i]) return;
      this.filled[i] = 0;
      this.erased[i] = 1;
      this.dist[i] = FAR;
      this.count--;
      this.stroke?.cells.push(i);
      const y = (i / w) | 0;
      const x = i - y * w;
      dirty.x0 = Math.min(dirty.x0, x);
      dirty.x1 = Math.max(dirty.x1, x);
      dirty.y0 = Math.min(dirty.y0, y);
      dirty.y1 = Math.max(dirty.y1, y);
    });
    if (dirty.x1 >= 0) this.leaked = false;
    return dirty.x1 < 0 ? null : dirty;
  }

  /**
   * Undoes the last stroke (the one in progress first): its filled cells empty again, its
   * erased cells fill again. The spread's frontier is dropped (an undone fill cannot creep
   * back); the next hold seeds it again and spreads through the fill already there. False
   * when there is nothing to undo.
   */
  undoStroke(): boolean {
    this.endStroke();
    const s = this.strokes.pop();
    if (!s) return false;
    for (const i of s.cells) {
      if (s.brush === "erase") {
        this.erased[i] = 0;
        if (!this.filled[i]) {
          this.filled[i] = 1;
          this.count++;
        }
      } else if (this.filled[i]) {
        this.filled[i] = 0;
        this.count--;
      }
    }
    this.dist.fill(FAR);
    this.buckets = Array.from({ length: BUCKETS }, () => []);
    this.level = 0;
    this.leaked = s.leakedBefore;
    return true;
  }
}
