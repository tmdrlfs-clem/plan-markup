import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { blankPagesPdf } from "./blank-pages";

describe("blank pages (Story 6.6)", () => {
  it("keeps each page's crop box and rotation", async () => {
    const bytes = await blankPagesPdf([
      { rotation: 0, cropBox: [0, 0, 1190.55, 841.89], width: 1190.55, height: 841.89 },
      { rotation: 90, cropBox: [10, 20, 610, 820], width: 800, height: 600 },
    ]);
    const doc = await PDFDocument.load(bytes);
    const [a, b] = doc.getPages();
    expect(doc.getPageCount()).toBe(2);
    expect(a.getMediaBox()).toEqual({ x: 0, y: 0, width: 1190.55, height: 841.89 });
    expect(a.getRotation().angle).toBe(0);
    expect(b.getMediaBox()).toEqual({ x: 10, y: 20, width: 600, height: 800 });
    expect(b.getRotation().angle).toBe(90);
  });
});
