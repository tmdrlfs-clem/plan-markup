import { OPS } from "pdfjs-dist";
import { describe, expect, it } from "vitest";
import { contentFlags, type OpsTable } from "./content-flags";

const ops = OPS as unknown as OpsTable;
const flags = (list: [number, unknown?][]) =>
  contentFlags(
    list.map(([fn]) => fn),
    list.map(([, args]) => args ?? null),
    ops,
  );

describe("contentFlags", () => {
  it("flags a painted path as vector", () => {
    expect(flags([[ops.constructPath, [ops.stroke, [], null]]])).toEqual({ hasVector: true, hasText: false, imageOnly: false });
    expect(flags([[ops.fill]])).toMatchObject({ hasVector: true });
  });

  it("does not count a clip-only path (re W n) as vector", () => {
    expect(
      flags([
        [ops.constructPath, [ops.endPath, [], null]],
        [ops.paintImageXObject, ["img1"]],
      ]),
    ).toEqual({ hasVector: false, hasText: false, imageOnly: true });
  });

  it("counts text, including invisible OCR text, as text", () => {
    expect(flags([[ops.paintImageXObject], [ops.showText]])).toEqual({ hasVector: false, hasText: true, imageOnly: false });
  });

  it.each([ops.paintInlineImageXObject, ops.paintImageMaskXObject, ops.paintSolidColorImageMask])(
    "treats image op %i alone as image-only",
    (op) => expect(flags([[op]]).imageOnly).toBe(true),
  );

  it("an empty page is not image-only", () => {
    expect(flags([])).toEqual({ hasVector: false, hasText: false, imageOnly: false });
  });
});
