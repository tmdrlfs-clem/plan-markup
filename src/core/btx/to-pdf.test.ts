import { readFileSync } from "node:fs";

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { parseBtx, type BtxItem } from "./parse";
import { parsePdfObject, type PdfDict, type PdfObject } from "./pdf-object";
import { buildItemPdf, buildPdf, itemBounds, memberOffset, translateAnnotation } from "./to-pdf";

const SYNTHETIC = new URL("../../../fixtures/btx/synthetic.btx", import.meta.url);
const dict = (s: string) => parsePdfObject(Uint8Array.from(s, (c) => c.charCodeAt(0))) as PdfDict;

async function synthetic() {
  return parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
}

async function annotsOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of("Annots"), PDFArray);
  return { doc, page, annots: annots.asArray().map((r) => doc.context.lookup(r) as PDFDict) };
}

describe("translateAnnotation / placement", () => {
  it("moves Rect, L, Vertices and InkList", () => {
    const moved = translateAnnotation(dict("<</Rect[0 0 2 2]/L[1 1 2 2]/Vertices[0 0 1 1]/InkList[[1 2][3 4 5 6]]/W 3>>"), 10, 20);
    const s = JSON.stringify(moved.entries);
    expect(s).toContain('["Rect",[10,20,12,22]]');
    expect(s).toContain('["L",[11,21,12,22]]');
    expect(s).toContain('["Vertices",[10,20,11,21]]');
    expect(s).toContain('["InkList",[[11,22],[13,24,15,26]]]');
    expect(s).toContain('["W",3]');
  });

  it("places each member at -(X, Y): the synthetic ring and dot are concentric", async () => {
    const group = (await synthetic()).items[2]!;
    const [ring, dot] = group.annotations;
    const [rx] = memberOffset(ring!);
    const [dx] = memberOffset(dot!);
    expect([rx, dx]).toEqual([-1.5, 4.5]);
    // Ring 20 pt wide, dot 8 pt wide: centres coincide.
    expect(rx + 10).toBe(dx + 4);
    expect(itemBounds(group)).toEqual([-1.5, -1.5, 18.5, 18.5]);
  });
});

describe("buildItemPdf", () => {
  it("writes the stamp with its AP pointing at the converted form XObject and resolved resources", async () => {
    const stamp = (await synthetic()).items[0]!;
    const built = await buildItemPdf(stamp);
    expect(built.warnings).toEqual([]);
    expect(built.pageBox).toEqual([-4, -4, 44, 24]);
    const { doc, annots } = await annotsOf(built.bytes);
    expect(annots).toHaveLength(1);
    const a = annots[0]!;
    expect(a.get(PDFName.of("Subtype"))).toBe(PDFName.of("Stamp"));
    const n = a.lookup(PDFName.of("AP"), PDFDict).get(PDFName.of("N"));
    expect(n).toBeInstanceOf(PDFRef);
    const form = doc.context.lookup(n) as PDFRawStream;
    expect(form).toBeInstanceOf(PDFRawStream);
    const res = form.dict.lookup(PDFName.of("Resources"), PDFDict);
    const font = res.lookup(PDFName.of("Font"), PDFDict).lookup(PDFName.of("F1"), PDFDict);
    expect(font.get(PDFName.of("BaseFont"))).toBe(PDFName.of("Helvetica"));
    expect(font.lookup(PDFName.of("FontDescriptor"))).toBeInstanceOf(PDFDict);
    expect(res.lookup(PDFName.of("XObject"), PDFDict).lookup(PDFName.of("Fm0"))).toBeInstanceOf(PDFRawStream);
    // No BBObjPtr names survive: every reference became a real PDF reference.
    expect(Buffer.from(built.bytes).toString("latin1")).not.toContain("BBObjPtr_");
  });

  it("generates appearances for every member without /AP", async () => {
    const set = await synthetic();
    for (const item of set.items.slice(1)) {
      const built = await buildItemPdf(item);
      expect(built.warnings).toEqual([]);
      expect(built.annotations.every((a) => a.generated)).toBe(true);
      const { annots } = await annotsOf(built.bytes);
      expect(annots).toHaveLength(item.annotations.length);
      for (const a of annots) expect(a.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"))).toBeInstanceOf(PDFRawStream);
    }
  });

  it("links group members as a Revu-style group on request", async () => {
    const set = await synthetic();
    const built = await buildPdf(set.items.map((item, i) => ({ item, dx: i * 60 })), { linkGroups: true });
    const { annots } = await annotsOf(built.bytes);
    expect(annots).toHaveLength(6);
    const dot = annots[3]!;
    expect(dot.get(PDFName.of("RT"))).toBe(PDFName.of("Group"));
    expect(dot.get(PDFName.of("IRT"))).toBeInstanceOf(PDFRef);
    expect(annots[2]!.get(PDFName.of("IRT"))).toBeUndefined();
  });

  it("draws a missing resource as an empty form and drops a string /OC", async () => {
    const item: BtxItem = {
      name: "x",
      type: "t",
      mode: undefined,
      missingRefs: ["MISSINGAAAAAAAAA"],
      resources: new Map(),
      annotations: [
        {
          type: "t",
          subtype: "Stamp",
          subject: undefined,
          role: "root",
          x: 0,
          y: 0,
          index: 0,
          dict: dict("<</Subtype/Stamp/Rect[0 0 5 5]/OC(layer)/AP<</N/BBObjPtr_MISSINGAAAAAAAAA>>>>"),
        },
      ],
    };
    const built = await buildItemPdf(item);
    expect(built.warnings).toEqual(["Placement 0: 1 missing resource(s) drawn empty"]);
    const { annots } = await annotsOf(built.bytes);
    expect(annots[0]!.get(PDFName.of("OC"))).toBeUndefined();
    expect(annots[0]!.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N"))).toBeInstanceOf(PDFRawStream);
  });

  it("converts a long BBObjPtr chain without recursion", async () => {
    // BBObjPtr ids are 16 capital letters: n in base 26, padded with "A".
    const id = (n: number) => n.toString(26).toUpperCase().replace(/[0-9A-P]/g, (c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[parseInt(c, 26)]!).padStart(16, "A");
    const resources = new Map<string, PdfObject>();
    const length = 20_000;
    for (let n = 0; n < length; n++) {
      resources.set(id(n), { kind: "dict", entries: [["Next", { kind: "ref", ref: id(n + 1) }]] });
    }
    const item: BtxItem = {
      name: "x",
      type: "t",
      mode: undefined,
      missingRefs: [id(length)],
      resources,
      annotations: [
        {
          type: "t",
          subtype: "Circle",
          subject: undefined,
          role: "root",
          x: 0,
          y: 0,
          index: 0,
          dict: dict(`<</Subtype/Circle/Rect[0 0 5 5]/Chain/BBObjPtr_${id(0)}>>`),
        },
      ],
    };
    const built = await buildItemPdf(item);
    expect(built.warnings).toContain("Placement 0: 1 missing resource(s) drawn empty");
    const { annots } = await annotsOf(built.bytes);
    let cur = annots[0]!.lookup(PDFName.of("Chain"), PDFDict);
    for (let n = 1; n < length; n++) cur = cur.lookup(PDFName.of("Next"), PDFDict);
    expect(cur.lookup(PDFName.of("Next"))).toBeInstanceOf(PDFRawStream); // the empty placeholder form
  }, 30_000);
});
