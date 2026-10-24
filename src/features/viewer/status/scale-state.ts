// The scale of the shown page for the ScaleIndicator (Story 3.7 AC 3, UX-DR9).
// Story 4.2 adds what is printed on the page (detected, to verify); a
// calibration (Story 4.3) will take precedence over it.

import { conflictReadings, conversionNote, readingLabel, scaleLabel, type DetectedScale, type PageScales } from "@/core/scale/detect";

export type ScaleState =
  /** `pending`: the page's printed scales have not been read yet (4.2 review D7). */
  | { kind: "not-set"; pending?: boolean }
  /** Calibrated (✓ Scale 1:100). */
  | { kind: "set"; label: string }
  /** Read from the drawing, not confirmed (Scale 1:100 detected — Verify); `note` explains a sheet conversion. */
  | { kind: "detected"; label: string; note?: string | null }
  /** One view stated for two sheets that disagree (4.2 review D1): "Scales disagree — Verify"; `readings` for the tooltip. */
  | { kind: "conflict"; readings: string[] }
  /** Viewports with different scales on the page ("2 scales on page"); `list` names them. */
  | { kind: "mixed"; count: number; list?: string[] };

export const SCALE_NOT_SET: ScaleState = { kind: "not-set" };
export const SCALE_PENDING: ScaleState = { kind: "not-set", pending: true };

/**
 * The scale of the shown page from its detected scales (Story 4.2): not
 * looked at yet is "not set" (pending); none found is "not set"; one is
 * "detected" (with the printed and the converted ratio when the sheet
 * differs, AC 2), or "conflict" when its sheet statements disagree; several
 * are "N scales on page". Calibration (Story 4.3) comes first once it exists.
 */
export function scaleStateOf(scales?: PageScales | null): ScaleState {
  if (!scales) return SCALE_PENDING;
  const list = scales.scales;
  if (list.length === 0) return SCALE_NOT_SET;
  const describe = (s: DetectedScale) => {
    if (s.conflict) return { label: `${s.readings.map(readingLabel).join(" / ")} (disagree)`, note: null };
    const note = conversionNote(s, scales.pageSheet);
    return { label: note ? `1:${s.effective} (${scaleLabel(s)})` : scaleLabel(s), note };
  };
  if (list.length === 1) {
    if (list[0].conflict) return { kind: "conflict", readings: conflictReadings(list[0], scales.pageSheet) };
    return { kind: "detected", ...describe(list[0]) };
  }
  return { kind: "mixed", count: list.length, list: list.map((s) => describe(s).note ?? describe(s).label) };
}
