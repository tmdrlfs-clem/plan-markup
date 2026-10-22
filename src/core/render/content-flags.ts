// What a page draws, from its pdf.js operator list (Story 3.1, UX-DR31).
// Framework-free: the caller passes pdf.js's OPS table, so this module does not
// import pdf.js and tests can use a small fake list.

export type ContentFlags = { hasVector: boolean; hasText: boolean; imageOnly: boolean };

/** The pdf.js OPS codes this module reads (a subset of pdfjs-dist's `OPS`). */
export type OpsTable = Readonly<Record<
  | "constructPath"
  | "endPath"
  | "stroke"
  | "closeStroke"
  | "fill"
  | "eoFill"
  | "fillStroke"
  | "eoFillStroke"
  | "closeFillStroke"
  | "closeEOFillStroke"
  | "showText"
  | "showSpacedText"
  | "nextLineShowText"
  | "nextLineSetSpacingShowText"
  | "paintImageXObject"
  | "paintInlineImageXObject"
  | "paintInlineImageXObjectGroup"
  | "paintImageXObjectRepeat"
  | "paintImageMaskXObject"
  | "paintImageMaskXObjectGroup"
  | "paintImageMaskXObjectRepeat"
  | "paintSolidColorImageMask",
  number
>>;

/**
 * hasVector: a path is painted (stroked or filled). A path that is only used as
 * a clip (`re W n`, common around scans) ends with endPath and does not count.
 * hasText: any text-showing operator (invisible OCR text counts: it is text).
 * imageOnly: neither of those, and at least one image is painted.
 * In pdf.js 6 path operators arrive batched as constructPath(paintOp, data, minMax).
 */
export function contentFlags(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, ops: OpsTable): ContentFlags {
  const paint = new Set([
    ops.stroke,
    ops.closeStroke,
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ]);
  const text = new Set([ops.showText, ops.showSpacedText, ops.nextLineShowText, ops.nextLineSetSpacingShowText]);
  const image = new Set([
    ops.paintImageXObject,
    ops.paintInlineImageXObject,
    ops.paintInlineImageXObjectGroup,
    ops.paintImageXObjectRepeat,
    ops.paintImageMaskXObject,
    ops.paintImageMaskXObjectGroup,
    ops.paintImageMaskXObjectRepeat,
    ops.paintSolidColorImageMask,
  ]);
  let hasVector = false;
  let hasText = false;
  let hasImage = false;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === ops.constructPath) {
      const args = argsArray[i];
      const op = Array.isArray(args) ? args[0] : undefined;
      if (typeof op !== "number" || op !== ops.endPath) hasVector = true;
    } else if (paint.has(fn)) {
      hasVector = true;
    } else if (text.has(fn)) {
      hasText = true;
    } else if (image.has(fn)) {
      hasImage = true;
    }
    if (hasVector && hasText) break;
  }
  return { hasVector, hasText, imageOnly: !hasVector && !hasText && hasImage };
}
