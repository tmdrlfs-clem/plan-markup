// Story 9.9: the coverage overlay's state, cache and painting (a recording context; no hatch canvas in node).
import { afterEach, describe, expect, it, vi } from "vitest";

import { factorForRatio } from "@/core/calibration/calibration";
import type { Markup, ZoneMarkup } from "@/core/schema/markup";
import { headMarkup, pageScaleOf } from "@/core/sprinkler/heads";
import { newZone, withUse } from "@/core/sprinkler/zone";
import type { LayerView } from "@/features/viewer";

import { COVERAGE_COLOR, COVERAGE_FADE_MS, coverageAlpha, coverageStore, holdCoverage, paintCoverage, resetCoverage, revealCoverage, setCoverageOn, setCoverageShape, zoneCoverage } from "./coverage-overlay";

const k100 = factorForRatio(100);
const CAL = { xFactor: k100, yFactor: k100 };
const ring = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const zone = (id: string, use?: string): ZoneMarkup => {
  const z = newZone({ id, pageId: "doc:0", createdAt: "2026-11-12T00:00:00.000Z", outer: ring(100, 100, 200, 150), holes: [] }, [], CAL);
  return use ? withUse(z, use) : z;
};
const head = (z: ZoneMarkup, x: number, y: number, id: string) => headMarkup({ x, y, kind: "row" }, z, pageScaleOf(CAL), id, "t");

const VIEW: LayerView = {
  documentId: "doc",
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x * 2, y: p.y * 2 }),
  devicePerPt: 2,
  dpr: 2,
  width: 1684,
  height: 1190,
  colors: { halo: "#fff", warning: "#f80", selection: "#00f", fontFamily: "sans-serif" },
};

function recorder() {
  const calls: string[] = [];
  const props: Record<string, unknown> = {};
  const c = new Proxy(props, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => calls.push(`${k}(${args.length ? String(args[0]) : ""})`)),
    set: (t, k: string, v) => {
      t[k] = v;
      calls.push(`${k}=${String(v)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

afterEach(() => {
  resetCoverage();
  vi.unstubAllGlobals();
});

describe("coverage overlay (Story 9.9)", () => {
  it("is on by default; off, held for a run, then fading in", () => {
    expect(coverageAlpha()).toBe(1);
    setCoverageOn(false);
    expect(coverageAlpha()).toBe(0);
    setCoverageOn(true);
    holdCoverage();
    expect(coverageAlpha()).toBe(0);
    const s = { ...coverageStore.getState(), fade: 1000 };
    expect(coverageAlpha(s, 1000 + COVERAGE_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(coverageAlpha(s, 1000 + COVERAGE_FADE_MS * 2)).toBe(1);
  });

  it("fades in over frames, and at once under prefers-reduced-motion", () => {
    const frames: (() => void)[] = [];
    let now = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => frames.push(fn));
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    holdCoverage();
    revealCoverage();
    expect(coverageStore.getState().fade).toBe(0);
    now = COVERAGE_FADE_MS / 2;
    frames.shift()!();
    expect(coverageAlpha()).toBeCloseTo(0.5);
    now = COVERAGE_FADE_MS;
    frames.shift()!();
    expect(coverageStore.getState().fade).toBeNull();
    expect(frames).toHaveLength(0);

    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    holdCoverage();
    revealCoverage();
    expect(coverageStore.getState().fade).toBeNull();
    expect(frames).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("covers only zones with heads and a mapped use, cached until the heads or shape change", () => {
    const a = zone("00000000-0000-7000-8000-00000000000a");
    const b = zone("00000000-0000-7000-8000-00000000000b");
    const c = zone("00000000-0000-7000-8000-00000000000c", "Hangar");
    const h1 = head(a, 5000, 4000, "00000000-0000-7000-9000-000000000001");
    const markups: Markup[] = [a, b, c, h1, head(c, 5000, 4000, "00000000-0000-7000-9000-000000000002")];
    const first = zoneCoverage(markups, CAL, 1);
    expect(first.map((z) => z.zone.id)).toEqual([a.id]);
    expect(first[0].rings).toHaveLength(1);
    expect(zoneCoverage(markups, CAL, 1)[0].rings).toBe(first[0].rings);
    setCoverageShape("square");
    const square = zoneCoverage(markups, CAL, 1)[0].rings;
    expect(square).not.toBe(first[0].rings);
    const moved = head(a, 5100, 4000, h1.id);
    expect(zoneCoverage([a, moved], CAL, 1)[0].rings).not.toBe(square);
  });

  it("paints one translucent fill of the coverage and its outline; nothing when off or uncalibrated", () => {
    const a = zone("00000000-0000-7000-8000-00000000000a");
    const markups: Markup[] = [a, head(a, 5500, 5500, "00000000-0000-7000-9000-000000000001"), head(a, 8500, 5500, "00000000-0000-7000-9000-000000000002")];
    const on = recorder();
    paintCoverage(on.c, VIEW, markups, CAL);
    expect(on.calls.filter((x) => x.startsWith("fill("))).toEqual(["fill(nonzero)"]);
    expect(on.calls).toContain(`fillStyle=${COVERAGE_COLOR}`);
    expect(on.calls.filter((x) => x.startsWith("moveTo("))).toHaveLength(2);
    expect(on.calls).toContain("stroke()");

    const none = recorder();
    paintCoverage(none.c, VIEW, markups, null);
    setCoverageOn(false);
    paintCoverage(none.c, VIEW, markups, CAL);
    expect(none.calls).toEqual([]);
  });
});
