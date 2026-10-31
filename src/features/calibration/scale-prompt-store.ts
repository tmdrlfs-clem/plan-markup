// The scale prompt (Story 4.7, FR82): arming a measuring tool on a page with
// no scale offers the detected scale ("Detected 1:100 @ A1 — Use it /
// Calibrate…") or only Calibrate…. It never blocks the canvas: dismissed,
// the page's measurements read "Scale not set" (FR27). Dismissals last for the
// session, by page; founder decision 2026-11-01: Calibrate… from the prompt
// left without a scale (cancelled) counts as a dismissal.

import { createStore } from "zustand/vanilla";

import { pageIdOf } from "@/core/calibration/calibration";
import type { DetectedScale } from "@/core/scale/detect";
import { hasDocument, isMeasureTool, scaleStateOf, viewerStore, type ScaleState, type ViewerState, type ViewerTool } from "@/features/viewer";

import { applyCalibration, calibrateStore, calibrationOf, openCalibrate } from "./calibrate-store";
import { calibrationPrefs } from "./calibration-prefs";
import { verifyStore } from "./verify-store";

/** Tools that need a scale (Length, Polylength; Area, Count and the 4541 zones join with their stories). */
export function needsScale(tool: ViewerTool): boolean {
  return isMeasureTool(tool);
}

export type ScalePrompt = {
  pageIndex: number;
  /** The page's scale state (never "set"): what the prompt offers. */
  state: Exclude<ScaleState, { kind: "set" }>;
  /** The one detected scale "Use it" applies (state "detected" only). */
  detected: DetectedScale | null;
};

export const scalePromptStore = createStore<{ dismissed: Readonly<Record<string, true>> }>(() => ({ dismissed: {} }));

/**
 * The prompt for the shown page, or null: a measuring tool is armed, the page
 * has no calibration and was not dismissed, and no Calibrate or Verify dialog
 * is open (they take over; the prompt comes back after them when still needed).
 */
export function scalePromptFor(
  viewer: Pick<ViewerState, "status" | "pageCount" | "documentId" | "tool" | "pageIndex" | "pages" | "pageScales" | "calibrations">,
  dialogs: { calibrate: boolean; verify: boolean },
  dismissed: Readonly<Record<string, true>>,
): ScalePrompt | null {
  if (!hasDocument(viewer) || !viewer.documentId || !needsScale(viewer.tool)) return null;
  if (dialogs.calibrate || dialogs.verify) return null;
  const page = viewer.pages[viewer.pageIndex];
  if (!page || calibrationOf(viewer, viewer.pageIndex)) return null;
  if (dismissed[pageIdOf(viewer.documentId, viewer.pageIndex)]) return null;
  const scales = viewer.pageScales[viewer.pageIndex] ?? null;
  const state = scaleStateOf(scales, null, page.rotate);
  if (state.kind === "set") return null;
  const detected = state.kind === "detected" ? (scales?.scales[0] ?? null) : null;
  return { pageIndex: viewer.pageIndex, state, detected };
}

/** The prompt now (the ScalePrompt reads it through its stores). */
export function currentScalePrompt(): ScalePrompt | null {
  return scalePromptFor(
    viewerStore.getState(),
    { calibrate: calibrateStore.getState().open, verify: verifyStore.getState().open },
    scalePromptStore.getState().dismissed,
  );
}

/**
 * "Use it": calibrates the shown page with its detected scale, as the
 * Calibrate dialog's detected-scale button does (one undo step, the user's
 * unit and precision). False when there is no detected scale to use.
 */
export function applyDetectedScale(): boolean {
  const prompt = currentScalePrompt();
  const s = prompt?.detected;
  if (!prompt || !s) return false;
  return applyCalibration({ kind: "detected", ratio: s.sheet ? s.ratio : s.effective, sheet: s.sheet }, [prompt.pageIndex], calibrationPrefs.getState());
}

/** ×: no prompt on the shown page for the rest of the session (its measurements read "Scale not set"). */
export function dismissScalePrompt(): void {
  const { documentId, pageIndex } = viewerStore.getState();
  if (documentId) dismissPage(pageIdOf(documentId, pageIndex));
}

function dismissPage(id: string): void {
  scalePromptStore.setState((s) => ({ dismissed: { ...s.dismissed, [id]: true } }));
}

/** The document whose prompt opened the Calibrate dialog (until the dialog closes). */
let calibratingFrom: string | null = null;

/** Calibrate…: opens the dialog for the shown page; closed with the page still without a scale, the prompt stays away. */
export function calibrateFromPrompt(): void {
  const { documentId, pageIndex } = viewerStore.getState();
  if (!documentId) return;
  openCalibrate();
  if (calibrateStore.getState().open && calibrateStore.getState().pageIndex === pageIndex) calibratingFrom = documentId;
}

calibrateStore.subscribe((s, prev) => {
  if (!prev.open || s.open || !calibratingFrom) return;
  const documentId = calibratingFrom;
  calibratingFrom = null;
  const viewer = viewerStore.getState();
  // 4.7 review R1: another tab closed it (not a cancel): nothing is dismissed. The dialog follows
  // paging (4.3 review R4): the page it closes on is what counts.
  if (viewer.documentId !== documentId) return;
  const page = pageIdOf(documentId, s.pageIndex);
  if (!viewer.calibrations[page]) dismissPage(page);
});

/** Forgets the dismissals (another user's workspace, tests). */
export function resetScalePrompt(): void {
  calibratingFrom = null;
  scalePromptStore.setState({ dismissed: {} });
}
