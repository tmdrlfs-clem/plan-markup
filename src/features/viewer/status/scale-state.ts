// The scale of the shown page for the ScaleIndicator (Story 3.7 AC 3, UX-DR9).
// Calibration arrives with Epic 4 (Stories 4.3 / 4.4): until then every page
// is "not set". Those stories replace scaleStateOf; the indicator already
// shows every state.

export type ScaleState =
  | { kind: "not-set" }
  /** Calibrated (✓ Scale 1:100). */
  | { kind: "set"; label: string }
  /** Read from the title block, not confirmed (Scale 1:100 detected — Verify). */
  | { kind: "detected"; label: string }
  /** Viewports with different scales on the page ("2 scales on page"). */
  | { kind: "mixed"; count: number };

export const SCALE_NOT_SET: ScaleState = { kind: "not-set" };

/** The scale of the shown page. Always "not set" before Epic 4 (Story 4.3 adds the page and its calibration). */
export function scaleStateOf(): ScaleState {
  return SCALE_NOT_SET;
}
