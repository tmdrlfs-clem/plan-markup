// Placer-side geometry kernel. Units: millimetres, y axis up. Pure functions, no DOM.
// The oracle has its own, separately written kernel (see oracle.js) on purpose.

export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function orientRing(r, ccw) {
  const a = ringArea(r);
  return (a > 0) === ccw ? r.slice() : r.slice().reverse();
}

export function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

export function pointInRing(p, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y);
      if (x > p.x) inside = !inside;
    }
  }
  return inside;
}

export function pointInRegion(p, outer, holes) {
  if (!pointInRing(p, outer)) return false;
  for (const h of holes) if (pointInRing(p, h)) return false;
  return true;
}

export function distPointSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y;
  return Math.sqrt(ex * ex + ey * ey);
}

function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

function onSeg(a, b, p) {
  return Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 &&
         Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9;
}

// True when segment a-b is blocked by edge c-d. Proper crossings block; the segment
// passing through an edge endpoint (grazing a corner) also blocks (conservative);
// a or b lying on the edge itself does not block.
export function segBlocked(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d);
  const o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  if (o1 === 0 && onSeg(a, b, c) && !same(c, a) && !same(c, b) && o3 !== 0 && o4 !== 0) return true;
  if (o2 === 0 && onSeg(a, b, d) && !same(d, a) && !same(d, b) && o3 !== 0 && o4 !== 0) return true;
  return false;
}
function same(p, q) { return Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9; }

export function segIntersectPoint(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { x: a.x + t * rx, y: a.y + t * ry };
}

export function rotatePt(p, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
export function rotateRing(r, ang) { return r.map(p => rotatePt(p, ang)); }

// Remove duplicate (<tol) and collinear (<tol off the chord) vertices.
export function cleanRing(r, tol = 5) {
  const pts = r.map(p => ({ x: p.x, y: p.y }));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const n = pts.length, p = pts[(i + n - 1) % n], q = pts[i], s = pts[(i + 1) % n];
      const dup = Math.hypot(q.x - p.x, q.y - p.y) < tol;
      const col = distPointSeg(q, p, s) < 0.5 && ((q.x - p.x) * (s.x - q.x) + (q.y - p.y) * (s.y - q.y)) > 0;
      if (dup || col) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}

// Douglas-Peucker on a closed ring (used only for decomposition of noisy outlines).
export function simplifyRing(r, tol) {
  if (r.length < 8) return r.slice();
  // split at the two farthest-apart vertices (deterministic)
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < r.length; i++) {
    const d = (r[i].x - r[0].x) ** 2 + (r[i].y - r[0].y) ** 2;
    if (d > best) { best = d; i1 = i; }
  }
  const chainA = r.slice(i0, i1 + 1), chainB = r.slice(i1).concat([r[0]]);
  const sa = dp(chainA, tol), sb = dp(chainB, tol);
  const out = sa.slice(0, -1).concat(sb.slice(0, -1));
  return out.length >= 3 ? cleanRing(out, 5) : r.slice();
}
function dp(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  let idx = -1, dmax = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distPointSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  const a = dp(pts.slice(0, idx + 1), tol), b = dp(pts.slice(idx), tol);
  return a.slice(0, -1).concat(b);
}

export function isConvex(r) {
  let sign = 0;
  for (let i = 0; i < r.length; i++) {
    const c = orient(r[i], r[(i + 1) % r.length], r[(i + 2) % r.length]);
    if (Math.abs(c) < 1e-6) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

// First self-intersection between any two edges of the given rings, or null.
export function findSelfIntersection(rings) {
  const edges = [];
  rings.forEach((r, ri) => r.forEach((p, i) => edges.push({ ri, i, n: r.length, a: p, b: r[(i + 1) % r.length] })));
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const f = edges[j];
      if (e.ri === f.ri && (f.i === e.i + 1 || (e.i === 0 && f.i === e.n - 1))) continue;
      if (Math.max(e.a.x, e.b.x) < Math.min(f.a.x, f.b.x) || Math.max(f.a.x, f.b.x) < Math.min(e.a.x, e.b.x)) continue;
      if (Math.max(e.a.y, e.b.y) < Math.min(f.a.y, f.b.y) || Math.max(f.a.y, f.b.y) < Math.min(e.a.y, e.b.y)) continue;
      const p = segIntersectPoint(e.a, e.b, f.a, f.b);
      if (p) return p;
    }
  }
  return null;
}

// Intervals of the horizontal line y inside a single ring (even-odd).
export function ringRowIntervals(r, y) {
  const xs = [];
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    if ((a.y > y) !== (b.y > y)) xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
  return out;
}

export function subtractIntervals(base, cuts) {
  let cur = base.map(v => v.slice());
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [a, b] of cur) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    cur = next;
  }
  return cur.filter(([a, b]) => b - a > 1e-6);
}

export function mergeIntervals(iv) {
  const s = iv.slice().sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const v of s) {
    if (out.length && v[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], v[1]);
    else out.push(v.slice());
  }
  return out;
}

// Uniform grid of segments for fast visibility / clearance queries.
export class SegIndex {
  constructor(segs, cell = 1000) {
    this.segs = segs; this.cell = cell; this.map = new Map(); this.stamp = 0;
    this.marks = new Int32Array(segs.length);
    segs.forEach((s, k) => {
      const i0 = Math.floor(Math.min(s.a.x, s.b.x) / cell), i1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
      const j0 = Math.floor(Math.min(s.a.y, s.b.y) / cell), j1 = Math.floor(Math.max(s.a.y, s.b.y) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = i * 100003 + j;
        let arr = this.map.get(key); if (!arr) this.map.set(key, arr = []);
        arr.push(k);
      }
    });
  }
  forBox(x0, y0, x1, y1, fn) {
    const c = this.cell; this.stamp++;
    const i0 = Math.floor(x0 / c), i1 = Math.floor(x1 / c), j0 = Math.floor(y0 / c), j1 = Math.floor(y1 / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const arr = this.map.get(i * 100003 + j); if (!arr) continue;
      for (const k of arr) {
        if (this.marks[k] === this.stamp) continue;
        this.marks[k] = this.stamp;
        if (fn(this.segs[k]) === true) return true;
      }
    }
    return false;
  }
  visible(a, b) {
    return !this.forBox(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y),
      s => segBlocked(a, b, s.a, s.b));
  }
  clearance(p, r) {
    let best = Infinity;
    this.forBox(p.x - r, p.y - r, p.x + r, p.y + r, s => { const d = distPointSeg(p, s.a, s.b); if (d < best) best = d; });
    return best;
  }
}
