import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { AnnotationMode, getDocument, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import { OP_CULL_MARGIN, operationsFilterFor, tileFraction, type OperationBoxes } from "./op-culling";

/** Boxes from plain arrays (fractions); null = empty. */
function boxes(list: ([number, number, number, number] | null)[]): OperationBoxes {
  return {
    length: list.length,
    isEmpty: (i) => list[i] === null,
    minX: (i) => list[i]![0],
    minY: (i) => list[i]![1],
    maxX: (i) => list[i]![2],
    maxY: (i) => list[i]![3],
  };
}

describe("operationsFilterFor", () => {
  const ops = boxes([
    [0, 0, 1, 1], // the whole page (a save, a border)
    [0.1, 0.1, 0.2, 0.2], // top-left
    [0.8, 0.8, 0.9, 0.9], // bottom-right
    null, // draws nothing
    [0.5 + OP_CULL_MARGIN / 2, 0.1, 0.6, 0.2], // just right of the tile, within the margin
  ]);

  it("keeps the operators whose box meets the tile (widened by the margin), drops the rest and empty ones", () => {
    const keep = operationsFilterFor(ops, { minX: 0, minY: 0, maxX: 0.5, maxY: 0.5 });
    expect([0, 1, 2, 3, 4].map(keep)).toEqual([true, true, false, false, true]);
  });

  it("keeps operators past the recording (a longer operator list)", () => {
    expect(operationsFilterFor(ops, { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 })(5)).toBe(true);
  });

  it("turns a tile's device rectangle into a share of the page", () => {
    expect(tileFraction({ x: 512, y: 0, width: 256, height: 512 }, 1024, 2048)).toEqual({ minX: 0.5, minY: 0, maxX: 0.75, maxY: 0.25 });
  });
});

// The shipped filter on pdf.js itself (legacy build in Node, @napi-rs/canvas):
// tiles drawn with culling match tiles drawn with every operator, on committed
// fixtures including a page with /Rotate 90. (On the private L17/L21 drawings
// 72 tiles at 1, 2 and 4 px/pt matched within an anti-aliasing channel delta of 4.)
const FIXTURES = path.join(__dirname, "..", "..", "..", "fixtures", "pdf");

type Recorded = PDFPageProxy & { recordedBBoxes?: OperationBoxes | null };

async function draw(page: PDFPageProxy, scale: number, rect: { x: number; y: number; width: number; height: number }, extra: object = {}) {
  const canvas = createCanvas(rect.width, rect.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rect.width, rect.height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -rect.x, -rect.y],
    annotationMode: AnnotationMode.ENABLE,
    background: "#ffffff",
    ...extra,
  }).promise;
  return ctx.getImageData(0, 0, rect.width, rect.height).data;
}

describe("culled tiles on pdf.js", () => {
  it.each([
    ["search.pdf", 1],
    ["vector-a3.pdf", 1],
    ["multi-page.pdf", 3],
  ])("%s page %i: every culled tile matches the full render", async (file, pageNo) => {
    const task = getDocument({ data: new Uint8Array(readFileSync(path.join(FIXTURES, file))), verbosity: 0 });
    try {
      const doc = await task.promise;
      const page = (await doc.getPage(pageNo)) as Recorded;
      const vp = page.getViewport({ scale: 1 });
      // The recording pass: the whole page on a small canvas.
      const rs = 512 / Math.max(vp.width, vp.height);
      await draw(page, rs, { x: 0, y: 0, width: Math.ceil(vp.width * rs), height: Math.ceil(vp.height * rs) }, { recordOperations: true });
      const recorded = page.recordedBBoxes!;
      expect(recorded.length).toBeGreaterThan(0);

      const scale = 2;
      const W = Math.ceil(vp.width * scale);
      const H = Math.ceil(vp.height * scale);
      const size = 256;
      let culledSomewhere = false;
      for (let y = 0; y < H; y += size * 2) {
        for (let x = 0; x < W; x += size * 2) {
          const rect = { x, y, width: Math.min(size, W - x), height: Math.min(size, H - y) };
          let kept = 0;
          const filter = operationsFilterFor(recorded, tileFraction(rect, vp.width * scale, vp.height * scale));
          const culled = await draw(page, scale, rect, { operationsFilter: (i: number) => (filter(i) ? (kept++, true) : false) });
          const full = await draw(page, scale, rect);
          if (kept < recorded.length) culledSomewhere = true;
          let worst = 0;
          for (let k = 0; k < full.length; k++) worst = Math.max(worst, Math.abs(full[k] - culled[k]));
          expect(worst, `${file} tile at ${x},${y}`).toBeLessThanOrEqual(8);
        }
      }
      expect(culledSomewhere).toBe(true);
    } finally {
      await task.destroy();
    }
  }, 60_000);
});
