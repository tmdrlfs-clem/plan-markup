import { describe, expect, it } from "vitest";

import {
  ROW_CHROME,
  ROW_PADDING_X,
  boxAspect,
  fitInBox,
  revealRow,
  rowForKey,
  thumbnailLayout,
  thumbnailStep,
  visibleRows,
} from "./thumbnail-layout";

const A1_LANDSCAPE = { width: 2384, height: 1684 };
const A4_PORTRAIT = { width: 595, height: 842 };

describe("thumbnail sizes", () => {
  it("steps the raster width: a resize within a step needs no new raster (AC 6)", () => {
    expect(thumbnailStep(100)).toBe(160);
    expect(thumbnailStep(160)).toBe(160);
    expect(thumbnailStep(161)).toBe(240);
    expect(thumbnailStep(256)).toBe(320);
    expect(thumbnailStep(396)).toBe(400);
    expect(thumbnailStep(900)).toBe(400);
  });

  it("one box shape per document: the tallest page, clamped", () => {
    expect(boxAspect([A1_LANDSCAPE])).toBeCloseTo(1684 / 2384, 9);
    expect(boxAspect([A1_LANDSCAPE, A4_PORTRAIT])).toBeCloseTo(842 / 595, 9);
    expect(boxAspect([{ width: 100, height: 1000 }])).toBe(1.42);
    expect(boxAspect([{ width: 1000, height: 100 }])).toBe(0.5);
    expect(boxAspect([])).toBe(0.75);
  });

  it("lays rows out for the panel width; the device box follows the step and the DPR", () => {
    // Default 280 px panel: a 256 px box, the 320 px step.
    const at1 = thumbnailLayout(280, [A1_LANDSCAPE], 1);
    expect(at1.box.width).toBe(280 - 2 * ROW_PADDING_X);
    expect(at1.box.height).toBe(Math.round(256 * (1684 / 2384)));
    expect(at1.rowHeight).toBe(at1.box.height + ROW_CHROME);
    expect(at1.deviceBox).toEqual({ width: 320, height: Math.round(320 * (1684 / 2384)) });
    const at2 = thumbnailLayout(280, [A1_LANDSCAPE], 2);
    expect(at2.deviceBox.width).toBe(640);
    // 220 and 300 px panels: different boxes, same step, same raster.
    expect(thumbnailLayout(300, [A1_LANDSCAPE], 1).deviceBox).toEqual(thumbnailLayout(270, [A1_LANDSCAPE], 1).deviceBox);
    expect(thumbnailLayout(420, [A1_LANDSCAPE], 1).deviceBox.width).toBe(400);
  });

  it("fits a page into the box in whole CSS px", () => {
    expect(fitInBox(A4_PORTRAIT, { width: 256, height: 181 })).toEqual({ width: 128, height: 181 });
    expect(fitInBox(A1_LANDSCAPE, { width: 256, height: 181 })).toEqual({ width: 256, height: 181 });
    expect(fitInBox({ width: 0, height: 0 }, { width: 10, height: 20 })).toEqual({ width: 10, height: 20 });
  });
});

describe("virtual window", () => {
  it("mounts the visible rows plus one screen above and below (AC 2)", () => {
    // 100 px rows, 300 px viewport, scrolled to row 10.
    expect(visibleRows(1000, 300, 100, 50)).toEqual({ first: 7, last: 15 });
    expect(visibleRows(0, 300, 100, 50)).toEqual({ first: 0, last: 5 });
    expect(visibleRows(4800, 300, 100, 50)).toEqual({ first: 45, last: 49 });
    expect(visibleRows(0, 300, 100, 2)).toEqual({ first: 0, last: 1 });
    expect(visibleRows(1000, 300, 100, 50, 0)).toEqual({ first: 10, last: 12 });
    expect(visibleRows(0, 300, 100, 0)).toEqual({ first: 0, last: -1 });
  });

  it("reveals a row only when it is not fully in view", () => {
    expect(revealRow(5, 0, 300, 100)).toBe(300);
    expect(revealRow(1, 0, 300, 100)).toBeNull();
    expect(revealRow(2, 500, 300, 100)).toBe(200);
    // A row taller than the list shows its top.
    expect(revealRow(3, 0, 150, 200)).toBe(600);
    expect(revealRow(0, 0, 150, 200)).toBeNull();
  });
});

describe("list keys (AC 4)", () => {
  it("move by one, by a screen, or to the ends; other keys are not the list's", () => {
    expect(rowForKey("ArrowDown", 2, 10, 3)).toBe(3);
    expect(rowForKey("ArrowUp", 0, 10, 3)).toBe(0);
    expect(rowForKey("ArrowDown", 9, 10, 3)).toBe(9);
    expect(rowForKey("PageDown", 2, 10, 3)).toBe(5);
    expect(rowForKey("PageUp", 2, 10, 3)).toBe(0);
    expect(rowForKey("PageDown", 2, 10, 0)).toBe(3);
    expect(rowForKey("Home", 6, 10, 3)).toBe(0);
    expect(rowForKey("End", 1, 10, 3)).toBe(9);
    expect(rowForKey("a", 1, 10, 3)).toBeNull();
    expect(rowForKey("ArrowDown", 0, 0, 3)).toBeNull();
  });
});
