// Story 9.11 (FR77, UX-DR26): rule breaks pinned on the canvas. Each flag of a
// zone's live check that has a place gets a marker at a fixed screen size: a
// danger ✕ for an error, a warning ⚠ for a warning, with its short label
// ("Spacing 4.8 m > 4.6 m"). Clicking a marker (Select) zooms to it, selects
// its zone and highlights its row in the ZoneReport; clicking the row does the
// same for the marker (revealFlag).

import { pageIdOf, type Calibration } from "@/core/calibration/calibration";
import type { Point } from "@/core/markup/geometry";
import { pageScaleOf, toPage } from "@/core/sprinkler/heads";
import { flagLabel } from "@/core/sprinkler/report";
import { setFlagFocus, zoneCheckStore, type FlagRef } from "@/features/sprinkler/check-store";
import { viewerCommands, viewerStore, type LayerView } from "@/features/viewer";

import { setSelection } from "./editor-store";

/** Fixed for the white sheet in every theme, like the coverage overlay. */
export const MARKER_ERROR_COLOR = "#c8243a";
export const MARKER_WARNING_COLOR = "#a15c00";
/** Marker radius and label size in CSS px. */
const R_PX = 8;
const LABEL_PX = 11;
/** How much drawing a revealed break shows around it (mm each way). */
const REVEAL_MM = 3000;

type Painted = { ref: FlagRef; x: number; y: number; r: number; label: { x0: number; y0: number; x1: number; y1: number } | null };
let painted: { documentId: string; pageIndex: number; markers: Painted[] } | null = null;

/** The markers of the shown page's reports (page points), errors drawn last (on top). */
export function markersOf(calibration: Pick<Calibration, "xFactor" | "yFactor">, userUnit: number): { ref: FlagRef; at: Point; severity: "error" | "warning"; label: string }[] {
  const { reports } = zoneCheckStore.getState();
  const scale = pageScaleOf(calibration, userUnit);
  const out: { ref: FlagRef; at: Point; severity: "error" | "warning"; label: string }[] = [];
  for (const [zoneId, r] of Object.entries(reports)) {
    r.flags.forEach((f, index) => {
      if (f.where) out.push({ ref: { zoneId, index }, at: toPage(f.where, scale), severity: f.severity, label: flagLabel(f) });
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
}

/** Paints the markers over the markups (device px, so they keep their size at any zoom). */
export function paintRuleMarkers(c: CanvasRenderingContext2D, view: LayerView, calibration: Pick<Calibration, "xFactor" | "yFactor"> | null): void {
  painted = null;
  const state = zoneCheckStore.getState();
  if (!calibration || state.pageId !== pageIdOf(view.documentId, view.pageIndex)) return;
  const markers = markersOf(calibration, view.userUnit);
  if (markers.length === 0) return;
  const k = view.dpr;
  const r = R_PX * k;
  const out: Painted[] = [];
  c.save();
  c.font = `600 ${Math.round(LABEL_PX * k)}px ${view.colors.fontFamily}`;
  c.textBaseline = "middle";
  c.lineJoin = "round";
  for (const m of markers) {
    const p = view.toDevice(m.at);
    if (p.x < -200 * k || p.y < -50 * k || p.x > view.width + 50 * k || p.y > view.height + 50 * k) continue;
    const color = m.severity === "error" ? MARKER_ERROR_COLOR : MARKER_WARNING_COLOR;
    const focused = state.focus?.zoneId === m.ref.zoneId && state.focus.index === m.ref.index;
    if (focused) {
      c.beginPath();
      c.arc(p.x, p.y, r + 4 * k, 0, Math.PI * 2);
      c.lineWidth = 2 * k;
      c.strokeStyle = view.colors.selection;
      c.stroke();
    }
    // The symbol: a filled circle with a white ✕, or a filled triangle with a white "!".
    c.beginPath();
    if (m.severity === "error") c.arc(p.x, p.y, r, 0, Math.PI * 2);
    else {
      c.moveTo(p.x, p.y - r * 1.1);
      c.lineTo(p.x + r, p.y + r * 0.75);
      c.lineTo(p.x - r, p.y + r * 0.75);
      c.closePath();
    }
    c.fillStyle = color;
    c.fill();
    c.lineWidth = 1 * k;
    c.strokeStyle = view.colors.halo;
    c.stroke();
    c.beginPath();
    c.lineWidth = 1.75 * k;
    c.strokeStyle = "#ffffff";
    if (m.severity === "error") {
      const d = r * 0.42;
      c.moveTo(p.x - d, p.y - d);
      c.lineTo(p.x + d, p.y + d);
      c.moveTo(p.x + d, p.y - d);
      c.lineTo(p.x - d, p.y + d);
    } else {
      c.moveTo(p.x, p.y - r * 0.45);
      c.lineTo(p.x, p.y + r * 0.15);
      c.moveTo(p.x, p.y + r * 0.38);
      c.lineTo(p.x, p.y + r * 0.42);
    }
    c.stroke();
    // The label, haloed, to the right.
    const tx = p.x + r + 4 * k;
    const w = c.measureText(m.label).width || m.label.length * LABEL_PX * 0.55 * k;
    c.lineWidth = 3 * k;
    c.strokeStyle = view.colors.halo;
    c.strokeText(m.label, tx, p.y);
    c.fillStyle = color;
    c.fillText(m.label, tx, p.y);
    const h = LABEL_PX * k * 0.7;
    out.push({ ref: m.ref, x: p.x, y: p.y, r, label: { x0: tx, y0: p.y - h, x1: tx + w, y1: p.y + h } });
  }
  c.restore();
  painted = { documentId: view.documentId, pageIndex: view.pageIndex, markers: out };
}

/** The marker under `device` (canvas device px) on the page last painted, the one on top first. */
export function ruleMarkerAt(device: Point, at: { documentId: string; pageIndex: number }, dpr = 1): FlagRef | null {
  if (!painted || painted.documentId !== at.documentId || painted.pageIndex !== at.pageIndex) return null;
  const slop = 3 * dpr;
  for (let i = painted.markers.length - 1; i >= 0; i--) {
    const m = painted.markers[i];
    if (Math.hypot(device.x - m.x, device.y - m.y) <= m.r + slop) return m.ref;
    const l = m.label;
    if (l && device.x >= l.x0 - slop && device.x <= l.x1 + slop && device.y >= l.y0 - slop && device.y <= l.y1 + slop) return m.ref;
  }
  return null;
}

/**
 * Story 9.11 (UX-DR26): shows a rule break: zooms to where it is (the zone when it has no place),
 * selects its zone and highlights it (its marker and its ZoneReport row).
 */
export function revealFlag(ref: FlagRef): void {
  const viewer = viewerStore.getState();
  const { documentId, pageIndex } = viewer;
  const flag = zoneCheckStore.getState().reports[ref.zoneId]?.flags[ref.index];
  if (!documentId || !flag) return;
  setFlagFocus(ref);
  setSelection([ref.zoneId]);
  const calibration = viewer.calibrations[pageIdOf(documentId, pageIndex)];
  if (!flag.where || !calibration) return;
  const scale = pageScaleOf(calibration, viewer.pages[pageIndex]?.userUnit ?? 1);
  const a = toPage({ x: flag.where.x - REVEAL_MM, y: flag.where.y - REVEAL_MM }, scale);
  const b = toPage({ x: flag.where.x + REVEAL_MM, y: flag.where.y + REVEAL_MM }, scale);
  viewerCommands.revealMarkup(pageIndex, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
}

export function resetRuleMarkers(): void {
  painted = null;
}
