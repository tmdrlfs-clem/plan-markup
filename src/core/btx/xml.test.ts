import { describe, expect, it } from "vitest";

import { BtxError } from "./errors";
import { decodeXmlText, readXml } from "./xml";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof BtxError) return e.code;
    throw e;
  }
  return undefined;
}

describe("readXml", () => {
  it("reads the .btx structure with BOM, declaration, CRLF and attributes", () => {
    const doc =
      '﻿<?xml version="1.0" encoding="utf-8"?>\r\n<BluebeamRevuToolSet Version="1">\r\n' +
      "  <Title>789c</Title>\r\n  <ToolChestItem Version='1'><Name>A &amp; B</Name><Empty/></ToolChestItem>\r\n" +
      "</BluebeamRevuToolSet>\r\n";
    const root = readXml(doc);
    expect(root.name).toBe("BluebeamRevuToolSet");
    expect(root.attrs.Version).toBe("1");
    expect(root.children.map((c) => c.name)).toEqual(["Title", "ToolChestItem"]);
    const item = root.children[1]!;
    expect(item.attrs.Version).toBe("1");
    expect(item.children[0]).toMatchObject({ name: "Name", text: "A & B" });
    expect(item.children[1]).toMatchObject({ name: "Empty", children: [], text: "" });
  });

  it("skips comments", () => {
    expect(readXml("<!-- c --><a><!-- x --><b/></a><!-- tail -->").children).toHaveLength(1);
  });

  it("decodes the predefined entities and character references only", () => {
    expect(decodeXmlText("&lt;&gt;&amp;&quot;&apos;&#65;&#x42;")).toBe("<>&\"'AB");
    expect(code(() => decodeXmlText("&nbsp;"))).toBe("xml-forbidden");
    expect(code(() => decodeXmlText("&constructor;"))).toBe("xml-forbidden");
    expect(code(() => decodeXmlText("&#0;"))).toBe("xml-malformed");
    expect(code(() => decodeXmlText("&amp"))).toBe("xml-malformed");
  });

  it("rejects DOCTYPE, ENTITY, CDATA and processing instructions", () => {
    expect(code(() => readXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'))).toBe("xml-forbidden");
    expect(code(() => readXml('<a><!ENTITY x "y"></a>'))).toBe("xml-forbidden");
    expect(code(() => readXml("<a><![CDATA[x]]></a>"))).toBe("xml-forbidden");
    expect(code(() => readXml('<?xml-stylesheet href="x"?><a/>'))).toBe("xml-forbidden");
    expect(code(() => readXml("<a><?php x ?></a>"))).toBe("xml-forbidden");
  });

  it("enforces the depth limit", () => {
    const nest = (n: number) => "<a>".repeat(n) + "</a>".repeat(n);
    expect(readXml(nest(16)).name).toBe("a");
    expect(code(() => readXml(nest(17)))).toBe("xml-too-deep");
    expect(code(() => readXml(nest(4), { maxDepth: 3 }))).toBe("xml-too-deep");
  });

  it("rejects malformed documents", () => {
    expect(code(() => readXml("<a><b></a>"))).toBe("xml-malformed");
    expect(code(() => readXml("<a>"))).toBe("xml-malformed");
    expect(code(() => readXml("<a/><b/>"))).toBe("xml-malformed");
    expect(code(() => readXml(""))).toBe("xml-malformed");
    expect(code(() => readXml('<a x="1" x="2"/>'))).toBe("xml-malformed");
  });

  it("does not echo content in error messages", () => {
    try {
      readXml("<secret-client-name><x></secret-client-name>");
    } catch (e) {
      expect((e as Error).message).not.toContain("client");
    }
  });
});
