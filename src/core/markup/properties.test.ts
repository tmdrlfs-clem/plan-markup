import { describe, expect, it } from "vitest";

import { DEFAULT_MARKUP_STYLE, markupSchema, type Markup } from "@/core/schema/markup";

import { fieldsOf, formatOf, sharedFields, sharedValue, sizeLabel, subjectOf, withChange, withFormat } from "./properties";

const BOX = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 50 },
  { x: 0, y: 50 },
];
let n = 0;
function make(type: string, extra: Record<string, unknown> = {}): Markup {
  n++;
  const points = type === "line" || type === "length" ? BOX.slice(0, 2) : BOX;
  return markupSchema.parse({ id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`, pageId: "doc:0", createdAt: "2026-11-05T00:00:00.000Z", style: DEFAULT_MARKUP_STYLE, type, points, ...extra });
}

describe("markup properties (Story 5.10)", () => {
  it("each type has its fields", () => {
    expect([...fieldsOf(make("rectangle"))].sort()).toEqual(["color", "fill", "opacity", "subject", "width"]);
    expect(fieldsOf(make("line")).has("fill")).toBe(false);
    expect([...fieldsOf(make("length"))].sort()).toEqual(["color", "fontSize", "opacity", "subject", "width"]);
    expect([...fieldsOf(make("text", { text: "A" }))].sort()).toEqual(["color", "fill", "fontSize", "opacity", "subject", "text", "width"]);
    expect(fieldsOf(make("typewriter", { text: "A" })).has("width")).toBe(false);
    expect([...fieldsOf(make("image", { src: "data:image/png;base64,AAAA" }))].sort()).toEqual(["opacity", "subject"]);
  });

  it("a selection shares the fields all have, in the panel's order; text only for one", () => {
    const text = make("text", { text: "A" });
    expect(sharedFields([make("rectangle"), make("line")])).toEqual(["subject", "color", "width", "opacity"]);
    expect(sharedFields([text])).toContain("text");
    expect(sharedFields([text, make("text", { text: "B" })])).not.toContain("text");
    expect(sharedFields([])).toEqual([]);
    expect(sizeLabel([text])).toBe("Font size");
    expect(sizeLabel([make("length")])).toBe("Caption size");
    expect(sizeLabel([text, make("length")])).toBe("Text size");
  });

  it("a value shared or mixed; the subject defaults to the type's name", () => {
    const a = make("rectangle");
    const b = withChange(make("rectangle"), { color: "#0000ff" });
    expect(sharedValue([a, a], (m) => m.style.color, null)).toBe("#ff0000");
    expect(sharedValue([a, b], (m) => m.style.color, null)).toBeNull();
    expect(subjectOf(a)).toBe("Rectangle");
    expect(subjectOf(withChange(a, { subject: " Riser " }))).toBe("Riser");
  });

  it("a change applies the fields the markup has; nothing changed: the same object", () => {
    const line = make("line");
    expect(withChange(line, { color: "#ff0000" })).toBe(line);
    expect(withChange(line, { fill: "#00ff00" })).toBe(line);
    const rect = withChange(make("rectangle"), { fill: "#00ff00", width: 3, opacity: 0.5 });
    expect(rect.style).toEqual({ ...DEFAULT_MARKUP_STYLE, fill: "#00ff00", width: 3, opacity: 0.5 });
    // Fill none and opacity 100 % drop the fields; the subject back to the type's name drops it too.
    const back = withChange(withChange(rect, { subject: "Tank" }), { fill: null, opacity: 1, subject: "Rectangle" });
    expect(back.style).toEqual({ ...DEFAULT_MARKUP_STYLE, width: 3 });
    expect("subject" in back).toBe(false);
    expect(markupSchema.safeParse(back).success).toBe(true);
    const text = withChange(make("text", { text: "A" }), { text: "B", fontSize: 14 });
    expect(text.type === "text" && text.text).toBe("B");
    expect(text.style.fontSize).toBe(14);
  });

  it("a copied format applies the style fields the target has", () => {
    const source = withChange(make("rectangle"), { color: "#0000ff", width: 4, fill: "#ffff00", opacity: 0.5 });
    const line = withFormat(make("line"), formatOf(source));
    expect(line.style).toEqual({ ...DEFAULT_MARKUP_STYLE, color: "#0000ff", width: 4, opacity: 0.5 });
    // No fill in the format: a filled target loses its fill.
    const filled = withChange(make("ellipse"), { fill: "#00ff00" });
    expect(withFormat(filled, formatOf(make("line"))).style.fill).toBeUndefined();
  });
});

describe("text format bar (founder 2026-11-21)", () => {
  it("sets and clears the face, bold, italic, underline, strikethrough and alignment of text only", () => {
    const box = make("text", { text: "Hi" });
    const bold = withChange(box, { font: "serif", bold: true, underline: true, align: "center" });
    expect(bold.style).toMatchObject({ font: "serif", bold: true, underline: true, align: "center" });
    const plain = withChange(bold, { font: null, bold: false, underline: false, align: null });
    expect(plain.style).toEqual(DEFAULT_MARKUP_STYLE);
    // A line has no text: unchanged (the same object).
    const line = make("line");
    expect(withChange(line, { bold: true, align: "right" })).toBe(line);
  });

  it("the format painter carries the text format", () => {
    const from = withChange(make("text", { text: "A" }), { italic: true, strike: true, font: "mono" });
    const to = withFormat(make("callout", { text: "B", points: [...BOX, { x: -20, y: -20 }] }), formatOf(from));
    expect(to.style).toMatchObject({ italic: true, strike: true, font: "mono" });
  });
});
