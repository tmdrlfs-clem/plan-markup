// Content-stream helpers shared by the .btx importer and the export engine
// (framework-free): number formatting, colour operators, ellipse and
// line-ending paths, literal-string escaping.

export type Box = [number, number, number, number];
export type Pt = [number, number];

/** Compact number for content streams (max 4 decimals, no exponent). */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10000) / 10000;
  if (Object.is(r, -0) || r === 0) return "0";
  let s = r.toFixed(4);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

export function nums(...ns: number[]): string {
  return ns.map(fmt).join(" ");
}

export function normalizeRect(r: number[] | undefined): Box | undefined {
  if (!r || r.length < 4) return undefined;
  const [a, b, c, d] = r as [number, number, number, number];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/** Colour operator for a /C or /IC array; undefined when empty/absent (transparent). */
export function colorOp(c: readonly number[] | undefined, stroke: boolean): string | undefined {
  if (!c || c.length === 0) return undefined;
  if (c.length === 1) return `${nums(c[0]!)} ${stroke ? "G" : "g"}`;
  if (c.length === 3) return `${nums(c[0]!, c[1]!, c[2]!)} ${stroke ? "RG" : "rg"}`;
  if (c.length === 4) return `${nums(c[0]!, c[1]!, c[2]!, c[3]!)} ${stroke ? "K" : "k"}`;
  return undefined;
}

// Bézier constant for a quarter ellipse.
export const KAPPA = 0.5522847498;

export function ellipsePath(x0: number, y0: number, x1: number, y1: number): string {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    `${nums(cx + rx, cy)} m`,
    `${nums(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry)} c`,
    `${nums(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy)} c`,
    `${nums(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry)} c`,
    `${nums(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy)} c`,
    "h",
  ].join("\n");
}

/** Size of a line ending for a stroke width (half-width of an arrow head). */
export function lineEndingSize(width: number): number {
  return Math.max(3 * width, 3);
}

/**
 * Path ops for a line ending at `tip`, pointing away from `from`. Returns
 * the ops and whether the shape is closed (closed endings are filled with
 * the interior colour), plus the points it touches (for bounds).
 */
export function lineEnding(
  style: string,
  tip: Pt,
  from: Pt,
  width: number,
): { ops: string; closed: boolean; points: Pt[] } | undefined {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular.
  const px = -uy;
  const py = ux;
  const size = lineEndingSize(width);
  const at = (along: number, across: number): Pt => [tip[0] + ux * along + px * across, tip[1] + uy * along + py * across];
  const p = (pt: Pt) => nums(pt[0], pt[1]);
  switch (style) {
    case "OpenArrow":
    case "ClosedArrow": {
      const a = at(-size * 2, size);
      const b = at(-size * 2, -size);
      const closed = style === "ClosedArrow";
      return { ops: `${p(a)} m\n${p(tip)} l\n${p(b)} l${closed ? "\nh" : ""}`, closed, points: [a, tip, b] };
    }
    case "ROpenArrow":
    case "RClosedArrow": {
      const a = at(size * 2, size);
      const b = at(size * 2, -size);
      const closed = style === "RClosedArrow";
      return { ops: `${p(a)} m\n${p(tip)} l\n${p(b)} l${closed ? "\nh" : ""}`, closed, points: [a, tip, b] };
    }
    case "Butt": {
      const a = at(0, size);
      const b = at(0, -size);
      return { ops: `${p(a)} m\n${p(b)} l`, closed: false, points: [a, b] };
    }
    case "Slash": {
      const a = at(size * 0.5, size);
      const b = at(-size * 0.5, -size);
      return { ops: `${p(a)} m\n${p(b)} l`, closed: false, points: [a, b] };
    }
    case "Square": {
      const s = size;
      const pts: Pt[] = [at(-s, s), at(s, s), at(s, -s), at(-s, -s)];
      return { ops: `${p(pts[0]!)} m\n${p(pts[1]!)} l\n${p(pts[2]!)} l\n${p(pts[3]!)} l\nh`, closed: true, points: pts };
    }
    case "Diamond": {
      const s = size;
      const pts: Pt[] = [at(0, s), at(s, 0), at(0, -s), at(-s, 0)];
      return { ops: `${p(pts[0]!)} m\n${p(pts[1]!)} l\n${p(pts[2]!)} l\n${p(pts[3]!)} l\nh`, closed: true, points: pts };
    }
    case "Circle":
      return {
        ops: ellipsePath(tip[0] - size, tip[1] - size, tip[0] + size, tip[1] + size),
        closed: true,
        points: [
          [tip[0] - size, tip[1] - size],
          [tip[0] + size, tip[1] + size],
        ],
      };
    default:
      return undefined; // None and unknown styles
  }
}

/** Escapes text for a literal string in WinAnsi (non-Latin-1 → "?"). */
export function literalText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (c < 0x20 || c > 0xff) out += c < 0x20 ? " " : "?";
    else if (c > 0x7e) out += `\\${c.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return out;
}
