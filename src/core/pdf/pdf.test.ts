import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { fmt, lineEnding, literalText, normalizeRect } from "./content";
import { FormWriter } from "./form";
import { helveticaWidth } from "./helvetica";
import { name, ref, text, toPdfDict, toPdfObject } from "./value";

describe("content helpers", () => {
  it("formats numbers compactly", () => {
    expect(fmt(1.23456789)).toBe("1.2346");
    expect(fmt(-0.00001)).toBe("0");
    expect(fmt(Number.NaN)).toBe("0");
    expect(fmt(12)).toBe("12");
  });

  it("normalizes rectangles and escapes literal text", () => {
    expect(normalizeRect([10, 20, 0, 5])).toEqual([0, 5, 10, 20]);
    expect(literalText("a(b)\\c é")).toBe("a\\(b\\)\\\\c \\351");
  });

  it("reports the points a line ending touches", () => {
    const e = lineEnding("ClosedArrow", [10, 0], [0, 0], 1)!;
    expect(e.closed).toBe(true);
    expect(e.points).toContainEqual([10, 0]);
    expect(lineEnding("None", [10, 0], [0, 0], 1)).toBeUndefined();
  });
});

describe("Helvetica metrics", () => {
  it("matches pdf-lib's standard-font widths for ASCII and the label signs", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let ascii = "";
    for (let c = 32; c <= 126; c++) ascii += String.fromCharCode(c);
    for (const s of [ascii, "12.35 m²", "45.0°", "OFFICE 1"]) {
      expect(helveticaWidth(s, 10)).toBeCloseTo(font.widthOfTextAtSize(s, 10), 6);
    }
  });
});

describe("plain PDF values", () => {
  it("converts names, text, numbers, arrays, dictionaries and references", async () => {
    const doc = await PDFDocument.create();
    const target = doc.context.register(doc.context.obj({}));
    const d = toPdfDict(
      doc.context,
      { A: name("X"), B: text("ascii (1)"), C: text("m²"), D: [1, true, null], E: { F: 2 }, G: ref("t"), H: undefined },
      (id) => (id === "t" ? target : (undefined as never)),
    );
    expect(d.get(PDFName.of("A"))).toBe(PDFName.of("X"));
    const b = d.get(PDFName.of("B"));
    expect(b).toBeInstanceOf(PDFString);
    expect((b as PDFString).decodeText()).toBe("ascii (1)");
    const c = d.get(PDFName.of("C"));
    expect(c).toBeInstanceOf(PDFHexString);
    expect((c as PDFHexString).decodeText()).toBe("m²");
    expect(d.get(PDFName.of("G"))).toBe(target);
    expect(d.has(PDFName.of("H"))).toBe(false);
    expect(() => toPdfObject(doc.context, ref("missing"))).toThrow(/Unresolved/);
    expect(() => toPdfObject(doc.context, Number.POSITIVE_INFINITY)).toThrow(/Non-finite/);
  });
});

describe("FormWriter", () => {
  it("registers a form with shared font and image resources", async () => {
    const doc = await PDFDocument.create();
    const w = new FormWriter(doc.context);
    const img = { width: 1, height: 1, rgb: new Uint8Array([255, 0, 0]) };
    const form = { bbox: [0, 0, 10, 10] as [number, number, number, number], content: "/Helv 5 Tf\n", fonts: { Helv: "Helvetica" }, extGStates: { GS0: { ca: 0.5, BM: "Multiply" } }, images: { Im0: img } };
    const r1 = w.form(form);
    const r2 = w.form(form);
    expect(r1).not.toBe(r2);
    const res1 = w.resources(form);
    const res2 = w.resources(form);
    // The same font and image objects are shared between forms.
    expect(res1.toString()).toBe(res2.toString());
    const stream = doc.context.lookup(r1);
    expect(stream?.toString()).toContain("/Subtype /Form");
    expect(() => w.form({ ...form, images: { Im0: { width: 2, height: 2, rgb: new Uint8Array(3) } } })).toThrow(/size/);
  });
});
