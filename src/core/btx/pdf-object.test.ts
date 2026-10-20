import { describe, expect, it } from "vitest";

import { BtxError } from "./errors";
import {
  collectRefs,
  createPdfNodeBudget,
  dictGet,
  getNumbers,
  getText,
  isDict,
  isStream,
  parsePdfObject,
  pdfStringText,
  type PdfObject,
  type PdfString,
} from "./pdf-object";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const parse = (s: string, maxDepth?: number) => parsePdfObject(enc(s), { maxDepth });

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof BtxError) return e.code;
    throw e;
  }
  return undefined;
}

describe("parsePdfObject", () => {
  it("reads numbers, booleans and null", () => {
    expect(parse("42")).toBe(42);
    expect(parse("-0.0001220703")).toBeCloseTo(-0.0001220703);
    expect(parse(".5")).toBe(0.5);
    expect(parse("+3.")).toBe(3);
    expect(parse("true")).toBe(true);
    expect(parse("false")).toBe(false);
    expect(parse("null")).toBe(null);
  });

  it("reads names with #xx escapes and BBObjPtr references", () => {
    expect(parse("/Stamp")).toEqual({ kind: "name", value: "Stamp" });
    expect(parse("/A#20B#2f")).toEqual({ kind: "name", value: "A B/" });
    expect(parse("/BBObjPtr_TKBMAYOQQAHPBTNE")).toEqual({ kind: "ref", ref: "TKBMAYOQQAHPBTNE" });
    // Not 16 uppercase letters: an ordinary name.
    expect(parse("/BBObjPtr_abc")).toEqual({ kind: "name", value: "BBObjPtr_abc" });
  });

  it("reads literal strings with escapes, octal and balanced parens", () => {
    const s = parse("(a\\(b\\) (nested) \\n\\t\\\\ \\260 \\101\\0 x\\\r\ny)") as PdfString;
    expect(pdfStringText(s)).toBe("a(b) (nested) \n\t\\ ° A\u0000 xy");
    expect(s.hex).toBe(false);
  });

  it("reads hex strings incl. UTF-16BE with BOM", () => {
    const s = parse("<feff c2a4 b0c5>") as PdfString;
    expect(s.hex).toBe(true);
    expect(pdfStringText(s)).toBe("스냅");
    expect([...(parse("<41 4>") as PdfString).bytes]).toEqual([0x41, 0x40]);
  });

  it("reads arrays and dictionaries in file order (duplicate keys: last wins)", () => {
    const d = parse("<</Rect[0 0 23.08 22.75]/BS<</W 3/S/D/D[2 2]>>/C[]/K 1/K 2>>");
    expect(isDict(d)).toBe(true);
    if (!isDict(d)) return;
    expect(d.entries.map(([k]) => k)).toEqual(["Rect", "BS", "C", "K"]);
    expect(getNumbers(d, "Rect")).toEqual([0, 0, 23.08, 22.75]);
    expect(dictGet(d, "K")).toBe(2);
    expect(dictGet(d, "C")).toEqual([]);
  });

  it("reads a stream by /Length and skips padding before endstream", () => {
    const o = parse("<</Length 5/Subtype/Form>>\r\nstream\r\nab\ncd\n\n\n\n\nendstream");
    expect(isStream(o)).toBe(true);
    if (!isStream(o)) return;
    expect(String.fromCharCode(...o.data)).toBe("ab\ncd");
  });

  it("falls back to the endstream marker when /Length is wrong", () => {
    const o = parse("<</Length 999>>\nstream\nabc\nendstream\n");
    if (!isStream(o)) throw new Error("expected a stream");
    expect(String.fromCharCode(...o.data)).toBe("abc");
  });

  it("collects refs without following them", () => {
    const o = parse("<</AP<</N/BBObjPtr_AAAAAAAAAAAAAAAA>>/X[/BBObjPtr_BBBBBBBBBBBBBBBB]>>");
    expect([...collectRefs(o)].sort()).toEqual(["AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBB"]);
  });

  it("decodes /Subj text from either string kind", () => {
    const d = parse("<</A(Ellipse)/B<feff0041>>>") as PdfObject;
    if (!isDict(d)) throw new Error("expected a dict");
    expect(getText(d, "A")).toBe("Ellipse");
    expect(getText(d, "B")).toBe("A");
  });

  it("enforces the nesting limit (arrays and dictionaries)", () => {
    expect(Array.isArray(parse("[".repeat(64) + "]".repeat(64)))).toBe(true);
    expect(code(() => parse("[".repeat(65) + "]".repeat(65)))).toBe("pdf-too-deep");
    expect(code(() => parse("<</A".repeat(65) + " 1" + ">>".repeat(65)))).toBe("pdf-too-deep");
    expect(code(() => parse("[[[1]]]", 2))).toBe("pdf-too-deep");
  });

  it("rejects malformed input", () => {
    expect(code(() => parse("<</A 1"))).toBe("pdf-malformed");
    expect(code(() => parse("(abc"))).toBe("pdf-malformed");
    expect(code(() => parse("<zz>"))).toBe("pdf-malformed");
    expect(code(() => parse("<<1 2>>"))).toBe("pdf-malformed");
    expect(code(() => parse("1 0 R"))).toBe("pdf-malformed");
    expect(code(() => parse(`[1 ${"9".repeat(400)}]`))).toBe("pdf-malformed"); // not a finite double
    expect(code(() => parse("<</Length 3>>\nstream\nabc"))).toBe("pdf-malformed");
  });
});

describe("parsePdfObject resource limits", () => {
  it("charges every value to the shared node budget", () => {
    const budget = createPdfNodeBudget(10);
    parsePdfObject(enc("<</A [1 2] /B (x)>>"), { nodeBudget: budget }); // dict, array, 1, 2, string
    expect(budget.remaining).toBe(5);
    expect(code(() => parsePdfObject(enc("[1 2 3 4 5]"), { nodeBudget: budget }))).toBe("pdf-too-many-nodes");
  });

  it("reads long strings into byte buffers", () => {
    const long = parse(`(${"a\\\\".repeat(10_000)})`) as PdfString;
    expect(long.bytes.length).toBe(20_000);
    expect(long.bytes[1]).toBe(0x5c);
    const hex = parse(`<${"0aF".repeat(3)}>`) as PdfString;
    expect([...hex.bytes]).toEqual([0x0a, 0xf0, 0xaf, 0x0a, 0xf0]);
  });
});
