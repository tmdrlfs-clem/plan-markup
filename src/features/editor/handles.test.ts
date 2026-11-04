import { describe, expect, it } from "vitest";

import { boxCorners } from "@/core/markup/shapes";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import type { LayerView } from "@/features/viewer";

import { handlesOf, vertexIndices } from "./handles";

const view: LayerView = {
  documentId: "d",
  pageIndex: 0,
  userUnit: 1,
  toDevice: (p) => ({ x: p.x, y: -p.y }),
  devicePerPt: 1,
  dpr: 1,
  width: 0,
  height: 0,
  colors: { halo: "#ffffff", warning: "#8a6400", selection: "#ff7a1a", fontFamily: "sans-serif" },
};

function shape(type: "rectangle" | "ellipse" | "cloud"): Markup {
  return {
    id: "00000000-0000-7000-8000-000000000001",
    pageId: "d:0",
    createdAt: "2026-11-04T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type,
    points: boxCorners({ x: 0, y: 0 }, { x: 200, y: 100 }),
  };
}

const kinds = (m: Markup) => handlesOf([m], view)!.handles.map((h) => h.kind);

describe("handles of boxes and clouds (Story 5.5, D3)", () => {
  it("a rectangle or an ellipse has the box's handles only; a cloud a handle on each corner too", () => {
    for (const type of ["rectangle", "ellipse"] as const) {
      expect(kinds(shape(type)).filter((k) => k === "vertex")).toHaveLength(0);
      expect(kinds(shape(type)).filter((k) => k === "resize")).toHaveLength(8);
      expect(kinds(shape(type))).toContain("rotate");
    }
    expect(kinds(shape("cloud")).filter((k) => k === "vertex")).toHaveLength(4);
  });
});

describe("vertex handles of text markups (Story 5.6)", () => {
  const box = boxCorners({ x: 0, y: 0 }, { x: 200, y: 100 });
  const text = (type: Markup["type"], points: { x: number; y: number }[]) => ({ ...shape("rectangle"), type, points, text: "x" }) as Markup;

  it("only a callout's tip and a Cloud+'s cloud corners", () => {
    expect(vertexIndices(text("text", box))).toEqual([]);
    expect(vertexIndices(text("typewriter", box))).toEqual([]);
    expect(vertexIndices(text("note", [{ x: 0, y: 0 }]))).toEqual([]);
    expect(vertexIndices(text("callout", [...box, { x: 300, y: 50 }]))).toEqual([4]);
    expect(vertexIndices(text("cloudplus", [{ x: 300, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, ...box]))).toEqual([0, 1, 2]);
  });
});
