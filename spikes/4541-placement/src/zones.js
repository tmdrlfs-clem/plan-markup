// Sample zones for the placement spike. Real millimetres, y axis up, zone-local coordinates.
// `hand` = the hand-worked count from design §5 where one exists (draft-0 figures; see README for
// the v1 recomputation). Each sample may hold several zones (open-plan pair).

const P = (...xy) => { const out = []; for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] }); return out; };
const rect = (x0, y0, x1, y1) => P(x0, y0, x1, y0, x1, y1, x0, y1);
const sq = (cx, cy, s) => rect(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
const col = ring => ({ kind: 'column', ring });
const shaft = ring => ({ kind: 'shaft', ring });
const rot = (pts, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(p => ({ x: Math.round((p.x * c - p.y * s) * 1000) / 1000, y: Math.round((p.x * s + p.y * c) * 1000) / 1000 })); };

// Raster stair-step trace (dynamic-fill style): every edge of the ring is redrawn as axis-parallel
// steps of px mm, the way a trace of a slightly skewed wall comes out.
function staircase(ring, px = 30) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    out.push({ x: a.x, y: a.y });
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const n = Math.round(Math.abs(horiz ? dy : dx) / px);
    for (let k = 1; k <= n; k++) {
      const t = (k - 0.5) / n;
      if (horiz) { out.push({ x: a.x + dx * t, y: a.y + dy * (k - 1) / n }); out.push({ x: a.x + dx * t, y: a.y + dy * k / n }); }
      else { out.push({ x: a.x + dx * (k - 1) / n, y: a.y + dy * t }); out.push({ x: a.x + dx * k / n, y: a.y + dy * t }); }
    }
    if (n > 0) { // snap the vertex onto the last step so the trace stays axis-parallel
      const l = out[out.length - 1];
      if (horiz) out.push({ x: b.x, y: l.y }); else out.push({ x: l.x, y: b.y });
    }
  }
  const r3 = v => Math.round(v * 1000) / 1000;
  const ded = [];
  for (const p of out) { const l = ded[ded.length - 1]; if (!l || Math.hypot(l.x - p.x, l.y - p.y) > 0.5) ded.push({ x: r3(p.x), y: r3(p.y) }); }
  if (Math.hypot(ded[0].x - ded[ded.length - 1].x, ded[0].y - ded[ded.length - 1].y) < 0.5) ded.pop();
  return ded;
}

const Z2 = P(0, 0, 12000, 0, 12000, 4000, 6000, 4000, 6000, 9000, 0, 9000);
const Z4 = P(0, 0, 12000, 0, 12000, 3000, 0, 9000);

export const SAMPLES = [
  { id: 'Z1', name: 'Z1 Rectangle 10 × 6 m', group: 'NFR9',
    zones: [{ zoneId: 'Z1', hazard: 'OH1', outer: rect(0, 0, 10000, 6000) }],
    hand: { OH1: 6, ELH: 6 }, alsoHazards: ['ELH'] },
  { id: 'Z2', name: 'Z2 L-shape', group: 'NFR9',
    zones: [{ zoneId: 'Z2', hazard: 'ELH', outer: Z2 }],
    hand: { OH1: 8, ELH: 6 }, alsoHazards: ['OH1'] },
  { id: 'Z3', name: 'Z3 Right triangle 8 × 6 m', group: 'NFR9',
    zones: [{ zoneId: 'Z3', hazard: 'ELH', outer: P(0, 0, 8000, 0, 0, 6000) }],
    hand: { OH1: 5, ELH: 3 }, alsoHazards: ['OH1'] },
  { id: 'Z4', name: 'Z4 Diagonal wall', group: 'NFR9',
    zones: [{ zoneId: 'Z4', hazard: 'ELH', outer: Z4 }],
    hand: { OH1: 8, ELH: 5 }, alsoHazards: ['OH1'] },
  { id: 'Z4r', name: 'Z4r Diagonal wall, rotated 30°', group: 'NFR9',
    zones: [{ zoneId: 'Z4r', hazard: 'ELH', outer: rot(Z4, 30) }],
    hand: { OH1: 8, ELH: 5 }, alsoHazards: ['OH1'] },
  { id: 'Z5', name: 'Z5 Corridor 20 × 1.6 m', group: 'NFR9',
    zones: [{ zoneId: 'Z5', hazard: 'OH1', outer: rect(0, 0, 20000, 1600) }],
    hand: { OH1: 5, ELH: 5 }, alsoHazards: ['ELH'] },
  { id: 'Z5r', name: 'Z5 Corridor rotated 45°', group: 'NFR9',
    zones: [{ zoneId: 'Z5r', hazard: 'OH1', outer: rot(rect(0, 0, 20000, 1600), 45) }],
    hand: { OH1: 5 } },
  { id: 'Z5L', name: 'Z5 L-corridor 1.6 m', group: 'NFR9',
    zones: [{ zoneId: 'Z5L', hazard: 'ELH', outer: P(0, 0, 20000, 0, 20000, 1600, 1600, 1600, 1600, 12000, 0, 12000) }] },
  { id: 'Z6', name: 'Z6 Hall with 3 columns', group: 'named',
    zones: [{ zoneId: 'Z6', hazard: 'OH1', outer: rect(0, 0, 16800, 9000), holes: [sq(4200, 4500, 600), sq(8400, 4500, 600), sq(12600, 4500, 600)].map(col) }],
    hand: { OH1: 15 } },
  { id: 'Z7', name: 'Z7 Room around a 4 m shaft', group: 'named',
    zones: [{ zoneId: 'Z7', hazard: 'OH1', outer: rect(0, 0, 12000, 12000), holes: [shaft(rect(4000, 4000, 8000, 8000))] }] },
  { id: 'Z8', name: 'Z8 Noisy L (stair-step trace)', group: 'named',
    zones: [{ zoneId: 'Z8', hazard: 'ELH', outer: staircase(rot(Z2, 1)) }],
    hand: { ELH: 6 } },
  { id: 'U', name: 'U-shape', group: 'shapes',
    zones: [{ zoneId: 'U', hazard: 'ELH', outer: P(0, 0, 14000, 0, 14000, 10000, 10000, 10000, 10000, 4000, 4000, 4000, 4000, 10000, 0, 10000) }] },
  { id: 'T', name: 'T-shape', group: 'shapes',
    zones: [{ zoneId: 'T', hazard: 'OH1', outer: P(5000, 0, 10000, 0, 10000, 8000, 15000, 8000, 15000, 12000, 0, 12000, 0, 8000, 5000, 8000) }] },
  { id: 'R2', name: 'Meeting room, 45° splay', group: 'shapes',
    zones: [{ zoneId: 'R2', hazard: 'ELH', outer: P(0, 0, 7200, 0, 7200, 3600, 5400, 5400, 0, 5400) }],
    hand: { ELH: 4 } },
  { id: 'C25', name: 'Corridor 18 × 2.5 m', group: 'shapes',
    zones: [{ zoneId: 'C25', hazard: 'ELH', outer: rect(0, 0, 18000, 2500) }] },
  { id: 'SMALL', name: 'Small office 3 × 2.8 m (1 head)', group: 'shapes',
    zones: [{ zoneId: 'SMALL', hazard: 'ELH', outer: rect(0, 0, 3000, 2800) }], hand: { ELH: 1 } },
  { id: 'OCT', name: 'Irregular 8-sided room', group: 'shapes',
    zones: [{ zoneId: 'OCT', hazard: 'OH1', outer: P(0, 0, 8200, 0, 10400, 2600, 10400, 6200, 7600, 8800, 3000, 8800, 800, 6900, 0, 3500) }] },
  { id: 'COLS', name: 'Office floor with 6 columns', group: 'shapes',
    zones: [{ zoneId: 'COLS', hazard: 'ELH', outer: rect(0, 0, 21600, 14400),
      holes: [5400, 10800, 16200].flatMap(x => [4800, 9600].map(y => col(sq(x, y, 450)))) }] },
  { id: 'OPEN', name: 'Open plan: office (ELH) + kitchen (OH1)', group: 'shapes',
    zones: [
      { zoneId: 'OFFICE', hazard: 'ELH', outer: rect(0, 0, 12000, 9000), openEdges: [{ a: { x: 12000, y: 0 }, b: { x: 12000, y: 9000 } }] },
      { zoneId: 'KITCHEN', hazard: 'OH1', outer: rect(12000, 0, 18000, 9000), openEdges: [{ a: { x: 12000, y: 0 }, b: { x: 12000, y: 9000 } }] },
    ] },
  { id: 'STAG', name: 'Store room, staggered pattern', group: 'shapes',
    zones: [{ zoneId: 'STAG', hazard: 'OH2', pattern: 'staggered', outer: rect(0, 0, 14000, 9000) }] },
  { id: 'TILE', name: 'Tiled office, 1200 × 600 grid (preferred)', group: 'shapes',
    zones: [{ zoneId: 'TILE', hazard: 'ELH', outer: rect(0, 0, 9600, 7200),
      grid: { angleDeg: 0, pitchX: 1200, pitchY: 600, originX: 0, originY: 0, mode: 'preferred' } }] },
  { id: 'Z9', name: 'Z9 Tile room (required)', group: 'named',
    zones: [{ zoneId: 'Z9', hazard: 'OH1', outer: rect(0, 0, 7200, 6000),
      grid: { angleDeg: 0, pitchX: 1200, pitchY: 600, originX: 0, originY: 0, mode: 'required' } }] },
  { id: 'R1', name: 'R1 Perimeter office L (387 m²)', group: 'named',
    zones: [{ zoneId: 'R1', hazard: 'ELH',
      outer: P(0, 0, 30000, 0, 30000, 22000, 21000, 22000, 21000, 9000, 0, 9000),
      holes: [[4200, 1500], [12600, 1500], [21000, 1500], [28500, 1500], [28500, 9600], [28500, 18000]].map(([x, y]) => col(sq(x, y, 600))),
      grid: { angleDeg: 0, pitchX: 1200, pitchY: 600, originX: 0, originY: 0, mode: 'preferred' } }] },
  { id: 'Z10', name: 'Z10 Too narrow (6 m × 90 mm)', group: 'infeasible', infeasible: true,
    zones: [{ zoneId: 'Z10', hazard: 'ELH', outer: rect(0, 0, 6000, 90) }] },
  { id: 'BOW', name: 'Invalid outline (bow-tie)', group: 'infeasible', infeasible: true,
    zones: [{ zoneId: 'BOW', hazard: 'ELH', outer: P(0, 0, 6000, 4000, 6000, 0, 0, 4000) }] },
];
