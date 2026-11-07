import { PDFDocument, degrees } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { PAPERS, placement, printPdf, rotatedOrigin } from "./print";

describe("print PDF (Story 8.3)", () => {
  it("keeps the drawing's own size for paper 'same'", () => {
    expect(placement(2384, 1684, "same", "fit")).toEqual({ sheet: [2384, 1684], scale: 1, x: 0, y: 0, clipped: false });
  });

  it("turns the paper to the page's orientation and fits it, centred", () => {
    const at = placement(2383.94, 1683.78, "A3", "fit"); // A1 landscape on A3
    expect(at.sheet).toEqual([PAPERS.A3[1], PAPERS.A3[0]]);
    expect(at.scale).toBeCloseTo(0.5, 2);
    expect(at.x).toBeCloseTo(0, 1);
    expect(at.clipped).toBe(false);
    const portrait = placement(595, 842, "Letter", "fit");
    expect(portrait.sheet).toEqual([612, 792]);
    expect(portrait.x).toBeGreaterThan(0);
  });

  it("actual size stays 1:1 and says when the page is larger than the paper", () => {
    const big = placement(2383.94, 1683.78, "A3", "actual");
    expect(big).toMatchObject({ scale: 1, clipped: true });
    expect(big.x).toBeLessThan(0);
    expect(placement(500, 400, "A3", "actual")).toMatchObject({ scale: 1, clipped: false });
  });

  it("places a rotated page so its turned box lands on the visual box", () => {
    expect(rotatedOrigin(0, 5, 6, 100, 50, 2)).toEqual({ x: 5, y: 6, rotate: 0 });
    expect(rotatedOrigin(90, 5, 6, 100, 50, 2)).toEqual({ x: 5, y: 206, rotate: -90 });
    expect(rotatedOrigin(180, 5, 6, 100, 50, 2)).toEqual({ x: 205, y: 106, rotate: 180 });
    expect(rotatedOrigin(-90, 5, 6, 100, 50, 2)).toEqual({ x: 105, y: 6, rotate: 90 });
  });

  it("writes one sheet per chosen page, skipping pages out of range", async () => {
    const src = await PDFDocument.create();
    src.addPage([842, 595]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    const turned = src.addPage([595, 842]);
    turned.setRotation(degrees(90));
    turned.drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    const out = await printPdf(await src.save(), { pages: [1, 0, 7], paper: "A4", scale: "fit" });
    expect(out).toMatchObject({ sheets: 2, clipped: 0 });
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(2);
    // Page 2 is portrait but turned 90°: it prints landscape.
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    expect(w).toBeCloseTo(PAPERS.A4[1], 1);
    expect(h).toBeCloseTo(PAPERS.A4[0], 1);
    const same = await printPdf(await src.save(), { pages: [0], paper: "same", scale: "fit" });
    const p = (await PDFDocument.load(same.bytes)).getPage(0);
    expect([p.getWidth(), p.getHeight()]).toEqual([842, 595]);
    const blank = await PDFDocument.create();
    blank.addPage([300, 200]);
    expect(await printPdf(await blank.save(), { pages: [0], paper: "A4", scale: "fit" })).toMatchObject({ sheets: 1 });
  });
});
