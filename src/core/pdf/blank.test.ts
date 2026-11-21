import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { blankName, blankPageCount, blankPageSize, blankPdf } from "./blank";

describe("new blank drawing", () => {
  it("ISO sizes in points, turned for landscape", () => {
    expect(blankPageSize("A4", "portrait")).toEqual([595.28, 841.89]);
    expect(blankPageSize("A3", "landscape")).toEqual([1190.55, 841.89]);
    expect(blankPageSize("A1", "portrait")).toEqual([1683.78, 2383.94]);
  });

  it("makes the asked number of empty pages (1 to 200)", async () => {
    const doc = await PDFDocument.load(await blankPdf({ size: "A3", orientation: "landscape", pages: 3 }));
    expect(doc.getPageCount()).toBe(3);
    const { width, height } = doc.getPage(2).getSize();
    expect([width, height]).toEqual([1190.55, 841.89]);
    expect(blankPageCount(0)).toBe(1);
    expect(blankPageCount(999)).toBe(200);
    expect(blankPageCount(Number.NaN)).toBe(1);
  });

  it("each one is a new drawing (different bytes) with a readable name", async () => {
    const spec = { size: "A4", orientation: "portrait", pages: 1 } as const;
    const a = await blankPdf(spec, new Date(2026, 10, 21, 14, 5));
    const b = await blankPdf(spec, new Date(2026, 10, 21, 14, 6));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(blankName(spec, new Date(2026, 10, 21, 14, 5))).toBe("Untitled A4 portrait 2026-11-21 1405.pdf");
  });
});
