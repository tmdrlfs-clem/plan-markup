// Tile culling by recorded operation boxes (Story 3.7 review, tile fill). Framework-free.
//
// pdf.js runs a page's whole operator list for every tile: on L17 (~176 k
// operators) a 512 px tile cost ~240 ms in the worker whatever little of the
// drawing it shows, so a jump at ~190 % (about 40 tiles) took ~10 s to fill.
// pdf.js 6.4 can record, during one full-page render, a box for each operator
// (`recordOperations`, page.recordedBBoxes: coordinates as a share of the
// recording canvas, in steps of 1/256, state operators carrying the boxes of
// the drawing they affect) and then run only the operators a filter keeps
// (`operationsFilter`). Its own viewer does exactly this for its zoomed "detail
// view" (enableOptimizedPartialRendering). A tile keeps the operators whose box
// meets the tile's rectangle, widened by OP_CULL_MARGIN.

/** pdf.js's recorded operation boxes (its BBoxReader), as fractions of the page's viewport. */
export interface OperationBoxes {
  readonly length: number;
  isEmpty(index: number): boolean;
  minX(index: number): number;
  minY(index: number): number;
  maxX(index: number): number;
  maxY(index: number): number;
}

/**
 * Widening of the tile rectangle, as a share of the page: two of pdf.js's
 * 1/256 box steps, covering the rounding of the recording canvas and of the
 * boxes themselves. Culling only ever drops an operator that cannot touch the tile.
 */
export const OP_CULL_MARGIN = 2 / 256;

/** A rectangle of the page as fractions of its viewport (0..1, y down). */
export type PageFraction = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * The share of the page a tile covers: device rectangle `x, y, width, height`
 * of the page rendered at `pageWidthPx` x `pageHeightPx` device px (the
 * viewport, /Rotate applied, the same rotation the boxes were recorded in).
 */
export function tileFraction(
  rect: { x: number; y: number; width: number; height: number },
  pageWidthPx: number,
  pageHeightPx: number,
): PageFraction {
  return {
    minX: rect.x / pageWidthPx,
    minY: rect.y / pageHeightPx,
    maxX: (rect.x + rect.width) / pageWidthPx,
    maxY: (rect.y + rect.height) / pageHeightPx,
  };
}

/**
 * pdf.js `operationsFilter` for a tile: keeps the operators whose recorded box
 * meets `area` widened by OP_CULL_MARGIN. Operators without a box draw
 * nothing anywhere (pdf.js's viewer skips them the same way). Indices past
 * the recording (an operator list that grew) are always kept.
 */
export function operationsFilterFor(boxes: OperationBoxes, area: PageFraction): (index: number) => boolean {
  const minX = area.minX - OP_CULL_MARGIN;
  const minY = area.minY - OP_CULL_MARGIN;
  const maxX = area.maxX + OP_CULL_MARGIN;
  const maxY = area.maxY + OP_CULL_MARGIN;
  const length = boxes.length;
  return (index) => {
    if (index >= length) return true;
    if (boxes.isEmpty(index)) return false;
    return boxes.minX(index) <= maxX && boxes.maxX(index) >= minX && boxes.minY(index) <= maxY && boxes.maxY(index) >= minY;
  };
}
