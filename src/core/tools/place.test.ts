import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, markupSchema, type Markup } from "@/core/schema/markup";

import { anchorTopLeft, deviceCounts, deviceText, needsScale, placedMarkups, toolScale, type PlacedTool } from "./place";
import { toolContentOf } from "./tool";

const cal = (ratio: number): Calibration => ({ xFactor: factorForRatio(ratio), yFactor: factorForRatio(ratio), unit: "mm", precision: "0", source: "ratio", ratio }) as Calibration;
const PNG = "data:image/png;base64,iVBORw0KGgo=";

let n = 0;
function mk(type: string, points: { x: number; y: number }[], extra: object = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: "src:0",
    createdAt: "2026-11-07T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type,
    points,
    ...extra,
  } as Markup;
}

const line = () => mk("line", [{ x: 100, y: 100 }, { x: 140, y: 120 }]);
const box = () => mk("rectangle", [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 120 }, { x: 100, y: 120 }]);

function tool(markups: Markup[], calibration: Calibration | null, extra: Partial<PlacedTool> = {}): PlacedTool {
  const made = toolContentOf(markups, { calibration, userUnit: 1 })!;
  return { content: made.content, imageSrc: made.image, device: null, ...extra };
}

let id = 0;
const newId = () => `00000000-0000-7000-8000-${String(++id + 5000).padStart(12, "0")}`;
const T = "2026-11-08T00:00:00.000Z";

describe("placing a tool (Story 7.3)", () => {
  it("an unscaled tool keeps its paper size; a scaled one needs the page's scale and is placed at real size", () => {
    const plain = tool([line()], null);
    expect(needsScale(plain.content)).toBe(false);
    expect(toolScale(plain.content, { calibration: null, userUnit: 1 })).toEqual({ sx: 1, sy: 1 });
    // UserUnit 2 on the target: half the user units for the same paper size.
    expect(toolScale(plain.content, { calibration: cal(50), userUnit: 2 })).toEqual({ sx: 0.5, sy: 0.5 });

    const real = tool([line()], cal(100));
    expect(needsScale(real.content)).toBe(true);
    expect(toolScale(real.content, { calibration: null, userUnit: 1 })).toBeNull();
    // Drawn at 1:100, placed on 1:50: the same real size is twice as long on paper.
    const s = toolScale(real.content, { calibration: cal(50), userUnit: 1 })!;
    expect(s.sx).toBeCloseTo(2);
    expect(s.sy).toBeCloseTo(2);
    expect(placedMarkups(real, { x: 0, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)).toBeNull();
  });

  it("centres the markups on the click, on the target page, with new ids; several become one group", () => {
    const t = tool([line(), box()], cal(100));
    const placed = placedMarkups(t, { x: 500, y: 300 }, { pageId: "p:0", calibration: cal(50), userUnit: 1 }, newId, T)!;
    expect(placed).toHaveLength(2);
    for (const m of placed) expect(markupSchema.safeParse(m).success).toBe(true);
    expect(placed.map((m) => m.pageId)).toEqual(["p:0", "p:0"]);
    expect(placed[0].createdAt).toBe(T);
    expect(placed[0].groupId).toBe(placed[0].id);
    expect(placed[1].groupId).toBe(placed[0].id);
    // The box (40 × 20 at 1:100) is 80 × 40 at 1:50, centred on (500, 300).
    expect(placed[1].points[0].x).toBeCloseTo(460);
    expect(placed[1].points[0].y).toBeCloseTo(280);
    expect(placed[1].points[2]!.x).toBeCloseTo(540);
    expect(placed[1].points[2]!.y).toBeCloseTo(320);
    const single = placedMarkups(tool([line()], null), { x: 0, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)!;
    expect(single[0].groupId).toBeUndefined();
  });

  it("a device counts once, by the placement's first markup", () => {
    const t = tool([line(), box()], null, { device: { group: "Sprinklers", label: "Pendant", description: "15 mm" } });
    const placed = placedMarkups(t, { x: 0, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)!;
    expect(placed[0].device).toEqual({ group: "Sprinklers", label: "Pendant" });
    expect(placed[1].device).toBeUndefined();
    const again = placedMarkups(t, { x: 50, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)!;
    const other = placedMarkups(tool([line()], null, { device: { group: "Alarms", label: "Bell", description: "" } }), { x: 0, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)!;
    expect(deviceCounts([...placed, ...again, ...other, line()])).toEqual([
      { group: "Alarms", label: "Bell", count: 1 },
      { group: "Sprinklers", label: "Pendant", count: 2 },
    ]);
    expect(deviceText(placed[0].device)).toBe("Sprinklers · Pendant");
    expect(deviceText(undefined)).toBe("");
  });

  it("an image tool needs its image loaded; a placed device saved as a tool is not counted twice", () => {
    const img = mk("image", [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], { src: PNG });
    const t = tool([img], null);
    expect(placedMarkups({ ...t, imageSrc: null }, { x: 0, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)).toBeNull();
    expect(placedMarkups(t, { x: 0, y: 0 }, { pageId: "p:0", calibration: null, userUnit: 1 }, newId, T)![0]).toMatchObject({ type: "image", src: PNG });
    const counted = mk("line", [{ x: 0, y: 0 }, { x: 1, y: 1 }], { device: { group: "A", label: "B" } });
    expect(toolContentOf([counted], { calibration: null, userUnit: 1 })!.content.markups[0]).not.toHaveProperty("device");
  });
});

describe("anchorTopLeft: the pointer holds a placement's top-left corner on screen", () => {
  const at = { x: 500, y: 500 };
  const placed = () => [box(), line()]; // together x 100..140, y 100..120

  it("upright with y up (a PDF page): the box's left, top edge is at the pointer", () => {
    const moved = anchorTopLeft(placed(), at, (p) => ({ x: p.x, y: -p.y }));
    expect(moved[0].points).toEqual([{ x: 500, y: 480 }, { x: 540, y: 480 }, { x: 540, y: 500 }, { x: 500, y: 500 }]);
    expect(moved[1].points).toEqual([{ x: 500, y: 480 }, { x: 540, y: 500 }]);
  });

  it("with the view turned a quarter (y up turned to x right), the corner shown top-left is used", () => {
    // Screen x = user y, screen y = user x: the user-space minimum corner is the screen's top-left.
    const moved = anchorTopLeft(placed(), at, (p) => ({ x: p.y, y: p.x }));
    expect(moved[0].points[0]).toEqual({ x: 500, y: 500 });
  });

  it("keeps ids and leaves nothing to move unchanged", () => {
    const m = placed();
    expect(anchorTopLeft(m, at, (p) => p).map((x) => x.id)).toEqual(m.map((x) => x.id));
    expect(anchorTopLeft([], at, (p) => p)).toEqual([]);
  });
});
