import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";
import { previewView } from "@/features/tool-chest/tool-preview";

import { CARLITO_FAMILY, fontFamilyOf, loadMarkupFonts } from "./fonts";
import { paintMarkupsPreview } from "./measure-tool";

/** A context that records calls (with their arguments) and the font in use when text is drawn. */
function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (_t, prop: string) =>
      prop in props
        ? props[prop]
        : prop === "measureText"
          ? (text: string) => ({ width: text.length * 5 })
          : (...args: unknown[]) => void calls.push([prop === "fillText" ? `fillText:${String(props.font)}` : prop, args]),
    set: (_t, prop: string, value) => ((props[prop] = value), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const base = { id: "00000000-0000-4000-8000-000000000001", pageId: "tool:0", createdAt: "2026-11-07T00:00:00.000Z" };
const box = [
  { x: 0, y: 20 },
  { x: 40, y: 20 },
  { x: 40, y: 0 },
  { x: 0, y: 0 },
];

describe("Story 7.5: imported dash and Carlito text", () => {
  it("a dashed shape strokes with its pattern in page units, then solid again", () => {
    const m = { ...base, type: "ellipse", points: box, style: { ...DEFAULT_MARKUP_STYLE, dash: [3, 2] } } as Markup;
    const view = previewView([m], 48, 1);
    const { ctx, calls } = recorder();
    paintMarkupsPreview(ctx, [m], view, null);
    const dashes = calls.filter(([name]) => name === "setLineDash").map(([, args]) => args[0]);
    expect(dashes[0]).toEqual([3 * view.devicePerPt, 2 * view.devicePerPt]);
    expect(dashes.at(-1)).toEqual([]);
  });

  it("text asking for Carlito draws in it, with the app's face behind it", async () => {
    expect(fontFamilyOf({ font: "carlito" }, "Inter")).toBe(`${CARLITO_FAMILY}, Inter`);
    expect(fontFamilyOf({}, "Inter")).toBe("Inter");
    const m = { ...base, type: "typewriter", text: "UD", points: box, style: { ...DEFAULT_MARKUP_STYLE, fontSize: 12, font: "carlito" } } as Markup;
    const { ctx, calls } = recorder();
    paintMarkupsPreview(ctx, [m], previewView([m], 48, 1), null);
    expect(calls.some(([name]) => name.startsWith("fillText:") && name.includes(CARLITO_FAMILY))).toBe(true);
    // No FontFace here (node): loading resolves at once.
    await expect(loadMarkupFonts([m])).resolves.toBeUndefined();
  });
});
