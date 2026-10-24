// The two-point pick shared by the Calibrate and Verify dialogs (Stories 4.3, 4.4).
//
// One pick at a time on the active drawing (viewerCalibration). Each pick has
// a token: abandoning it (the dialog closed, reopened, another pick or the
// other dialog started) cancels the engine's pick and its callbacks are
// ignored from then on (4.3 review R3).

import { viewerCalibration, viewerCommands, type CalibrationPick } from "@/features/viewer";

/** A pick shorter than this on screen (CSS px) is refused (4.3 AC 2, 4.4 AC 2). */
export const MIN_PICK_PX = 10;

export type PickHandlers = {
  /** The point to click next. */
  step(next: 1 | 2): void;
  /** The result: null when cancelled (Esc, another tool, page or tab). */
  done(pick: CalibrationPick | null): void;
};

let token = 0;
/** The token of the pick in progress, or null. */
let active: number | null = null;

/** Ends the pick in progress, if any, without its callbacks reaching anyone. */
export function abandonPick(): void {
  if (active === null) return;
  active = null;
  token++;
  viewerCalibration.cancelPick();
}

/** A pick is in progress. */
export function picking(): boolean {
  return active !== null;
}

/** Starts a pick on the active drawing (focus goes to the canvas); a pick in progress is abandoned first. */
export function beginPick(handlers: PickHandlers): void {
  abandonPick();
  const mine = ++token;
  active = mine;
  viewerCalibration.clearLine();
  viewerCommands.focusCanvas();
  viewerCalibration.startPick({
    step: (next) => {
      if (token === mine) handlers.step(next);
    },
    done: (pick) => {
      if (token !== mine) return;
      active = null;
      token++;
      handlers.done(pick);
    },
  });
}

/** The message for a pick that is too short on screen, or null when it is long enough. */
export function tooClose(pick: CalibrationPick): string | null {
  if (pick.screenPx >= MIN_PICK_PX) return null;
  return `The two points are too close (${pick.screenPx.toFixed(0)} px). Pick points at least ${MIN_PICK_PX} px apart.`;
}
