// The Verify dialog's state and actions (Story 4.4, FR25): opened for a
// calibrated page from the Calibrate dialog or Document / Tools > Verify
// calibration…; picks two points of a known dimension (the dialog collapses
// to the instruction bar like Calibrate) and compares the measured length
// with the known one. A verify never changes the calibration; Recalibrate…
// hands the pick and the known distance to the Calibrate dialog.

import { createStore } from "zustand/vanilla";

import type { Calibration } from "@/core/calibration/calibration";
import { parseDistance, type InputUnit } from "@/core/calibration/units";
import { hasDocument, tabsStore, viewerCalibration, viewerStore, type CalibrationPick } from "@/features/viewer";

import { calibrateStore, calibrationOf, closeCalibrate, distanceUnitFor, openCalibrateWith } from "./calibrate-store";
import { abandonPick, beginPick, tooClose } from "./picking";

export type VerifyState = {
  /** Counts the openings: each one starts with fresh fields. */
  session: number;
  open: boolean;
  /** Collapsed to the instruction bar while two points are picked. */
  picking: boolean;
  pickStep: 1 | 2;
  /** The page being verified (0-based): the shown page. */
  pageIndex: number;
  knownText: string;
  knownUnit: InputUnit;
  pick: CalibrationPick | null;
  pickError: string | null;
};

const CLOSED: VerifyState = {
  session: 0,
  open: false,
  picking: false,
  pickStep: 1,
  pageIndex: 0,
  knownText: "",
  knownUnit: "mm",
  pick: null,
  pickError: null,
};

export const verifyStore = createStore<VerifyState>(() => CLOSED);

export function setVerifyDraft(patch: Partial<VerifyState>): void {
  verifyStore.setState(patch);
}

/** The shown page's calibration, when a drawing is shown (Verify needs one, AC 1). */
export function shownCalibration(): Calibration | null {
  const viewer = viewerStore.getState();
  return hasDocument(viewer) ? calibrationOf(viewer, viewer.pageIndex) : null;
}

/** Opens Verify for the shown page; nothing when the page is not calibrated. The Calibrate dialog closes. */
export function openVerify(): void {
  const viewer = viewerStore.getState();
  const calibration = shownCalibration();
  if (!calibration) return;
  closeCalibrate();
  abandonPick();
  viewerCalibration.clearLine();
  verifyStore.setState(
    {
      ...CLOSED,
      session: verifyStore.getState().session + 1,
      open: true,
      pageIndex: viewer.pageIndex,
      knownUnit: distanceUnitFor(calibration.unit),
    },
    true,
  );
}

/** Closes Verify (Keep, Cancel, Esc); a pick in progress is cancelled and its line cleared. */
export function closeVerify(): void {
  if (!verifyStore.getState().open) return;
  if (verifyStore.getState().picking) abandonPick();
  verifyStore.setState({ open: false, picking: false });
  viewerCalibration.clearLine();
}

/** Collapses the dialog and picks the two ends of the known dimension (AC 2). */
export function startVerifyPick(): void {
  verifyStore.setState({ picking: true, pickStep: 1, pick: null, pickError: null });
  beginPick({
    step: (next) => verifyStore.setState({ pickStep: next }),
    done: (pick) => {
      const refused = pick ? tooClose(pick) : null;
      if (refused) {
        viewerCalibration.clearLine();
        verifyStore.setState({ picking: false, pick: null, pickError: refused });
        return;
      }
      verifyStore.setState({ picking: false, ...(pick ? { pick, pickError: null } : {}) });
    },
  });
}

/** Esc or Cancel in the instruction bar: stop picking, the dialog comes back as it was. */
export function cancelVerifyPick(): void {
  if (!verifyStore.getState().picking) return;
  abandonPick();
  verifyStore.setState({ picking: false });
}

/** The typed known distance in mm; null when empty; an error message when unreadable. */
export function knownDistance(state: Pick<VerifyState, "knownText" | "knownUnit">): { mm: number | null; error: string | null } {
  if (state.knownText.trim() === "") return { mm: null, error: null };
  const r = parseDistance(state.knownText, state.knownUnit);
  return r.ok ? { mm: r.mm, error: null } : { mm: null, error: r.message };
}

/**
 * Recalibrate… (AC 4): the Calibrate dialog opens on "By two points" with
 * this pick and the known distance; Verify closes (the picked line stays).
 * False without a pick or a readable known distance.
 */
export function recalibrate(): boolean {
  const state = verifyStore.getState();
  if (!state.pick || knownDistance(state).mm === null) return false;
  verifyStore.setState({ open: false, picking: false });
  openCalibrateWith({ pick: state.pick, distanceText: state.knownText, distanceUnit: state.knownUnit });
  return true;
}

// The Calibrate dialog opening (status bar, menus) closes Verify: one of them at a time.
calibrateStore.subscribe((s, prev) => {
  if (s.open && s.session !== prev.session && verifyStore.getState().open) {
    verifyStore.setState({ open: false, picking: false });
  }
});

// Another drawing shown ends Verify.
tabsStore.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId) closeVerify();
});

// Another page shown while Verify is open (AC 2, as 4.3 review R4) moves it to that page and drops
// the pick; a page without a calibration closes it (it has nothing to verify).
viewerStore.subscribe((s) => {
  const ui = verifyStore.getState();
  if (!ui.open || !hasDocument(s)) return;
  if (!calibrationOf(s, s.pageIndex)) {
    closeVerify();
    return;
  }
  if (s.pageIndex === ui.pageIndex) return;
  if (ui.pick) viewerCalibration.clearLine();
  verifyStore.setState({ pageIndex: s.pageIndex, pick: null, pickError: null });
});
