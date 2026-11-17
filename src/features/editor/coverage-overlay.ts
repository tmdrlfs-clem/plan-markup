// Story 9.9 (FR75, NFR7, UX-DR25): the 4541 coverage overlay. Each placed
// head's coverage polygon (circle by default, square on toggle; clipped by
// spray shadows, core/sprinkler/coverage) is filled translucent info-blue as
// one union; whatever of a zone with heads is left uncovered is hatched. The
// overlay fades in when a placement finishes (instantly under
// prefers-reduced-motion). Polygons are cached per zone, so a toggle is a
// repaint.

import { createStore } from "zustand/vanilla";

import type { Calibration } from "@/core/calibration/calibration";
import type { Point } from "@/core/markup/geometry";
import type { Markup, ZoneMarkup } from "@/core/schema/markup";
import { coverageOf, coverageRadiusMm, type CoverageShape } from "@/core/sprinkler/coverage";
import { engineZoneOf, headCentre, isHead, pageScaleOf, toMm, toPage, type HeadMarkup } from "@/core/sprinkler/heads";
import { NZS4541_V1, type RuleSet } from "@/core/sprinkler/rules/rules";
import { isZone, zoneHazard } from "@/core/sprinkler/zone";
import { useMapStore } from "@/features/sprinkler/use-map-store";
import { notifyMarkups, type LayerView } from "@/features/viewer";

/** Info blue on the white sheet (UX: ≈18 % fill, thin outline); gaps hatched in the canvas danger red. */
export const COVERAGE_COLOR = "#2563c9";
export const COVERAGE_FILL_ALPHA = 0.18;
export const COVERAGE_GAP_COLOR = "#c8243a";
export const COVERAGE_FADE_MS = 400;

export type CoverageState = {
  on: boolean;
  shape: CoverageShape;
  rules: RuleSet;
  /** "hidden": a placement is running; a time: fading in since then (performance.now()); null: shown. */
  fade: "hidden" | number | null;
};

const INITIAL: CoverageState = { on: true, shape: "circle", rules: NZS4541_V1, fade: null };
export const coverageStore = createStore<CoverageState>(() => INITIAL);

function set(patch: Partial<CoverageState>): void {
  coverageStore.setState(patch);
  notifyMarkups({});
}

export const setCoverageOn = (on: boolean) => set({ on, fade: null });
export const setCoverageShape = (shape: CoverageShape) => set({ shape });
/** Story 10.13: the rule figures in use (the coverage radius follows them). */
export const setCoverageRules = (rules: RuleSet) => set({ rules });

/** A placement started: the overlay waits for it to finish. */
export const holdCoverage = () => set({ fade: "hidden" });

function reducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A placement finished: the overlay comes on and fades in (instantly under reduced motion). */
export function revealCoverage(): void {
  if (reducedMotion() || typeof requestAnimationFrame !== "function") {
    set({ on: true, fade: null });
    return;
  }
  const from = performance.now();
  set({ on: true, fade: from });
  const tick = () => {
    const f = coverageStore.getState().fade;
    if (f !== from) return; // superseded
    if (performance.now() - from >= COVERAGE_FADE_MS) {
      set({ fade: null });
      return;
    }
    notifyMarkups({});
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function resetCoverage(): void {
  coverageStore.setState(INITIAL, true);
  cache.clear();
}

/** How opaque the overlay is now (0..1). */
export function coverageAlpha(s: CoverageState = coverageStore.getState(), now = performance.now()): number {
  if (!s.on || s.fade === "hidden") return 0;
  if (s.fade === null) return 1;
  return Math.min(1, Math.max(0, (now - s.fade) / COVERAGE_FADE_MS));
}

type Entry = { zone: ZoneMarkup; key: string; rings: Point[][] };
const cache = new Map<string, Entry>();

/**
 * The coverage rings (page points) of each zone on the page that has heads. Cached per zone, so
 * only a zone whose outline, heads, hazard, shape or scale changed is computed again.
 */
export function zoneCoverage(markups: readonly Markup[], calibration: Pick<Calibration, "xFactor" | "yFactor">, userUnit: number): { zone: ZoneMarkup; rings: Point[][] }[] {
  const { shape, rules } = coverageStore.getState();
  // The use -> hazard mapping the 4541 panel shows (a use change repaints through the doc op).
  const map = useMapStore.getState().map;
  const byZone = new Map<string, HeadMarkup[]>();
  for (const m of markups) {
    if (!isHead(m)) continue;
    const list = byZone.get(m.head.zoneId);
    if (list) list.push(m);
    else byZone.set(m.head.zoneId, [m]);
  }
  const scale = pageScaleOf(calibration, userUnit);
  const out: { zone: ZoneMarkup; rings: Point[][] }[] = [];
  for (const z of markups) {
    if (!isZone(z)) continue;
    const heads = byZone.get(z.id);
    const hazard = heads ? zoneHazard(z, map) : null;
    if (!heads || !hazard) continue;
    const R = coverageRadiusMm(rules.hazards[hazard]);
    const key = `${shape}|${R}|${scale.x}|${scale.y}|${heads.map((h) => `${h.id}@${h.points[0].x},${h.points[0].y},${h.points[2].x},${h.points[2].y}`).join(";")}`;
    let e = cache.get(z.id);
    if (!e || e.zone !== z || e.key !== key) {
      const ez = engineZoneOf(z, hazard, calibration, userUnit);
      const cov = coverageOf(
        ez.barriers,
        heads.map((h) => ({ id: h.id, ...toMm(headCentre(h), scale) })),
        R,
        shape,
      );
      e = { zone: z, key, rings: cov.filter((c) => c.ring.length > 2).map((c) => c.ring.map((p) => toPage(p, scale))) };
      cache.set(z.id, e);
    }
    out.push({ zone: z, rings: e.rings });
  }
  return out;
}

function tracePath(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, rings: readonly (readonly Point[])[], view: LayerView): void {
  for (const r of rings) {
    r.forEach((p, i) => {
      const d = view.toDevice(p);
      if (i === 0) c.moveTo(d.x, d.y);
      else c.lineTo(d.x, d.y);
    });
    c.closePath();
  }
}

function scratch(w: number, h: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  try {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h).getContext("2d");
    if (typeof document === "undefined") return null;
    return Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d");
  } catch {
    return null;
  }
}

/** Paints the coverage overlay of the page's zones (layer 2, under the markups). */
export function paintCoverage(c: CanvasRenderingContext2D, view: LayerView, markups: readonly Markup[], calibration: Pick<Calibration, "xFactor" | "yFactor"> | null): void {
  const alpha = coverageAlpha();
  if (alpha <= 0 || !calibration) return;
  const zones = zoneCoverage(markups, calibration, view.userUnit);
  if (zones.length === 0) return;
  const all = zones.flatMap((z) => z.rings);
  c.save();
  // Gaps: each zone's area hatched, the union of the coverage cut out of it.
  const g = scratch(view.width, view.height);
  if (g) {
    g.beginPath();
    tracePath(
      g,
      zones.flatMap((z) => [z.zone.points, ...(z.zone.holes ?? [])]),
      view,
    );
    g.save();
    g.clip("evenodd");
    g.strokeStyle = COVERAGE_GAP_COLOR;
    g.lineWidth = Math.max(1, view.dpr);
    const step = 8 * view.dpr;
    g.beginPath();
    for (let x = -view.height; x < view.width; x += step) {
      g.moveTo(x, view.height);
      g.lineTo(x + view.height, 0);
    }
    g.stroke();
    g.restore();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    tracePath(g, all, view);
    g.fill("nonzero");
    c.globalAlpha = alpha * 0.8;
    c.drawImage(g.canvas, 0, 0);
  }
  // Coverage: one fill of all the rings (nonzero: overlaps are not darker), then thin outlines.
  c.beginPath();
  tracePath(c, all, view);
  c.globalAlpha = alpha * COVERAGE_FILL_ALPHA;
  c.fillStyle = COVERAGE_COLOR;
  c.fill("nonzero");
  c.globalAlpha = alpha * 0.55;
  c.strokeStyle = COVERAGE_COLOR;
  c.lineWidth = Math.max(0.75, 0.75 * view.dpr);
  c.stroke();
  c.restore();
}
