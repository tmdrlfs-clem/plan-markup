// Generates the synthetic 50 MB A0 vector fixture for the render spike (Story 2.3):
// fixtures/private/pdf/synthetic-a0-50mb.pdf (git-ignored like every private fixture).
//
// A0 landscape, 3370 x 2384 pt, one page. Content mimics a dense reflected
// ceiling plan exported from CAD: a ceiling grid broken into short segments,
// double-line walls, hatched zones, light fittings as circles (Bezier arcs),
// SHX-style "exploded" text (glyphs as polylines, the main source of tiny
// segments in real CAD PDFs) and some real Helvetica text. Content is split over
// several Flate-compressed streams. Deterministic: a seeded PRNG and fixed zlib
// level, so the same Node/zlib produces the same bytes.
//
// Usage: node scripts/spike-render/make-a0.mjs [--target-mb 50] [--out path]
// Prints size and operator counts (JSON) on stdout.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const W = 3370;
const H = 2384;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** mulberry32: small, fast, deterministic. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Three decimals, like most CAD exporters: keeps the streams realistically hard to compress.
const f = (n) => (Math.round(n * 1000) / 1000).toString();

/** Collects one content stream and counts path-construction and painting operators. */
class Content {
  /** `rnd` adds sub-point jitter to m/l/c coordinates (real CAD output is never perfectly regular). */
  constructor(rnd = () => 0.5) {
    this.rnd = rnd;
    this.parts = [];
    this.ops = { m: 0, l: 0, c: 0, re: 0, S: 0, f: 0, h: 0, text: 0, other: 0 };
  }
  raw(s, kind = "other") {
    this.parts.push(s);
    this.ops[kind] += 1;
  }
  j(n) { return n + (this.rnd() - 0.5) * 0.08; }
  m(x, y) { this.parts.push(`${f(this.j(x))} ${f(this.j(y))} m`); this.ops.m++; }
  l(x, y) { this.parts.push(`${f(this.j(x))} ${f(this.j(y))} l`); this.ops.l++; }
  c(a, b, c, d, e, g) { this.parts.push(`${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)} c`); this.ops.c++; }
  re(x, y, w, h) { this.parts.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re`); this.ops.re++; }
  S() { this.parts.push("S"); this.ops.S++; }
  fill() { this.parts.push("f"); this.ops.f++; }
  h() { this.parts.push("h"); this.ops.h++; }
  text() { return this.parts.join("\n"); }
  get pathOps() {
    const o = this.ops;
    return o.m + o.l + o.c + o.re + o.S + o.f + o.h;
  }
}

/** Circle of radius r as 4 Bezier arcs. */
function circle(cs, cx, cy, r) {
  const k = 0.5523 * r;
  cs.m(cx + r, cy);
  cs.c(cx + r, cy + k, cx + k, cy + r, cx, cy + r);
  cs.c(cx - k, cy + r, cx - r, cy + k, cx - r, cy);
  cs.c(cx - r, cy - k, cx - k, cy - r, cx, cy - r);
  cs.c(cx + k, cy - r, cx + r, cy - k, cx + r, cy);
  cs.h();
}

// Simple stroke "font": every glyph is 2-4 polylines on a 4x6 grid (like SHX).
const GLYPHS = [
  [[0, 0, 0, 6, 4, 6, 4, 0, 0, 0]],
  [[0, 0, 4, 0], [2, 0, 2, 6, 1, 5]],
  [[0, 6, 4, 6, 4, 3, 0, 3, 0, 0, 4, 0]],
  [[0, 6, 4, 6, 4, 0, 0, 0], [0, 3, 4, 3]],
  [[0, 6, 0, 3, 4, 3], [3, 6, 3, 0]],
  [[4, 6, 0, 6, 0, 3, 4, 3, 4, 0, 0, 0]],
  [[0, 0, 0, 6, 4, 6], [0, 3, 4, 3, 4, 0, 0, 0]],
  [[0, 6, 4, 6, 1, 0]],
  [[0, 0, 0, 6, 4, 6, 4, 0, 0, 0], [0, 3, 4, 3]],
  [[0, 0, 2, 6, 4, 0], [1, 3, 3, 3]],
];

function shxText(cs, x, y, size, n, rnd) {
  const s = size / 6;
  for (let i = 0; i < n; i++) {
    const g = GLYPHS[Math.floor(rnd() * GLYPHS.length)];
    const gx = x + i * 5.5 * s;
    for (const poly of g) {
      cs.m(gx + poly[0] * s, y + poly[1] * s);
      for (let j = 2; j < poly.length; j += 2) cs.l(gx + poly[j] * s, y + poly[j + 1] * s);
    }
  }
  cs.S();
}

/** One "storey" pass over the whole sheet: a full RCP drawn with jitter `layer`. */
function drawLayer(cs, layer, rnd) {
  const x0 = 120 + layer * 0.7;
  const y0 = 110 + layer * 0.5;
  const x1 = W - 420;
  const y1 = H - 110;
  // Ceiling grid 600 x 1200 at 1:100 => ~17 x 34 pt, split into short segments.
  cs.raw("0.25 w 0.55 G", "other");
  const gx = 17.01;
  const gy = 34.02;
  for (let x = x0; x <= x1; x += gx) {
    for (let y = y0; y < y1; y += gy) {
      cs.m(x, y);
      cs.l(x, Math.min(y + gy, y1));
    }
  }
  cs.S();
  for (let y = y0; y <= y1; y += gy) {
    for (let x = x0; x < x1; x += gx) {
      cs.m(x, y);
      cs.l(Math.min(x + gx, x1), y);
    }
  }
  cs.S();
  // Rooms: double-line walls on a jittered 10 x 7 grid.
  cs.raw("0.9 w 0 G", "other");
  const cols = 10;
  const rows = 7;
  const rw = (x1 - x0) / cols;
  const rh = (y1 - y0) / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const rx = x0 + i * rw + rnd() * 4;
      const ry = y0 + j * rh + rnd() * 4;
      cs.re(rx, ry, rw - 6, rh - 6);
      cs.re(rx + 3, ry + 3, rw - 12, rh - 12);
    }
  }
  cs.S();
  // Hatched zones (diagonal hatch as individual segments) in a third of the rooms.
  cs.raw("0.2 w 0.35 G", "other");
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (rnd() > 0.33) continue;
      const rx = x0 + i * rw + 8;
      const ry = y0 + j * rh + 8;
      const w = rw * 0.45;
      const h = rh * 0.45;
      for (let t = 0; t < w + h; t += 3.5) {
        const ax = rx + Math.min(t, w);
        const ay = ry + Math.max(0, t - w);
        const bx = rx + Math.max(0, t - h);
        const by = ry + Math.min(t, h);
        cs.m(ax, ay);
        cs.l(bx, by);
      }
    }
  }
  cs.S();
  // Light fittings and diffusers: circles and squares with crosses on the grid.
  cs.raw("0.35 w 0 G", "other");
  for (let x = x0 + gx / 2; x < x1; x += gx * 3) {
    for (let y = y0 + gy / 2; y < y1; y += gy * 2) {
      const r = rnd();
      if (r < 0.45) circle(cs, x, y, 3.2);
      else if (r < 0.6) {
        cs.re(x - 4, y - 4, 8, 8);
        cs.m(x - 4, y - 4);
        cs.l(x + 4, y + 4);
        cs.m(x - 4, y + 4);
        cs.l(x + 4, y - 4);
      }
    }
  }
  cs.S();
  // Exploded SHX-style annotation text: tags next to many fittings.
  cs.raw("0.18 w 0 G", "other");
  for (let x = x0 + 4; x < x1 - 40; x += gx * 4) {
    for (let y = y0 + 6; y < y1 - 10; y += gy * 1.5) {
      if (rnd() < 0.7) shxText(cs, x, y, 2.4, 3 + Math.floor(rnd() * 4), rnd);
    }
  }
  // Real text: room names (Helvetica, not embedded).
  cs.raw("0 g BT /F1 7 Tf", "text");
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      cs.raw(`1 0 0 1 ${f(x0 + i * rw + rw / 2 - 30)} ${f(y0 + j * rh + rh / 2)} Tm (ROOM ${layer}.${i}${j} CLG 2700) Tj`, "text");
    }
  }
  cs.raw("ET", "text");
}

function titleBlock(cs) {
  cs.raw("1.5 w 0 G", "other");
  cs.re(20, 20, W - 40, H - 40);
  cs.re(W - 400, 20, 380, H - 40);
  cs.S();
  cs.raw("0 g BT /F1 28 Tf 1 0 0 1 2990 120 Tm (SYNTHETIC A0 RCP) Tj ET", "text");
  cs.raw("BT /F1 12 Tf 1 0 0 1 2990 90 Tm (Plan Markup render spike fixture - not a real drawing) Tj ET", "text");
}

function buildPdf(streams) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pages = add(null);
  const font = add(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  const contentIds = streams.map((data) =>
    add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, Buffer.from("\nendstream")])),
  );
  const page = add(
    Buffer.from(
      `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents [${contentIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    ),
  );
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  objects[pages - 1] = Buffer.from(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);

  const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    chunks.push(b);
    offset += b.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (const o of offsets) xref.push(`${String(o).padStart(10, "0")} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`);
  chunks.push(Buffer.from(xref.join("")));
  return Buffer.concat(chunks);
}

function main() {
  const targetBytes = Number(arg("--target-mb", "50")) * 1024 * 1024;
  const out = path.resolve(arg("--out", path.join(ROOT, "fixtures/private/pdf/synthetic-a0-50mb.pdf")));
  const rnd = prng(0x2_3a0);
  const streams = [];
  const totals = { m: 0, l: 0, c: 0, re: 0, S: 0, f: 0, h: 0, text: 0, other: 0 };
  let compressed = 0;
  let uncompressed = 0;

  const head = new Content();
  titleBlock(head);
  for (const list of [head]) {
    const raw = Buffer.from(list.text(), "latin1");
    const z = deflateSync(raw, { level: 6 });
    streams.push(z);
    compressed += z.length;
    uncompressed += raw.length;
    for (const k of Object.keys(totals)) totals[k] += list.ops[k];
  }
  for (let layer = 0; compressed < targetBytes; layer++) {
    const cs = new Content(rnd);
    drawLayer(cs, layer, rnd);
    const raw = Buffer.from(cs.text(), "latin1");
    const z = deflateSync(raw, { level: 6 });
    streams.push(z);
    compressed += z.length;
    uncompressed += raw.length;
    for (const k of Object.keys(totals)) totals[k] += cs.ops[k];
  }
  const pdf = buildPdf(streams);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, pdf);
  const pathOps = totals.m + totals.l + totals.c + totals.re + totals.S + totals.f + totals.h;
  console.log(
    JSON.stringify(
      {
        out: path.relative(ROOT, out),
        bytes: pdf.length,
        mb: +(pdf.length / 1024 / 1024).toFixed(2),
        pageSizePt: [W, H],
        contentStreams: streams.length,
        uncompressedContentMb: +(uncompressed / 1024 / 1024).toFixed(1),
        pathOperators: pathOps,
        operators: totals,
      },
      null,
      2,
    ),
  );
}

main();
