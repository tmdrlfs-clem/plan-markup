// The scale of the shown page for the ScaleIndicator (Story 3.7 AC 3, UX-DR9).
// Story 4.2 adds what is printed on the page (detected, to verify); a
// calibration (Story 4.3) will take precedence over it.

import { conversionNote, scaleLabel, type PageScales } from "@/core/scale/detect";

export type ScaleState =
  | { kind: "not-set" }
  /** Calibrated (✓ Scale 1:100). */
  | { kind: "set"; label: string }
  /** Read from the drawing, not confirmed (Scale 1:100 detected — Verify); `note` explains a sheet conversion. */
  | { kind: "detected"; label: string; note?: string | null }
  /** Viewports with different scales on the page ("2 scales on page"); `list` names them. */
  | { kind: "mixed"; count: number; list?: string[] };

export const SCALE_NOT_SET: ScaleState = { kind: "not-set" };

/**
 * The scale of the shown page from its detected scales (Story 4.2): none
 * found (or not looked at yet) is "not set"; one is "detected" (with the
 * printed and the converted ratio when the sheet differs, AC 2); several are
 * "N scales on page". Calibration (Story 4.3) comes first once it exists.
 */
export function scaleStateOf(scales?: PageScales | null): ScaleState {
  const list = scales?.scales ?? [];
  if (list.length === 0) return SCALE_NOT_SET;
  const describe = (s: (typeof list)[number]) => {
    const note = conversionNote(s, scales!.pageSheet);
    return { label: note ? `1:${s.effective} (${scaleLabel(s)})` : scaleLabel(s), note };
  };
  if (list.length === 1) return { kind: "detected", ...describe(list[0]) };
  return { kind: "mixed", count: list.length, list: list.map((s) => describe(s).note ?? describe(s).label) };
}
