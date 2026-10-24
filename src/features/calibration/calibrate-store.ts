// The Calibrate dialog's state and actions (Story 4.3): open from the
// ScaleIndicator or Document > Calibrate…; the two-point pick collapses it to
// the instruction bar and brings it back with the picked distance; applying
// writes the calibrations of the chosen pages as one undo step.

import { createStore } from "zustand/vanilla";

import { calibrationsFor, pageIdOf, type Calibration, type CalibrationInput, type DisplayUnit, type Precision } from "@/core/calibration/calibration";
import type { InputUnit } from "@/core/calibration/units";
import { executeCommand } from "@/features/editor";
import { hasDocument, tabsStore, viewerCalibration, viewerCommands, viewerStore, type CalibrationPick } from "@/features/viewer";

import { calibrationPrefs, setCalibrationPrefs } from "./calibration-prefs";

export type CalibrateMethod = "ratio" | "points";
export type CalibrateScope = "page" | "range" | "all";

/** A pick shorter than this on screen (CSS px) is refused (AC 2). */
export const MIN_PICK_PX = 10;

export type CalibrateState = {
  /** Counts the openings: each one starts with fresh fields and messages. */
  session: number;
  /** The dialog is shown. */
  open: boolean;
  /** The dialog is collapsed to the instruction bar while two points are picked. */
  picking: boolean;
  /** The point to click next while picking. */
  pickStep: 1 | 2;
  /** The page the dialog was opened for (0-based). */
  pageIndex: number;
  method: CalibrateMethod;
  ratioText: string;
  distanceText: string;
  distanceUnit: InputUnit;
  pick: CalibrationPick | null;
  pickError: string | null;
  scope: CalibrateScope;
  rangeText: string;
  /** "Different vertical scale" is expanded; its ratio. */
  verticalOpen: boolean;
  yRatioText: string;
  unit: DisplayUnit;
  precision: Precision;
};

const CLOSED: CalibrateState = {
  session: 0,
  open: false,
  picking: false,
  pickStep: 1,
  pageIndex: 0,
  method: "ratio",
  ratioText: "",
  distanceText: "",
  distanceUnit: "mm",
  pick: null,
  pickError: null,
  scope: "page",
  rangeText: "",
  verticalOpen: false,
  yRatioText: "",
  unit: "mm",
  precision: "0",
};

export const calibrateStore = createStore<CalibrateState>(() => CLOSED);

export function setCalibrateDraft(patch: Partial<CalibrateState>): void {
  calibrateStore.setState(patch);
}

/** The shown page's calibration, if any. */
export function calibrationOf(state: { documentId: string | null; calibrations: Readonly<Record<string, Calibration>> }, index: number): Calibration | null {
  return state.documentId ? (state.calibrations[pageIdOf(state.documentId, index)] ?? null) : null;
}

/**
 * The pick the dialog is waiting for (review R3): each startPicking gets a new
 * token, and a pick's callbacks are ignored once another pick started or the
 * dialog was opened again or closed.
 */
let pickToken = 0;

/** Ends the engine's pick in progress, if any, without its callbacks reaching the dialog. */
function abandonPick(): void {
  if (!calibrateStore.getState().picking) return;
  pickToken++;
  viewerCalibration.cancelPick();
}

/** Opens the dialog for the shown page (nothing without a drawing); a pick in progress is abandoned (review R3). */
export function openCalibrate(): void {
  const viewer = viewerStore.getState();
  if (!hasDocument(viewer)) return;
  abandonPick();
  viewerCalibration.clearLine();
  const prefs = calibrationPrefs.getState();
  const current = calibrationOf(viewer, viewer.pageIndex);
  calibrateStore.setState(
    {
      ...CLOSED,
      session: calibrateStore.getState().session + 1,
      open: true,
      pageIndex: viewer.pageIndex,
      ratioText: current?.ratio ? `1:${current.ratio}${current.sheet ? ` @ ${current.sheet}` : ""}` : "",
      unit: current?.unit ?? prefs.unit,
      precision: current?.precision ?? prefs.precision,
      // The distance is typed in the display unit's family (review R7: metres in m).
      distanceUnit: distanceUnitFor(current?.unit ?? prefs.unit),
    },
    true,
  );
}

/** The unit a known distance is typed in for a display unit. */
export function distanceUnitFor(unit: DisplayUnit): InputUnit {
  return unit;
}

/** Closes the dialog (Cancel, Esc, after Apply); a pick in progress is cancelled and its line cleared. */
export function closeCalibrate(): void {
  abandonPick();
  calibrateStore.setState({ open: false, picking: false });
  viewerCalibration.clearLine();
}

/** Collapses the dialog and picks two points on the drawing (AC 2). */
export function startPicking(): void {
  abandonPick();
  const token = ++pickToken;
  const current = () => token === pickToken && calibrateStore.getState().picking;
  calibrateStore.setState({ picking: true, pickStep: 1, pick: null, pickError: null, method: "points" });
  viewerCalibration.clearLine();
  viewerCommands.focusCanvas();
  viewerCalibration.startPick({
    step: (next) => {
      if (current()) calibrateStore.setState({ pickStep: next });
    },
    done: (pick) => {
      // Closing or reopening the dialog, or another pick, abandons this one: then nothing comes back.
      if (!current()) return;
      if (pick && pick.screenPx < MIN_PICK_PX) {
        viewerCalibration.clearLine();
        calibrateStore.setState({
          picking: false,
          pick: null,
          pickError: `The two points are too close (${pick.screenPx.toFixed(0)} px). Pick points at least ${MIN_PICK_PX} px apart.`,
        });
        return;
      }
      calibrateStore.setState({ picking: false, ...(pick ? { pick, pickError: null } : {}) });
    },
  });
}

/** Esc in the instruction bar: stop picking, the dialog comes back as it was. */
export function cancelPicking(): void {
  if (!calibrateStore.getState().picking) return;
  abandonPick();
  calibrateStore.setState({ picking: false });
}

/**
 * Applies `input` to `pages` (0-based) of the active drawing as one undo step
 * ("Calibrate page 3", "Calibrate 4 pages") and remembers the unit and
 * precision as the user's defaults. Returns false without a drawing.
 */
export function applyCalibration(input: CalibrationInput, pages: readonly number[], display: { unit: DisplayUnit; precision: Precision }): boolean {
  const viewer = viewerStore.getState();
  const sha = viewer.documentId;
  if (!sha || !hasDocument(viewer) || pages.length === 0) return false;
  const sized = pages.filter((i) => viewer.pages[i]).map((index) => ({ index, size: viewer.pages[index] }));
  const next = calibrationsFor(input, sized, display);
  const ids = [...next.keys()].map((i) => pageIdOf(sha, i));
  const before = new Map(ids.map((id) => [id, viewer.calibrations[id] ?? null] as const));
  const tabId = viewer.tabId;
  const write = (values: ReadonlyMap<string, Calibration | null>) => {
    // Commands act on their own tab's state (undo only ever runs in the active tab).
    if (viewerStore.getState().tabId !== tabId) return;
    const calibrations = { ...viewerStore.getState().calibrations };
    for (const [id, value] of values) {
      if (value) calibrations[id] = value;
      else delete calibrations[id];
    }
    viewerStore.setState({ calibrations });
  };
  const after = new Map([...next].map(([i, c]) => [pageIdOf(sha, i), c] as const));
  executeCommand({
    label: pages.length === 1 ? `Calibrate page ${pages[0] + 1}` : `Calibrate ${pages.length} pages`,
    do: () => write(after),
    undo: () => write(before),
  });
  setCalibrationPrefs(display);
  return true;
}

// Another drawing shown (tab switch, close) ends the dialog: it belongs to its page.
tabsStore.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId && calibrateStore.getState().open) closeCalibrate();
});

// Review R4: another page shown while the dialog is open (paging during a pick cancels the pick
// and brings the dialog back) moves the dialog to that page; a pick made on the other page is dropped.
viewerStore.subscribe((s) => {
  const ui = calibrateStore.getState();
  if (!ui.open || s.pageIndex === ui.pageIndex || !hasDocument(s)) return;
  if (ui.pick) viewerCalibration.clearLine();
  calibrateStore.setState({ pageIndex: s.pageIndex, pick: null, pickError: null });
});
