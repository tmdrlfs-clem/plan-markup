import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Markup } from "../schema/markup";
import { FILL_ONLY_WIDTH, IMPORT_PAGE, convertItem, hexColor, isCountItem } from "./convert";
import { itemMarkups } from "./import";
import type { BtxItem } from "./parse";
import { parseBtx } from "./parse";
import { parsePdfObject, type PdfDict } from "./pdf-object";

const dict = (src: string) => parsePdfObject(new TextEncoder().encode(src)) as PdfDict;

/** An item of members given as PDF dictionary text and their (X, Y). */
function item(...members: Array<[string, number?, number?]>): BtxItem {
  return {
    name: "ABCDEFGHIJKLMNOP",
    type: "t",
    mode: undefined,
    annotations: members.map(([src, x = 0, y = 0], i) => ({ type: "", subtype: undefined, subject: undefined, dict: dict(src), x, y, index: i, role: i === 0 ? ("root" as const) : ("child" as const) })),
    resources: new Map(),
    missingRefs: [],
  };
}

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const convert = (it: BtxItem) => convertItem(it, "Tool", newId, "2026-11-07T00:00:00.000Z");
const one = (src: string) => {
  const out = convert(item([src]));
  expect(out).toHaveLength(1);
  return out![0]!;
};
const corners = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y1 },
  { x: x1, y: y1 },
  { x: x1, y: y0 },
  { x: x0, y: y0 },
];

describe(".btx → markups (Story 7.5)", () => {
  it("PDF colours: gray, RGB and CMYK as #rrggbb", () => {
    expect(hexColor([0.5])).toBe("#808080");
    expect(hexColor([1, 0, 0])).toBe("#ff0000");
    expect(hexColor([0, 1, 1, 0])).toBe("#ff0000");
    expect(hexColor([1, 2])).toBeUndefined();
    expect(hexColor(undefined)).toBeUndefined();
  });

  it("Circle: an ellipse on its centre line (inset by /RD), stroke, fill, width and dash", () => {
    const m = one("<</Subtype/Circle/Rect[0 0 24 16]/RD[1 1 1 1]/C[1 0 0]/IC[1 1 0]/BS<</W 2/S/D/D[3 2]>>/CA 0.8>>");
    expect(m).toMatchObject({ type: "ellipse", pageId: IMPORT_PAGE, subject: "Tool", points: corners(1, 1, 23, 15) });
    expect(m.style).toEqual({ color: "#ff0000", width: 2, fontSize: 10, dash: [3, 2], fill: "#ffff00", opacity: 0.8 });
  });

  it("a fill-only shape strokes a hairline in its fill; with no stroke and no fill it is dropped", () => {
    const dot = one("<</Subtype/Circle/Rect[0 0 8 8]/RD[0 0 0 0]/C[0 0 1]/IC[0 0 1]/BS<</W 0>>/FillOpacity 0.5>>");
    expect(dot.style).toEqual({ color: "#0000ff", width: FILL_ONLY_WIDTH, fontSize: 10, fill: "#0000ff", opacity: 0.5 });
    expect(dot.points).toEqual(corners(0, 0, 8, 8));
    expect(convert(item(["<</Subtype/Square/Rect[0 0 8 8]/BS<</W 1>>>>"]))).toBeNull();
  });

  it("Square: a rectangle inset by half its width; an image square stays an image", () => {
    expect(one("<</Subtype/Square/Rect[0 0 10 10]/C[0 0 0]/BS<</W 2>>>>")).toMatchObject({ type: "rectangle", points: corners(1, 1, 9, 9) });
    expect(convert(item(["<</Subtype/Square/Rect[0 0 10 10]/C[0 0 0]/Image/BBObjPtr_AAAAAAAAAAAAAAAA>>"]))).toBeNull();
  });

  it("Line: a line, or an arrow toward its one arrow head", () => {
    expect(one("<</Subtype/Line/L[0 0 10 0]/Rect[0 0 10 1]/C[0 0 0]>>")).toMatchObject({ type: "line", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(one("<</Subtype/Line/L[0 0 10 0]/LE[/None/OpenArrow]/Rect[0 0 10 1]/C[0 0 0]>>")).toMatchObject({ type: "arrow", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(one("<</Subtype/Line/L[0 0 10 0]/LE[/ClosedArrow/None]/Rect[0 0 10 1]/C[0 0 0]>>")).toMatchObject({ type: "arrow", points: [{ x: 10, y: 0 }, { x: 0, y: 0 }] });
  });

  it("PolyLine and Polygon (a polygon keeps its fill; a polyline has none)", () => {
    const pl = one("<</Subtype/PolyLine/Vertices[0 0 10 10 20 0]/Rect[0 0 20 10]/C[0 0.5 0]/IC[1 0 0]>>");
    expect(pl).toMatchObject({ type: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }] });
    expect(pl.style.fill).toBeUndefined();
    expect(one("<</Subtype/Polygon/Vertices[0 0 10 10 20 0]/Rect[0 0 20 10]/C[0 0 0]/IC[1 0 0]>>")).toMatchObject({ type: "polygon", style: { fill: "#ff0000" } });
  });

  it("Ink: one pen stroke a path at a uniform width (pressure and dash dropped); a dot keeps two points", () => {
    const out = convert(item(["<</Subtype/Ink/InkList[[0 0 5 5 10 0][3 3]]/PressureList[[1 2 3]]/Rect[0 0 10 5]/C[1 0 0]/BS<</W 3/S/D/D[2]>>>>"]))!;
    expect(out.map((m) => m.type)).toEqual(["pen", "pen"]);
    expect(out[0]!.style).toEqual({ color: "#ff0000", width: 3, fontSize: 10 });
    expect(out[1]!.points).toEqual([{ x: 3, y: 3 }, { x: 3, y: 3 }]);
  });

  it("FreeText: a text box with its /DA size and colour; Calibri draws in Carlito; no border is a typewriter", () => {
    const t = one("<</Subtype/FreeText/Rect[0 0 40 20]/Contents(UD)/DA(0 0 1 rg /Calibri 12 Tf)/C[1 0 0]/BS<</W 1>>>>") as Extract<Markup, { type: "text" }>;
    expect(t).toMatchObject({ type: "text", text: "UD", points: corners(0, 0, 40, 20) });
    expect(t.style).toEqual({ color: "#0000ff", width: 1, fontSize: 12, font: "carlito" });
    const plain = one("<</Subtype/FreeText/Rect[0 0 40 20]/Contents(1\\r2)/DA(/Helv 9 Tf 0 g)>>");
    expect(plain).toMatchObject({ type: "typewriter", text: "1\n2", style: { color: "#000000", fontSize: 9 } });
    expect(plain.style.font).toBeUndefined();
  });

  it("a group: every member at its -(X, Y) offset, in file order", () => {
    const out = convert(
      item(
        ["<</Subtype/Circle/Rect[0 0 20 20]/RD[1.5 1.5 1.5 1.5]/C[0 0 1]/BS<</W 3>>>>", 0, 0],
        ["<</Subtype/Circle/Rect[0 0 8 8]/RD[0 0 0 0]/IC[0 0 1]/BS<</W 0>>>>", -6, -6],
      ),
    )!;
    expect(out.map((m) => m.type)).toEqual(["ellipse", "ellipse"]);
    expect(out[1]!.points).toEqual(corners(6, 6, 14, 14));
  });

  it("stays an image: a stamp, a member with an appearance, a count, an unknown kind, bad geometry", () => {
    expect(convert(item(["<</Subtype/Stamp/Rect[0 0 10 10]/AP<</N/BBObjPtr_AAAAAAAAAAAAAAAA>>>>"]))).toBeNull();
    expect(convert(item(["<</Subtype/Circle/Rect[0 0 10 10]/C[0 0 0]/AP<</N/BBObjPtr_AAAAAAAAAAAAAAAA>>>>"]))).toBeNull();
    const count = item(["<</Subtype/Polygon/IT/PolygonCount/Vertices[0 0 1 1 2 0]/Rect[0 0 2 1]/C[1 0 0]>>"]);
    expect(isCountItem(count)).toBe(true);
    expect(convert(count)).toBeNull();
    expect(convert(item(["<</Subtype/Circle/Rect[0 0 10 10]/C[0 0 0]>>"], ["<</Subtype/Caret/Rect[0 0 1 1]>>"]))).toBeNull();
    expect(convert(item(["<</Subtype/Line/L[0 0]/Rect[0 0 1 1]/C[0 0 0]>>"]))).toBeNull();
    expect(convert(item(["<</Subtype/Circle/Rect[0 0 2 2]/C[0 0 0]/BS<</W 4>>>>"]))).toBeNull();
  });

  it("the synthetic set: the stamp stays an image, the others convert", async () => {
    const set = await parseBtx(new Uint8Array(readFileSync(new URL("../../../fixtures/btx/synthetic.btx", import.meta.url))));
    const kinds = set.items.map((it, i) => itemMarkups(it, `T${i}`)?.map((m) => m.type).join("+") ?? "image");
    expect(kinds).toEqual(["image", "ellipse", "ellipse+ellipse", "polyline", "arrow"]);
  });
});

// The founder's files (gitignored; this runs only where they are).
const PRIVATE = ["sprinkler-tools", "fire-alarm-tools", "my-tools"].map((s) => new URL(`../../../fixtures/private/btx/${s}.btx`, import.meta.url));
describe.skipIf(!PRIVATE.every((u) => existsSync(u)))("the founder's 138 items (private)", () => {
  it("every Revu-drawn shape, line, ink and text item converts; the rest stay images", async () => {
    const counts = { markups: 0, image: 0 };
    for (const url of PRIVATE) {
      const set = await parseBtx(new Uint8Array(readFileSync(url)));
      for (const [i, it] of set.items.entries()) {
        const vector = it.annotations.every((a) => ["Square", "Circle", "Line", "PolyLine", "Polygon", "Ink", "FreeText"].includes(String(a.subtype)));
        const out = itemMarkups(it, `T${i}`);
        counts[out ? "markups" : "image"]++;
        // Image squares and members carrying their own appearance stay images.
        if (out) expect(vector).toBe(true);
      }
    }
    expect(counts.markups + counts.image).toBe(138);
    // 2026-11-07: 23 items are bare shapes, lines, ink or text (sprinkler 14, my-tools 9); the rest are stamps, image squares, counts and one text+stamp group.
    expect(counts.markups).toBe(23);
  });
});
