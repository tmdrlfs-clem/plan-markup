// Story 9.13 (M2 review, tests only): the strict reading of "max spacing" for a row layout.
//
// The oracle reads max spacing as each head's nearest visible peer (design H4), which cannot
// see two rows that are too far apart. For a layout the placer made, the rows are known (each
// head's rowId, the frame angle in the notes), so the strict reading can be measured directly:
//   along   the distance between consecutive heads of one row that see each other;
//   across  from each row head, straight across the rows (both ways), the distance to the
//           next row it reaches before a wall. No row before the wall: the wall rule applies.
// Written on its own: no oracle and no placer imports (types only come from the caller).

export type AuditPt = { x: number; y: number };
export type AuditHead = { id: string; x: number; y: number; rowId?: string };
export type RowAudit = { along: number; across: number; worst: { kind: "along" | "across"; a: string; b: string; distance: number } | null };

/** Parameter t in (0, 1] where p→q first crosses a→b, or null. */
function hit(p: AuditPt, q: AuditPt, a: AuditPt, b: AuditPt): number | null {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return t > 1e-9 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * The widest along-row and across-row spacing of a row layout (mm). `frameDeg` is the angle the
 * rows run at; `reach` is how far across the rows a next row is looked for (and half of it is
 * how far past a row's end heads that row still counts as facing a head).
 */
export function auditRows(rings: readonly (readonly AuditPt[])[], heads: readonly AuditHead[], frameDeg: number, reach: number): RowAudit {
  const edges = rings.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]] as const));
  const firstWall = (p: AuditPt, q: AuditPt) => edges.reduce((best, [a, b]) => Math.min(best, hit(p, q, a, b) ?? Infinity), Infinity);
  const a = (frameDeg * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const rows = new Map<string, (AuditHead & { u: number; v: number })[]>();
  for (const h of heads) {
    if (!h.rowId) continue;
    const list = rows.get(h.rowId) ?? [];
    list.push({ ...h, u: h.x * ux + h.y * uy, v: -h.x * uy + h.y * ux });
    rows.set(h.rowId, list);
  }
  const out: RowAudit = { along: 0, across: 0, worst: null };
  const note = (kind: "along" | "across", p: AuditHead, q: string, distance: number) => {
    if (distance > out[kind]) out[kind] = distance;
    if (!out.worst || distance > out.worst.distance) out.worst = { kind, a: p.id, b: q, distance };
  };
  for (const list of rows.values()) {
    list.sort((p, q) => p.u - q.u);
    for (let i = 0; i + 1 < list.length; i++) if (firstWall(list[i], list[i + 1]) === Infinity) note("along", list[i], list[i + 1].id, list[i + 1].u - list[i].u);
  }
  for (const [key, list] of rows) {
    for (const h of list) {
      for (const side of [1, -1]) {
        const far = { x: h.x - uy * side * 3 * reach, y: h.y + ux * side * 3 * reach };
        const wall = firstWall(h, far) * 3 * reach;
        let best = Infinity;
        let bestId = "";
        for (const [other, peers] of rows) {
          if (other === key) continue;
          const d = (peers[0].v - h.v) * side;
          if (d <= 1 || d >= wall || d >= best) continue;
          if (h.u < peers[0].u - reach / 2 || h.u > peers[peers.length - 1].u + reach / 2) continue;
          best = d;
          bestId = other;
        }
        if (Number.isFinite(best)) note("across", h, `row ${bestId}`, best);
      }
    }
  }
  return out;
}
