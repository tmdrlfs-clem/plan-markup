import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import { addToolSchema, imageUpload, suggestedToolName, toolContentOf, toolMarkups, TOOL_PAGE } from "./tool";

const k = factorForRatio(100);
const CAL: Calibration = { xFactor: k, yFactor: k, unit: "mm", precision: "0", source: "ratio", ratio: 100 } as Calibration;
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const GROUP = "00000000-0000-7000-8000-00000000aaaa";
const LAYER = "00000000-0000-7000-8000-00000000bbbb";
const SET = "00000000-0000-4000-8000-000000000001";

let n = 0;
function mk(type: string, points: { x: number; y: number }[], extra: object = {}): Markup {
  n++;
  return {
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    pageId: "doc:0",
    createdAt: "2026-11-07T00:00:00.000Z",
    style: DEFAULT_MARKUP_STYLE,
    type,
    points,
    ...extra,
  } as Markup;
}

const BOX = [
  { x: 100, y: 100 },
  { x: 140, y: 100 },
  { x: 140, y: 120 },
  { x: 100, y: 120 },
];

describe("tool content (Story 7.2)", () => {
  it("centres the markups on the origin, off any page, layer or group, unlocked; keeps the page's scale", () => {
    const line = mk("line", [{ x: 100, y: 100 }, { x: 140, y: 120 }], { groupId: GROUP, layerId: LAYER, locked: true, subject: "Pipe" });
    const rect = mk("rectangle", BOX, { groupId: GROUP });
    const made = toolContentOf([line, rect], { calibration: CAL, userUnit: 1 })!;
    expect(made.image).toBeNull();
    const [a, b] = made.content.markups;
    expect(a).toMatchObject({ type: "line", pageId: TOOL_PAGE, subject: "Pipe", points: [{ x: -20, y: -10 }, { x: 20, y: 10 }] });
    expect(a).not.toHaveProperty("groupId");
    expect(a).not.toHaveProperty("layerId");
    expect(a).not.toHaveProperty("locked");
    expect(b.points[0]).toEqual({ x: -20, y: -10 });
    expect(made.content.calibration).toEqual(CAL);
    expect(suggestedToolName([line, rect])).toBe("Pipe");
    expect(suggestedToolName([mk("line", [{ x: 0, y: 0 }, { x: 1, y: 1 }]), mk("arrow", [{ x: 0, y: 0 }, { x: 1, y: 1 }])])).toBe("2 markups");
  });

  it("an image's pixels leave the content (one image a tool) and come back to draw", () => {
    const img = mk("image", BOX, { src: PNG });
    const made = toolContentOf([img], { calibration: null, userUnit: 1 })!;
    expect(made.image).toBe(PNG);
    expect(made.content.markups[0]).toMatchObject({ type: "image", asset: true });
    expect(made.content.markups[0]).not.toHaveProperty("src");
    expect(toolMarkups(made.content, "https://x/y.png")[0]).toMatchObject({ type: "image", src: "https://x/y.png" });
    expect(toolMarkups(made.content, null)).toEqual([]);
    expect(toolContentOf([img, mk("image", BOX, { src: PNG })], { calibration: null, userUnit: 1 })).toBeNull();
    expect(imageUpload(PNG)).toEqual({ type: "image/png", base64: "iVBORw0KGgo=" });
    expect(imageUpload("data:image/svg+xml;base64,AAAA")).toBeNull();
  });

  it("eraser strokes cannot become tools", () => {
    expect(toolContentOf([mk("eraser", [{ x: 0, y: 0 }, { x: 1, y: 1 }])], { calibration: null, userUnit: 1 })).toBeNull();
  });

  it("the input checks the content, the device and that an image comes with its pixels", () => {
    const made = toolContentOf([mk("rectangle", BOX)], { calibration: null, userUnit: 1 })!;
    const ok = { set: { id: SET }, name: " Head ", content: made.content, device: { group: "Sprinkler", label: "Pendant", description: "" }, image: null };
    const parsed = addToolSchema.parse(ok);
    expect(parsed.name).toBe("Head");
    expect(addToolSchema.safeParse({ ...ok, set: { name: "New set" } }).success).toBe(true);
    expect(addToolSchema.safeParse({ ...ok, device: { group: "", label: "x", description: "" } }).success).toBe(false);
    const withImage = toolContentOf([mk("image", BOX, { src: PNG })], { calibration: null, userUnit: 1 })!;
    expect(addToolSchema.safeParse({ ...ok, content: withImage.content }).success).toBe(false);
    expect(addToolSchema.safeParse({ ...ok, content: withImage.content, image: imageUpload(PNG) }).success).toBe(true);
    // Unknown fields in a markup are dropped (what is stored is the parsed content).
    const extra = { ...made.content, markups: [{ ...made.content.markups[0], extra: 1 }] };
    expect(addToolSchema.parse({ ...ok, content: extra }).content.markups[0]).not.toHaveProperty("extra");
  });
});
