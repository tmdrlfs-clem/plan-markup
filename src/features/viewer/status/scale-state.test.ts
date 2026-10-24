import { describe, expect, it } from "vitest";

import type { DetectedScale, PageScales } from "@/core/scale/detect";

import { SCALE_NOT_SET, scaleStateOf } from "./scale-state";
import { scaleItem } from "./status-items";

const scale = (ratio: number, sheet: string | null, effective = ratio): DetectedScale => ({ ratio, sheet, effective, imperial: false, text: `1:${ratio}`, count: 1, quads: [] });
const page = (scales: DetectedScale[], pageSheet: string | null = "A1"): PageScales => ({ scales, pageSheet });

describe("scaleStateOf (Story 4.2)", () => {
  it("nothing detected, or not looked at yet: Scale not set", () => {
    expect(scaleStateOf()).toBe(SCALE_NOT_SET);
    expect(scaleStateOf(page([]))).toBe(SCALE_NOT_SET);
  });

  it("one scale: detected, with the printed ratio and its sheet", () => {
    const state = scaleStateOf(page([scale(100, "A1")]));
    expect(state).toEqual({ kind: "detected", label: "1:100 @ A1", note: null });
    expect(scaleItem(state)).toMatchObject({ label: "Scale 1:100 @ A1 detected — Verify", tone: "warning" });
    expect(scaleItem(state).tooltip).toMatch(/confirm in Calibrate \(coming next\)/);
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
});
