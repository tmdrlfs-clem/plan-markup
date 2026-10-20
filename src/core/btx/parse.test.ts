import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { BtxError } from "./errors";
import { fromPlainToolSet, parseBtx, resolveRefs, toPlainToolSet } from "./parse";
import { dictGet, getNumbers, isStream, parsePdfObject, type PdfDict, type PdfObject } from "./pdf-object";

const SYNTHETIC = new URL("../../../fixtures/btx/synthetic.btx", import.meta.url);
const hexZ = (s: string | Uint8Array) => Buffer.from(deflateSync(typeof s === "string" ? Buffer.from(s, "latin1") : s)).toString("hex");
const enc = (s: string) => new TextEncoder().encode(s);

function btx(itemsXml: string, title = hexZ("T")): Uint8Array {
  return enc(`<?xml version="1.0" encoding="utf-8"?><BluebeamRevuToolSet Version="1"><Title>${title}</Title>${itemsXml}</BluebeamRevuToolSet>`);
}
const item = (raw: string, extra = "") =>
  `<ToolChestItem Version="1">${extra}<Name>N</Name><Type>T</Type><Raw>${hexZ(raw)}</Raw><X>0</X><Y>0</Y><Index>0</Index><Mode>drawing</Mode></ToolChestItem>`;
const resource = (id: string, data: string) => `<Resources><ID>${hexZ(id)}</ID><Data>${hexZ(data)}</Data></Resources>`;

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BtxError) return e.code;
    throw e;
  }
  return undefined;
}

describe("parseBtx on fixtures/btx/synthetic.btx", () => {
  it("decodes all five items end to end", async () => {
    const set = await parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
    expect(set.title).toBe("Synthetic Tools");
    expect(set.warnings).toEqual([]);
    expect(set.items.map((i) => i.name)).toEqual([
      "Synthetic head",
      "Synthetic sounder",
      "Synthetic group",
      "Synthetic pipe",
      "Synthetic arrow",
    ]);
    expect(set.items.map((i) => i.annotations.map((a) => a.subtype))).toEqual([
      ["Stamp"],
      ["Circle"],
      ["Circle", "Circle"],
      ["PolyLine"],
      ["Line"],
    ]);
    for (const it of set.items) {
      expect(it.mode).toBe("drawing");
      expect(it.missingRefs).toEqual([]);
    }
  });

  it("resolves the stamp's AP → form XObject → nested form + TrueType font + descriptor", async () => {
    const { items } = await parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
    const stamp = items[0]!;
    const ap = dictGet(stamp.annotations[0]!.dict, "AP") as PdfDict;
    expect(dictGet(ap, "N")).toEqual({ kind: "ref", ref: "SYNTHSTAMPFORMAA" });
    const form = stamp.resources.get("SYNTHSTAMPFORMAA");
    expect(isStream(form)).toBe(true);
    if (!isStream(form)) return;
    expect(getNumbers(form, "BBox")).toEqual([100, 200, 140, 220]);
    expect(form.data.length).toBe(dictGet(form, "Length"));
    const font = stamp.resources.get("SYNTHFONTHELVAAA") as PdfDict;
    expect(dictGet(font, "Subtype")).toEqual({ kind: "name", value: "TrueType" });
    expect(dictGet(font, "BaseFont")).toEqual({ kind: "name", value: "Helvetica" });
    expect(stamp.resources.has("SYNTHNESTEDFORMA")).toBe(true);
    expect(stamp.resources.has("SYNTHFONTDESCAAA")).toBe(true);
  });

  it("keeps group members with X/Y/Index and Revu-private keys", async () => {
    const { items } = await parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
    const group = items[2]!;
    expect(group.annotations.map((a) => [a.role, a.x, a.y, a.index, a.subject])).toEqual([
      ["root", 1.5, 1.5, 2, "Synthetic ring"],
      ["child", -4.5, -4.5, 3, "Synthetic dot"],
    ]);
    expect(dictGet(group.annotations[0]!.dict, "TempRT")).toEqual({ kind: "name", value: "Group" });
    // UTF-16BE subject.
    expect(items[1]!.annotations[0]!.subject).toBe("Synthetic sounder");
  });

  it("round-trips through the structured-clone friendly form", async () => {
    const set = await parseBtx(new Uint8Array(readFileSync(SYNTHETIC)));
    const plain = toPlainToolSet(set);
    const cloned = structuredClone(plain);
    expect(fromPlainToolSet(cloned)).toEqual(set);
  });
});

describe("parseBtx structure and limits", () => {
  it("reports missing references per item instead of throwing", async () => {
    const set = await parseBtx(btx(item("<</Subtype/Stamp/Rect[0 0 1 1]/AP<</N/BBObjPtr_MISSINGAAAAAAAAA>>>>")));
    expect(set.items[0]!.missingRefs).toEqual(["MISSINGAAAAAAAAA"]);
  });

  it("resolves a reference cycle without blowing the stack", async () => {
    const a = "<</Type/XObject/X/BBObjPtr_BBBBBBBBBBBBBBBB>>";
    const b = "<</Type/XObject/X/BBObjPtr_AAAAAAAAAAAAAAAA>>";
    const set = await parseBtx(
      btx(
        item(
          "<</Subtype/Stamp/Rect[0 0 1 1]/AP<</N/BBObjPtr_AAAAAAAAAAAAAAAA>>>>",
          resource("AAAAAAAAAAAAAAAA", a) + resource("BBBBBBBBBBBBBBBB", b),
        ),
      ),
    );
    expect(set.items[0]!.missingRefs).toEqual([]);
    // A long chain is walked iteratively too.
    const resources = new Map<string, PdfObject>();
    const id = (n: number) => `ID${String(n).padStart(14, "0")}`;
    for (let n = 0; n < 50_000; n++) resources.set(id(n), { kind: "ref", ref: id(n + 1) });
    expect(resolveRefs([{ dict: { kind: "dict", entries: [["N", { kind: "ref", ref: id(0) }]] } }], resources)).toEqual([
      id(50_000),
    ]);
  });

  it("keeps unknown elements as warnings", async () => {
    const set = await parseBtx(btx(item("<</Subtype/Circle/Rect[0 0 1 1]>>", "<Sequence><Enabled>1</Enabled></Sequence>")));
    expect(set.warnings).toEqual(["Item 0: unknown element <Sequence> ignored"]);
  });

  it("rejects a file over the size limit", async () => {
    expect(await code(parseBtx(new Uint8Array(101), { limits: { maxFileBytes: 100 } }))).toBe("file-too-large");
  });

  it("rejects a hex value over the hex limit", async () => {
    expect(await code(parseBtx(btx(item("<</Subtype/Circle>>")), { limits: { maxHexChars: 8 } }))).toBe("hex-too-large");
  });

  it("rejects an inflated value over the per-value limit", async () => {
    const big = `<</Subtype/Circle/Pad(${"x".repeat(5000)})>>`;
    expect(await code(parseBtx(btx(item(big)), { limits: { maxInflatedValueBytes: 1000 } }))).toBe("inflate-value-too-large");
  });

  it("rejects a file whose inflated total exceeds the per-file limit", async () => {
    const raw = `<</Subtype/Circle/Pad(${"x".repeat(600)})>>`;
    expect(await code(parseBtx(btx(item(raw) + item(raw)), { limits: { maxInflatedTotalBytes: 1000 } }))).toBe(
      "inflate-total-too-large",
    );
  });

  it("rejects DOCTYPE / ENTITY / processing instructions", async () => {
    const doctype = enc('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "e">]><BluebeamRevuToolSet/>');
    expect(await code(parseBtx(doctype))).toBe("xml-forbidden");
    const pi = enc('<?xml version="1.0"?><?evil x?><BluebeamRevuToolSet/>');
    expect(await code(parseBtx(pi))).toBe("xml-forbidden");
  });

  it("rejects XML nested deeper than the limit", async () => {
    const deep = enc(`<BluebeamRevuToolSet>${"<a>".repeat(16)}${"</a>".repeat(16)}</BluebeamRevuToolSet>`);
    expect(await code(parseBtx(deep))).toBe("xml-too-deep");
  });

  it("rejects PDF objects nested deeper than the limit", async () => {
    const raw = `<</Subtype/Circle/X${"[".repeat(70)}${"]".repeat(70)}>>`;
    expect(await code(parseBtx(btx(item(raw))))).toBe("pdf-too-deep");
  });

  it("rejects a non-tool-set root and a Raw that is not a dictionary", async () => {
    expect(await code(parseBtx(enc("<Other/>")))).toBe("structure-invalid");
    expect(await code(parseBtx(btx(item("[1 2]"))))).toBe("structure-invalid");
  });

  it("never puts file content in error messages", async () => {
    try {
      await parseBtx(btx(item("<</Subtype/Circle/Secret(client-name) 1 0 R>>")));
      throw new Error("expected a failure");
    } catch (e) {
      expect(e).toBeInstanceOf(BtxError);
      expect((e as Error).message).not.toContain("client-name");
    }
  });
});

describe("parsePdfObject on a Revu-style stream resource", () => {
  it("handles /Length + newline padding", () => {
    const data = `<</Length 3/Type/XObject>>\nstream\nabc${"\n".repeat(30)}endstream`;
    const o = parsePdfObject(Uint8Array.from(data, (c) => c.charCodeAt(0)));
    expect(isStream(o) && String.fromCharCode(...o.data)).toBe("abc");
  });
});
