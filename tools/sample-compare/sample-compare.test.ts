// Compares the engine's layout with a designer's layout for sample rooms (founder feedback, 2026-11-12:
// head positions should look like a person placed them).
//
// The cases are client drawings, so they stay outside the repository (NFR26). The test is skipped unless
// SAMPLES_DIR points at a folder holding `_work/cases.json`:
//   SAMPLES_DIR=C:/path/to/samples npx vitest run tools/sample-compare
// It writes `_work/compare.json` and one SVG per case (human heads blue, engine heads red).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { placeSite, type EngineZone } from "@/core/sprinkler/engine/site";
import { NZS4541_V1, type Hazard } from "@/core/sprinkler/rules/rules";

type P = [number, number];
type Case = {
  name: string;
  hazard: Hazard;
  note?: string;
  /** Outer ring and optional columns, mm. */
  ring: P[];
  columns?: P[][];
  grid?: EngineZone["grid"];
  prefs?: EngineZone["prefs"];
  /** Head lines the designer would draw, mm: [[x, y], [x, y]] each. */
  guides?: [P, P][];
  /** The designer's heads, mm. */
  human: P[];
  /** Optional drawing features to show (lights and so on), mm. */
  marks?: P[];
};

const dir = process.env.SAMPLES_DIR;
const file = dir ? join(dir, "_work", "cases.json") : "";
const pts = (r: P[]) => r.map(([x, y]) => ({ x, y }));

function nearestGaps(a: P[]): number[] {
  return a.map((p, i) => Math.min(...a.filter((_, k) => k !== i).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
}

/** Greedy one-to-one match of engine heads to human heads; the distances, mm. */
function match(human: P[], engine: P[]): number[] {
  const pairs: { d: number; h: number; e: number }[] = [];
  human.forEach((h, i) => engine.forEach((e, k) => pairs.push({ d: Math.hypot(h[0] - e[0], h[1] - e[1]), h: i, e: k })));
  pairs.sort((a, b) => a.d - b.d);
  const usedH = new Set<number>();
  const usedE = new Set<number>();
  const out: number[] = [];
  for (const p of pairs) {
    if (usedH.has(p.h) || usedE.has(p.e)) continue;
    usedH.add(p.h);
    usedE.add(p.e);
    out.push(Math.round(p.d));
  }
  return out;
}

function svg(c: Case, engine: P[]): string {
  const xs = c.ring.map((p) => p[0]);
  const ys = c.ring.map((p) => p[1]);
  const x0 = Math.min(...xs) - 600;
  const y0 = Math.min(...ys) - 600;
  const w = Math.max(...xs) - x0 + 600;
  const h = Math.max(...ys) - y0 + 1400;
  const poly = (r: P[], fill: string) => `<polygon points="${r.map((p) => p.join(",")).join(" ")}" fill="${fill}" stroke="#111" stroke-width="40"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${Math.round(w / 12)}" height="${Math.round(h / 12)}">`,
    `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#fff"/>`,
    poly(c.ring, "#f6f6f2"),
    ...(c.columns ?? []).map((r) => poly(r, "#444")),
    ...(c.marks ?? []).map(([x, y]) => `<rect x="${x - 70}" y="${y - 70}" width="140" height="140" fill="#999"/>`),
    ...(c.guides ?? []).map(([a, b]) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#1a8f3c" stroke-width="40" stroke-dasharray="200 120"/>`),
    ...c.human.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="150" fill="none" stroke="#1556d6" stroke-width="60"/>`),
    ...engine.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="80" fill="#e02020"/>`),
    `<text x="${x0 + 300}" y="${y0 + h - 500}" font-size="260" font-family="Arial">${c.name} (${c.hazard}): person ${c.human.length} (blue ring), engine ${engine.length} (red dot)</text>`,
    `</svg>`,
  ].join("\n");
}

describe.skipIf(!file || !existsSync(file))("sample drawings: engine layout against the designer's", () => {
  it("writes the comparison", () => {
    const cases = JSON.parse(readFileSync(file, "utf8")) as Case[];
    const out = cases.map((c, i) => {
      const zone: EngineZone = {
        zoneId: `z${i}`,
        hazard: c.hazard,
        barriers: [{ kind: "wall", ring: pts(c.ring) }, ...(c.columns ?? []).map((r) => ({ kind: "column" as const, ring: pts(r) }))],
        grid: c.grid ?? null,
        prefs: c.prefs,
        guides: c.guides?.map(([a, b]) => ({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } })),
      };
      const t0 = performance.now();
      const [o] = placeSite([zone], NZS4541_V1);
      const engine = o.result.heads.map((h): P => [Math.round(h.x), Math.round(h.y)]);
      writeFileSync(join(dir!, "_work", `case-${i}.svg`), svg(c, engine));
      const m = match(c.human, engine);
      return {
        name: c.name,
        hazard: c.hazard,
        ok: o.result.ok,
        ms: Math.round(performance.now() - t0),
        human: c.human.length,
        engine: engine.length,
        rows: o.result.notes?.rows,
        frameDeg: o.result.notes?.frameDeg,
        guides: o.result.notes?.guides,
        aligned: o.result.notes?.aligned,
        oraclePass: o.report?.pass,
        flags: o.report?.flags.map((f) => f.code),
        humanNearestGap: nearestGaps(c.human).map(Math.round),
        engineNearestGap: nearestGaps(engine).map(Math.round),
        matchDistances: m,
        matchMedian: m.length ? m.slice().sort((a, b) => a - b)[Math.floor(m.length / 2)] : null,
        engineHeads: engine,
      };
    });
    writeFileSync(join(dir!, "_work", "compare.json"), JSON.stringify(out, null, 1));
    expect(out.length).toBe(cases.length);
  });
});
