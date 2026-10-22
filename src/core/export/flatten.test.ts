import { readFileSync } from "node:fs";

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { writeAnnotations } from "./annotations";
import { exportPdf } from "./export";
import { appearanceMatrix, flattenDocument, flattenPage, multiply, transformBox } from "./flatten";
import type { ExportDocument } from "./model";
import { SAMPLE_DATE, sampleDocument } from "./sample-set";

const SAMPLE = new URL("../../../fixtures/pdf/export-sample.pdf", import.meta.url);

function pageContent(doc: PDFDocument): string {
  const contents = doc.getPage(0).node.Contents();
  const parts: string[] = [];
  const arr = contents instanceof PDFArray ? contents : undefined;
  const streams = arr ? Array.from({ length: arr.size() }, (_, i) => arr.lookup(i)) : [contents];
  for (const s of streams) parts.push(new TextDecoder().decode(decodePDFRawStream(s as PDFRawStream).decode()));
  return parts.join("\n");
}

describe("appearance matrix (ISO 32000-1 12.5.5)", () => {
  it("is a translation when BBox = Rect and the form matrix is identity", () => {
    expect(appearanceMatrix([10, 20, 30, 40], [10, 20, 30, 40], [1, 0, 0, 1, 0, 0])).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("maps a form-space box onto the rect (scale + translate)", () => {
    expect(appearanceMatrix([100, 100, 120, 110], [0, 0, 10, 5], [1, 0, 0, 1, 0, 0])).toEqual([2, 0, 0, 2, 100, 100]);
  });

  it("uses the transformed bounding box of a rotated form", () => {
    const rot: [number, number, number, number, number, number] = [0, 1, -1, 0, 0, 0]; // 90°
    expect(transformBox([0, 0, 10, 5], rot)).toEqual([-5, 0, 0, 10]);
    const a = appearanceMatrix([0, 0, 5, 10], [0, 0, 10, 5], rot)!;
    // The form corner (10, 5) lands on the rect corner (0, 10).
    const m = multiply(rot, a);
    expect([10 * m[0] + 5 * m[2] + m[4], 10 * m[1] + 5 * m[3] + m[5]]).toEqual([0, 10]);
  });

  it("is undefined for a degenerate box", () => {
    expect(appearanceMatrix([0, 0, 5, 5], [0, 0, 0, 5], [1, 0, 0, 1, 0, 0])).toBeUndefined();
  });
});

describe("flattenPage", () => {
  it("draws every annotation into the content, keeps the link without /AP", async () => {
    const r = await exportPdf(readFileSync(SAMPLE), sampleDocument(), { kind: "flattened", date: SAMPLE_DATE });
    const doc = await PDFDocument.load(r.bytes);
    expect(r.flatten).toEqual({ flattened: r.annotations, dropped: 0, kept: 1 });
    const annots = doc.getPage(0).node.Annots()!;
    expect(annots.size()).toBe(1);
    const link = annots.lookup(0, PDFDict);
    expect(link.lookup(PDFName.of("Subtype"))).toBe(PDFName.of("Link"));
    expect(link.get(PDFName.of("AP"))).toBeUndefined();
    const content = pageContent(doc);
    expect(content.match(/ Do\n/g)?.length).toBe(r.annotations);
    // Layered markups stay on their layer.
    expect(content).toMatch(/\/OC \/OCFlat0 BDC/);
    const props = doc.getPage(0).node.Resources()!.lookup(PDFName.of("Properties"), PDFDict);
    expect(props.get(PDFName.of("OCFlat0"))).toBeInstanceOf(PDFRef);
  });

  it("drops annotations on a hidden layer and hidden annotations without drawing them", async () => {
    const model: ExportDocument = sampleDocument();
    model.layers = model.layers.map((l) => (l.id === "fire" ? { ...l, visible: false } : l));
    const doc = await PDFDocument.load(readFileSync(SAMPLE));
    const written = writeAnnotations(doc, model, { mode: "native", date: SAMPLE_DATE });
    // Hide one more annotation with the Hidden flag.
    const hiddenRef = written.refs[0]!;
    doc.context.lookup(hiddenRef, PDFDict).set(PDFName.of("F"), doc.context.obj(2));
    const onFire = written.specs.filter((s) => s.layer === "fire").length;
    const r = flattenPage(doc, 0);
    expect(r.dropped).toBe(onFire + 1);
    expect(r.flattened).toBe(written.specs.length - onFire - 1);
    expect(r.kept).toBe(1); // the link
  });

  it("is a no-op on a page without annotations", async () => {
    const doc = await PDFDocument.load(readFileSync(SAMPLE));
    expect(flattenDocument(doc)).toEqual({ flattened: 0, dropped: 0, kept: 0 });
  });
});
