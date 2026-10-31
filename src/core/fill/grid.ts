// Dynamic fill grid (Story 4.10, FR28, A12). Framework-free.
//
// The fill runs on a grid laid over a window of the page in PDF user space
// (the part in view), one cell per CSS px at the zoom it starts at. The
// drawing's linework is burned into it as walls: every cell a segment passes
// through, stepping in x or in y but never both at once (a 4-connected line),
// so a fill that spreads to its 8 neighbours cannot slip through a diagonal
// line between two cells. Refactored from the prototype's pixel mask
// (C:\bluebeam\tool\src\core\60-fill.js buildMask / burnLine), which read the
// rendered page instead.

type Point = { x: number; y: number };

/** Cells a grid may have (memory: walls, distances and fill per cell); a bigger window gets coarser cells. */
export const MAX_CELLS = 4_000_000;

export type FillGrid = {
  /** User space of the grid's corner (cell 0, 0 spans x0..x0 + cell, y0..y0 + cell). */
  x0: number;
  y0: number;
  /** Cell size in user units. */
  cell: number;
  w: number;
  h: number;
  /** 1 where a wall (a line of the drawing or a barrier) passes. */
  walls: Uint8Array;
};

export type Window = { x0: number; y0: number; x1: number; y1: number };

/** An empty grid over `window` with cells of `cell` user units (coarser when it would exceed `maxCells`). */
export function createGrid(window: Window, cell: number, maxCells = MAX_CELLS): FillGrid {
  const width = Math.max(0, window.x1 - window.x0);
  const height = Math.max(0, window.y1 - window.y0);
  let size = cell > 0 ? cell : 1;
  if ((width / size) * (height / size) > maxCells) size = Math.sqrt((width * height) / maxCells);
  const w = Math.max(1, Math.ceil(width / size));
  const h = Math.max(1, Math.ceil(height / size));
  return { x0: window.x0, y0: window.y0, cell: size, w, h, walls: new Uint8Array(w * h) };
}

/** The cell holding user space point `p`, or null outside the grid. */
export function cellAt(grid: FillGrid, p: Point): { x: number; y: number } | null {
  const x = Math.floor((p.x - grid.x0) / grid.cell);
  const y = Math.floor((p.y - grid.y0) / grid.cell);
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h ? { x, y } : null;
}

/** User space of grid corner coordinates (cell edges at integers). */
export function gridToUser(grid: FillGrid, gx: number, gy: number): Point {
  return { x: grid.x0 + gx * grid.cell, y: grid.y0 + gy * grid.cell };
}

/**
 * Clips the segment (grid units) to the grid's box (Liang–Barsky); null when it misses it.
 * Coordinates on the far edges are pulled just inside, so the last cell is still a cell.
 */
function clip(grid: FillGrid, ax: number, ay: number, bx: number, by: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: [number, number][] = [
    [-dx, ax],
    [dx, grid.w - ax],
    [-dy, ay],
    [dy, grid.h - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  const inside = (v: number, n: number) => Math.min(Math.max(v, 0), n - 1e-9);
  return [inside(ax + t0 * dx, grid.w), inside(ay + t0 * dy, grid.h), inside(ax + t1 * dx, grid.w), inside(ay + t1 * dy, grid.h)];
}

/** Marks every cell the segment (user space) passes through as a wall, 4-connected (Amanatides–Woo). */
export function burnSegment(grid: FillGrid, ax: number, ay: number, bx: number, by: number): void {
  const c = clip(grid, (ax - grid.x0) / grid.cell, (ay - grid.y0) / grid.cell, (bx - grid.x0) / grid.cell, (by - grid.y0) / grid.cell);
  if (!c) return;
  const [sx, sy, ex, ey] = c;
  let x = Math.floor(sx);
  let y = Math.floor(sy);
  const tx = Math.floor(ex);
  const ty = Math.floor(ey);
  const dx = ex - sx;
  const dy = ey - sy;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  // Parameter t (0..1 along the segment) at the next vertical / horizontal cell edge, and per cell.
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let maxX = dx !== 0 ? (dx > 0 ? x + 1 - sx : sx - x) * deltaX : Infinity;
  let maxY = dy !== 0 ? (dy > 0 ? y + 1 - sy : sy - y) * deltaY : Infinity;
  const walls = grid.walls;
  const limit = Math.abs(tx - x) + Math.abs(ty - y);
  walls[y * grid.w + x] = 1;
  // One step per cell crossed, in x or in y; a corner crossing takes both cells (x first).
  for (let n = 0; n < limit; n++) {
    if (maxX <= maxY) {
      x += stepX;
      maxX += deltaX;
    } else {
      y += stepY;
      maxY += deltaY;
    }
    if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) break;
    walls[y * grid.w + x] = 1;
  }
}

/** Burns `count` segments (x1, y1, x2, y2 each, user space) into the grid. */
export function burnSegments(grid: FillGrid, coords: ArrayLike<number>, count: number): void {
  const x1 = grid.x0 + grid.w * grid.cell;
  const y1 = grid.y0 + grid.h * grid.cell;
  for (let i = 0; i < count; i++) {
    const ax = coords[4 * i];
    const ay = coords[4 * i + 1];
    const bx = coords[4 * i + 2];
    const by = coords[4 * i + 3];
    // Wholly outside the window: nothing to burn.
    if (Math.max(ax, bx) < grid.x0 || Math.min(ax, bx) > x1 || Math.max(ay, by) < grid.y0 || Math.min(ay, by) > y1) continue;
    burnSegment(grid, ax, ay, bx, by);
  }
}

/** Burns a polyline (user space), such as a Length or Polylength measurement used as a barrier. */
export function burnPolyline(grid: FillGrid, points: readonly Point[]): void {
  for (let i = 1; i < points.length; i++) burnSegment(grid, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
}
