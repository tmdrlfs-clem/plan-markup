// Story 9.12: the advisory notice drawn onto exported pages.
import { readFileSync } from "node:fs";

import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { exportJobPdf } from "./export";
import { ADVISORY_NOTICE, addNotice, noticeSize, viewedFrame } from "./notice";
import { SAMPLE_DATE, sampleDocument } from "./sample-set";

const SAMPLE = new URL("../../../fixtures/pdf/export-sample.pdf", import.meta.url);
const HEX = Buffer.from(ADVISORY_NOTICE, "latin1").toString("hex").toLowerCase();

function content(doc: PDFDocument, i: number): string {
  const contents = doc.getPage(i).node.Contents();
  const arr = contents instanceof PDFArray ? contents : undefined;
  const streams = arr ? Array.from({ length: arr.size() }, (_, k) => arr.lookup(k)) : contents ? [contents] : [];
  return streams.map((s) => new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode())).join("\n").toLowerCase();
}

describe("advisory notice (Story 9.12)", () => {
  it("finds the viewed page's bottom-left corner and reading direction for each rotation", () => {
    const box = { x: 0, y: 0, width: 600, height: 400 };
    expect(viewedFrame(0, box)).toMatchObject({ origin: { x: 0, y: 0 }, u: { x: 1, y: 0 }, rotate: 0, width: 600 });
    // Turned 90° clockwise: the viewed bottom left is the page's bottom right, text runs up the page.
    expect(viewedFrame(90, box)).toMatchObject({ origin: { x: 600, y: 0 }, u: { x: 0, y: 1 }, v: { x: -1, y: 0 }, rotate: 90, width: 400, height: 600 });
    expect(viewedFrame(180, box)).toMatchObject({ origin: { x: 600, y: 400 }, rotate: 180 });
    expect(viewedFrame(-90, box)).toMatchObject({ origin: { x: 0, y: 400 }, u: { x: 0, y: -1 }, rotate: 270 });
  });

  it("sizes the text to the sheet and always fits it on one line", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(noticeSize(font, 2384, 1684)).toBe(12); // A0: capped
    const a4 = noticeSize(font, 842, 595);
    expect(a4).toBeCloseTo(7, 6);
    const narrow = noticeSize(font, 300, 595);
    expect(narrow).toBeLessThan(7);
    expect(font.widthOfTextAtSize(ADVISORY_NOTICE, narrow)).toBeLessThanOrEqual(300 - 30 + 1e-6);
    expect(noticeSize(font, 100, 100)).toBe(5); // never smaller than 5 pt
  });

  it("draws the line on each chosen page, upright as the page is viewed", async () => {
    let doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    doc.addPage([842, 595]).setRotation(degrees(90));
    doc.addPage([842, 595]);
    expect(await addNotice(doc, [0, 1, 1, 7])).toBe(2);
    doc = await PDFDocument.load(await doc.save());
    expect(content(doc, 0)).toContain(HEX);
    expect(doc.getPage(2).node.Contents()).toBeUndefined();
    // On the turned page the text matrix turns 90° (cos ≈ 0, sin 1); the baseline is 12 + 3 pt in from
    // the right edge (less the descent) and 15 pt up: the viewed bottom left.
    const turned = content(doc, 1);
    expect(turned).toContain(HEX);
    expect(turned).toMatch(/[0-9.e-]+ 1 -1 [0-9.e-]+ 825\.\d+ 15 tm/);
  });

  it("an export with the notice draws it on every exported page; without it, none", async () => {
    const model = sampleDocument();
    const job = { layers: model.layers, pages: [{ pageIndex: 0, model, flatten: [] }] };
    const withNotice = await PDFDocument.load((await exportJobPdf(readFileSync(SAMPLE), job, SAMPLE_DATE, { flatten: true, notice: true })).bytes);
    expect(content(withNotice, 0)).toContain(HEX);
    const without = await PDFDocument.load((await exportJobPdf(readFileSync(SAMPLE), job, SAMPLE_DATE, { flatten: true })).bytes);
    expect(content(without, 0)).not.toContain(HEX);
  });
});
