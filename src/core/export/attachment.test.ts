import { readFileSync } from "node:fs";

import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, PDFHexString, decodePDFRawStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { exportPdf } from "./export";
import { SAMPLE_DATE, sampleDocument } from "./sample-set";

const SAMPLE = new URL("../../../fixtures/pdf/export-sample.pdf", import.meta.url);

describe("file attachment in the PDF (founder 2026-11-21)", () => {
  it("is a FileAttachment annotation with the file embedded", async () => {
    const r = await exportPdf(readFileSync(SAMPLE), sampleDocument(), { kind: "native", date: SAMPLE_DATE });
    const doc = await PDFDocument.load(r.bytes);
    const annots = doc.getPage(0).node.Annots()!.asArray().map((ref) => doc.context.lookup(ref, PDFDict));
    const a = annots.find((d) => d.get(PDFName.of("Subtype")) === PDFName.of("FileAttachment"))!;
    expect(a).toBeDefined();
    const fs = a.lookup(PDFName.of("FS"), PDFDict);
    const f = fs.lookup(PDFName.of("UF")) as PDFString | PDFHexString;
    expect(f.decodeText()).toBe("spec.txt");
    const stream = fs.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F")) as PDFRawStream;
    expect(new TextDecoder().decode(decodePDFRawStream(stream).decode())).toBe("Sprinkler spec\n");
  });
});
