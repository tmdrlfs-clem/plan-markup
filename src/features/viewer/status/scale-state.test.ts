import { describe, expect, it } from "vitest";

import type { DetectedScale, PageScales } from "@/core/scale/detect";

import { SCALE_NOT_SET, scaleStateOf } from "./scale-state";
import { scaleItem } from "./status-items";

const scale = (ratio: number, sheet: string | null, effective = ratio): DetectedScale => ({
  ratio,
  sheet,
  effective,
  imperial: false,
  text: `1:${ratio}`,
  count: 1,
  quads: [],
  conflict: false,
  readings: [{ ratio, sheet, effective, text: `1:${ratio}` }],
});
/** L21's view title on its A1 page: 1:75 @ A1 and 1:200 @ A3 (= 1:100 on A1) disagree. */
const conflicting: DetectedScale = {
  ...scale(75, "A1"),
  conflict: true,
  readings: [
    { ratio: 75, sheet: "A1", effective: 75, text: "1 : 75 @ A1" },
    { ratio: 200, sheet: "A3", effective: 100, text: "1 : 200 @ A3" },
  ],
};
const page = (scales: DetectedScale[], pageSheet: string | null = "A1"): PageScales => ({ scales, pageSheet });

describe("scaleStateOf (Story 4.2)", () => {
  it("nothing detected, or not looked at yet: Scale not set", () => {
    expect(scaleStateOf()).toEqual({ kind: "not-set", pending: true });
    expect(scaleItem(scaleStateOf()).label).toBe("Scale not set");
    expect(scaleStateOf(page([]))).toBe(SCALE_NOT_SET);
  });

  it("one scale: detected, with the printed ratio and its sheet", () => {
    const state = scaleStateOf(page([scale(100, "A1")]));
    expect(state).toEqual({ kind: "detected", label: "1:100 @ A1", note: null });
    expect(scaleItem(state)).toMatchObject({ label: "Scale 1:100 @ A1 detected — Verify", tone: "warning" });
    expect(scaleItem(state).tooltip).toMatch(/click to confirm it in Calibrate/);
  });

  it("a scale stated for another sheet shows the page's ratio first and both in the tooltip", () => {
    const state = scaleStateOf(page([scale(100, "A1", 200)], "A3"));
    expect(state).toEqual({ kind: "detected", label: "1:200 (1:100 @ A1)", note: "1:100 @ A1 → 1:200 on this A3 page" });
    expect(scaleItem(state).label).toBe("Scale 1:200 (1:100 @ A1) detected — Verify");
    expect(scaleItem(state).tooltip).toMatch(/^1:100 @ A1 → 1:200 on this A3 page\. /);
  });

  it("several scales: N scales on page, the list in the tooltip", () => {
    const state = scaleStateOf(page([scale(100, "A1"), scale(50, null)]));
    expect(state).toEqual({ kind: "mixed", count: 2, list: ["1:100 @ A1", "1:50"] });
    expect(scaleItem(state)).toMatchObject({ label: "2 scales on page", tone: "warning" });
    expect(scaleItem(state).tooltip).toMatch(/: 1:100 @ A1; 1:50\./);
  });

  it("review D1: one view stated for two sheets that disagree: Scales disagree — Verify, both readings in the tooltip", () => {
    const state = scaleStateOf(page([conflicting]));
    expect(state).toEqual({ kind: "conflict", readings: ["1:75 @ A1 = 1:75 on this A1 page", "1:200 @ A3 = 1:100 on this A1 page"] });
    expect(scaleItem(state)).toMatchObject({ label: "Scales disagree — Verify", tone: "warning" });
    expect(scaleItem(state).tooltip).toMatch(/^Printed scales disagree: 1:75 @ A1 = 1:75 on this A1 page; 1:200 @ A3 = 1:100 on this A1 page\. /);
    // Beside another scale it is one entry of the list.
    expect(scaleStateOf(page([conflicting, scale(20, null)]))).toEqual({ kind: "mixed", count: 2, list: ["1:75 @ A1 / 1:200 @ A3 (disagree)", "1:20"] });
  });
});

describe("scaleStateOf with a calibration (Story 4.3 AC 5)", () => {
  it("a calibration comes before the printed scales", () => {
    const calibration = { xFactor: 100 * (25.4 / 72), yFactor: 100 * (25.4 / 72), unit: "mm" as const, precision: "0" as const, source: "ratio" as const, ratio: 100 };
    const state = scaleStateOf(page([conflicting]), calibration);
    expect(state).toMatchObject({ kind: "set", label: "Scale 1:100" });
    expect(scaleItem(state)).toMatchObject({ label: "Scale 1:100", tone: "success" });
  });
});
