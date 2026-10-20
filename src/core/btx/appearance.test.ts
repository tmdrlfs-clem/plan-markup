import { describe, expect, it } from "vitest";

import {
  borderOf,
  colorOp,
  fmt,
  generateAppearance,
  hasAppearance,
  lineEnding,
  literalText,
  parseDefaultAppearance,
} from "./appearance";
import { parsePdfObject, type PdfDict } from "./pdf-object";

const dict = (s: string) => parsePdfObject(Uint8Array.from(s, (c) => c.charCodeAt(0))) as PdfDict;
const ap = (s: string) => {
  const out = generateAppearance(dict(s));
  if (!out) throw new Error("no appearance");
  return out;
};

describe("helpers", () => {
  it("formats numbers compactly", () => {
    expect(fmt(1)).toBe("1");
    expect(fmt(0.123456)).toBe("0.1235");
    expect(fmt(-0.00001)).toBe("0");
    expect(fmt(2.5)).toBe("2.5");
  });

  it("maps /C arrays to colour operators", () => {
    expect(colorOp([1, 0, 0], true)).toBe("1 0 0 RG");
    expect(colorOp([0.5], false)).toBe("0.5 g");
    expect(colorOp([0, 0, 0, 1], false)).toBe("0 0 0 1 k");
    expect(colorOp([], true)).toBeUndefined();
  });

  it("reads border width and dash", () => {
    expect(borderOf(dict("<</BS<</W 3/S/D/D[2 2]>>>>"))).toEqual({ width: 3, dash: [2, 2] });
    expect(borderOf(dict("<</BS<</W 0/S/S>>>>"))).toEqual({ width: 0, dash: undefined });
    expect(borderOf(dict("<<>>"))).toEqual({ width: 1, dash: undefined });
  });

  it("parses /DA colour and size", () => {
    expect(parseDefaultAppearance("1 0 0 rg /Calibri 2 Tf")).toEqual({ color: [1, 0, 0], size: 2 });
    expect(parseDefaultAppearance(undefined)).toEqual({ color: [0], size: 12 });
  });

  it("escapes literal text", () => {
    expect(literalText("a(b)\\é€")).toBe("a\\(b\\)\\\\\\351?");
  });

  it("detects /AP /N", () => {
    expect(hasAppearance(dict("<</AP<</N/BBObjPtr_AAAAAAAAAAAAAAAA>>>>"))).toBe(true);
    expect(hasAppearance(dict("<</Subtype/Circle>>"))).toBe(false);
  });
});

describe("generateAppearance", () => {
  it("circle: 4 Béziers inset by /RD, fill /IC, dashed stroke /C", () => {
    const out = ap("<</Subtype/Circle/Rect[0 0 24 16]/RD[1 1 1 1]/IC[1 1 0]/C[1 0 0]/BS<</W 2/S/D/D[3 2]>>>>");
    expect(out.bbox).toEqual([0, 0, 24, 16]);
    expect(out.content).toContain("1 1 0 rg");
    expect(out.content).toContain("1 0 0 RG");
    expect(out.content).toContain("2 w");
    expect(out.content).toContain("[3 2] 0 d");
    expect(out.content.match(/ c$/gm)).toHaveLength(4);
    expect(out.content).toContain("23 8 m"); // right-most point: 24 - RD 1
    expect(out.content.trim().endsWith("B")).toBe(true);
  });

  it("width 0 → no stroke (fill only)", () => {
    const out = ap("<</Subtype/Circle/Rect[0 0 8 8]/IC[0 0 1]/C[0 0 1]/BS<</W 0/S/S>>>>");
    expect(out.content).not.toContain(" RG");
    expect(out.content).not.toMatch(/ w$/m);
    expect(out.content.trim().endsWith("f")).toBe(true);
  });

  it("FillOpacity / CA become an ExtGState", () => {
    const out = ap("<</Subtype/Square/Rect[0 0 4 4]/IC[1 1 1]/FillOpacity 0.5/CA 0.8>>");
    expect(out.extGStates.GS0).toEqual({ CA: 0.8, ca: 0.4 });
    expect(out.content).toContain("/GS0 gs");
  });

  it("square with /Image draws the image XObject into the rect", () => {
    const out = ap("<</Subtype/Square/Image/BBObjPtr_IMAGEAAAAAAAAAAA/Rect[0 0 10 6]/RD[0 0 0 0]/C[1 0 0]/BS<</W 0>>>>");
    expect(out.xObjects).toEqual({ Im0: "IMAGEAAAAAAAAAAA" });
    expect(out.content).toContain("10 0 0 6 0 0 cm");
    expect(out.content).toContain("/Im0 Do");
    expect(out.content).not.toContain(" re");
  });

  it("line: segment from /L, open arrow at the end only", () => {
    const out = ap("<</Subtype/Line/L[4 10 40 10]/LE[/None/OpenArrow]/Rect[0 0 44 20]/C[0 0 0]/BS<</W 1.5>>>>");
    expect(out.content).toContain("4 10 m\n40 10 l");
    expect(out.content).toContain("40 10 l"); // arrow tip
    expect(out.content).toContain("31 14.5 m"); // arrow wing: 40 - 2*4.5, 10 + 4.5
    expect(out.content.match(/^S$/gm)).toHaveLength(2);
  });

  it("line ending shapes", () => {
    expect(lineEnding("None", [0, 0], [-1, 0], 1)).toBeUndefined();
    expect(lineEnding("ClosedArrow", [0, 0], [-1, 0], 1)?.closed).toBe(true);
    expect(lineEnding("Circle", [0, 0], [-1, 0], 1)?.ops).toContain(" c");
  });

  it("polyline through /Vertices; polygon closes and fills", () => {
    const pl = ap("<</Subtype/PolyLine/Vertices[4 4 14 16 24 6]/Rect[0 0 30 20]/C[0 0.5 0]/IC[0 0.5 0]/BS<</W 2>>>>");
    expect(pl.content).toContain("4 4 m\n14 16 l\n24 6 l");
    expect(pl.content).not.toContain("\nh");
    const pg = ap("<</Subtype/Polygon/Vertices[0 0 10 0 5 8]/Rect[0 0 10 8]/C[0 0 0]/IC[1 0 0]>>");
    expect(pg.content).toContain("\nh\nB");
  });

  it("ink: round caps/joins, one path per stroke", () => {
    const out = ap("<</Subtype/Ink/InkList[[1 1 2 2 3 1][5 5]]/Rect[0 0 10 10]/C[0 0 0]/BS<</W 1.75>>>>");
    expect(out.content).toContain("1 J 1 j");
    expect(out.content).toContain("1.75 w");
    expect(out.content.match(/^S$/gm)).toHaveLength(2);
    expect(out.content).toContain("5 5 m\n5 5 l"); // single point → dot
  });

  it("free text: /DA colour and size with a standard font, no border when width 0", () => {
    const out = ap(
      "<</Subtype/FreeText/Rect[0 0 14.4 20]/DA(1 0 0 rg /Calibri 4 Tf)/DS(font: Calibri 4pt; margin:3pt; line-height:4.6pt)/Contents(UD)/C[]/BS<</W 0>>>>",
    );
    expect(out.fonts).toEqual({ Helv: "Helvetica" });
    expect(out.content).toContain("/Helv 4 Tf");
    expect(out.content).toContain("1 0 0 rg");
    expect(out.content).toContain("(UD) Tj");
    expect(out.content).not.toContain(" RG");
  });

  it("returns undefined for subtypes it does not draw", () => {
    expect(generateAppearance(dict("<</Subtype/Stamp/Rect[0 0 1 1]>>"))).toBeUndefined();
    expect(generateAppearance(dict("<</Subtype/Circle>>"))).toBeUndefined();
  });
});
