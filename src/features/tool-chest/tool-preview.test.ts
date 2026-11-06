import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import { previewView } from "./tool-preview";

const line = {
  id: "00000000-0000-7000-8000-000000000001",
  pageId: "tool:0",
  createdAt: "2026-11-07T00:00:00.000Z",
  style: DEFAULT_MARKUP_STYLE,
  type: "line",
  points: [
    { x: -20, y: -5 },
    { x: 20, y: 5 },
  ],
} as Markup;

describe("tool preview (Story 7.2)", () => {
  it("fits the markups into the square, centred, y up", () => {
    const v = previewView([line], 48, 2);
    expect(v.width).toBe(96);
    expect(v.height).toBe(96);
    // 96 device px less 2 × 8 px padding over a 40 pt width.
    expect(v.devicePerPt).toBeCloseTo(80 / 40);
    expect(v.toDevice({ x: 0, y: 0 })).toEqual({ x: 48, y: 48 });
    const top = v.toDevice({ x: 20, y: 5 });
    expect(top.x).toBeCloseTo(88);
    expect(top.y).toBeCloseTo(38);
  });
});
