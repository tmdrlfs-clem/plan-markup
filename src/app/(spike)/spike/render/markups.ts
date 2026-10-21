// 500 seeded synthetic markups for the render spike (Story 2.3; throwaway).
// Generated in PDF user space (points, y up), stored in page space (y down) with
// a bbox for the rbush index. Drawn in one pass per frame, batched by style.
import RBush from "rbush";

export type MarkupKind = "rect" | "cloud" | "arrow" | "text" | "sprinkler";

export type Markup = {
  id: number;
  kind: MarkupKind;
  /** Page-space points (y down): rect/cloud use x,y,w,h; arrow uses x,y -> x2,y2; text/sprinkler anchor at x,y. */
  x: number;
  y: number;
  w: number;
  h: number;
  x2: number;
  y2: number;
  text: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS: MarkupKind[] = ["rect", "cloud", "arrow", "text", "sprinkler", "sprinkler"];

/**
 * `count` markups spread over a page of `width` x `height` points. User space is
 * converted to page space with y' = height - y (assumes /Rotate 0 and a MediaBox
 * at the origin, true for the spike fixtures).
 */
export function generateMarkups(count: number, width: number, height: number, seed = 0x500): Markup[] {
  const rnd = prng(seed);
  const out: Markup[] = [];
  const margin = Math.min(width, height) * 0.05;
  for (let id = 0; id < count; id++) {
    const kind = KINDS[Math.floor(rnd() * KINDS.length)];
    const ux = margin + rnd() * (width - 2 * margin);
    const uy = margin + rnd() * (height - 2 * margin);
    const x = ux;
    const y = height - uy;
    const m: Markup = { id, kind, x, y, w: 0, h: 0, x2: x, y2: y, text: "", minX: x, minY: y, maxX: x, maxY: y };
    if (kind === "rect" || kind === "cloud") {
      m.w = 20 + rnd() * 120;
      m.h = 15 + rnd() * 80;
      m.minX = x - 4;
      m.minY = y - 4;
      m.maxX = x + m.w + 4;
      m.maxY = y + m.h + 4;
    } else if (kind === "arrow") {
      const len = 30 + rnd() * 150;
      const ang = rnd() * Math.PI * 2;
      m.x2 = x + Math.cos(ang) * len;
      m.y2 = y + Math.sin(ang) * len;
      m.minX = Math.min(x, m.x2) - 6;
      m.minY = Math.min(y, m.y2) - 6;
      m.maxX = Math.max(x, m.x2) + 6;
      m.maxY = Math.max(y, m.y2) + 6;
    } else if (kind === "text") {
      m.text = `RFI ${id} CHECK HEAD SPACING`;
      m.minX = x;
      m.minY = y - 9;
      m.maxX = x + m.text.length * 5;
      m.maxY = y + 2;
    } else {
      // 66-style sprinkler symbol: small circle with a cross, 4 pt radius.
      m.minX = x - 5;
      m.minY = y - 5;
      m.maxX = x + 5;
      m.maxY = y + 5;
    }
    out.push(m);
  }
  return out;
}

export function indexMarkups(markups: readonly Markup[]): RBush<Markup> {
  const tree = new RBush<Markup>();
  tree.load(markups);
  return tree;
}

function cloudPath(ctx: CanvasRenderingContext2D, m: Markup): void {
  // Scalloped outline: arcs along each edge of the rectangle.
  const r = 6;
  const edges: [number, number, number, number][] = [
    [m.x, m.y, m.x + m.w, m.y],
    [m.x + m.w, m.y, m.x + m.w, m.y + m.h],
    [m.x + m.w, m.y + m.h, m.x, m.y + m.h],
    [m.x, m.y + m.h, m.x, m.y],
  ];
  ctx.moveTo(m.x, m.y);
  for (const [ax, ay, bx, by] of edges) {
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / (2 * r)));
    const dx = (bx - ax) / n;
    const dy = (by - ay) / n;
    const ang = Math.atan2(dy, dx);
    const rr = Math.hypot(dx, dy) / 2;
    for (let i = 0; i < n; i++) {
      const cx = ax + dx * (i + 0.5);
      const cy = ay + dy * (i + 0.5);
      ctx.arc(cx, cy, rr, ang + Math.PI, ang, false);
    }
  }
}

/**
 * Draws `visible` markups in page space; the caller sets the page->canvas
 * transform. `pxPerPt` keeps hairlines at least ~1 device px.
 */
export function drawMarkups(ctx: CanvasRenderingContext2D, visible: readonly Markup[], pxPerPt: number): void {
  const minW = 1 / pxPerPt;
  // Rectangles and clouds (red).
  ctx.strokeStyle = "#d92d20";
  ctx.lineWidth = Math.max(1.2, minW);
  ctx.beginPath();
  for (const m of visible) {
    if (m.kind === "rect") ctx.rect(m.x, m.y, m.w, m.h);
    else if (m.kind === "cloud") cloudPath(ctx, m);
  }
  ctx.stroke();
  // Arrows (blue): shafts and heads in one path.
  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = Math.max(1, minW);
  ctx.beginPath();
  for (const m of visible) {
    if (m.kind !== "arrow") continue;
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x2, m.y2);
    const ang = Math.atan2(m.y2 - m.y, m.x2 - m.x);
    for (const s of [-1, 1]) {
      ctx.moveTo(m.x2, m.y2);
      ctx.lineTo(m.x2 - 8 * Math.cos(ang + s * 0.4), m.y2 - 8 * Math.sin(ang + s * 0.4));
    }
  }
  ctx.stroke();
  // Sprinkler symbols (magenta): circle + cross.
  ctx.strokeStyle = "#c026d3";
  ctx.lineWidth = Math.max(0.8, minW);
  ctx.beginPath();
  for (const m of visible) {
    if (m.kind !== "sprinkler") continue;
    ctx.moveTo(m.x + 4, m.y);
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.moveTo(m.x - 4, m.y - 4);
    ctx.lineTo(m.x + 4, m.y + 4);
    ctx.moveTo(m.x - 4, m.y + 4);
    ctx.lineTo(m.x + 4, m.y - 4);
  }
  ctx.stroke();
  // Text labels (dark green). Skipped when smaller than ~3 device px (unreadable anyway).
  if (8 * pxPerPt >= 3) {
    ctx.fillStyle = "#166534";
    ctx.font = "8px sans-serif";
    for (const m of visible) if (m.kind === "text") ctx.fillText(m.text, m.x, m.y);
  }
}

/** Outline for the hovered markup (active layer). */
export function drawHighlight(ctx: CanvasRenderingContext2D, m: Markup, pxPerPt: number): void {
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2 / pxPerPt;
  ctx.setLineDash([4 / pxPerPt, 3 / pxPerPt]);
  ctx.strokeRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY);
  ctx.setLineDash([]);
}
