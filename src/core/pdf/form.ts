// Registers appearance streams (form XObjects) and their resources with a
// pdf-lib context (framework-free). Content and images are Flate-compressed.

import { PDFDict, PDFName, PDFNumber, type PDFContext, type PDFRef } from "@cantoo/pdf-lib";

import type { Box } from "./content";

/** Raw 8-bit RGB image (width × height × 3 bytes), with an optional 8-bit alpha (width × height bytes, an /SMask). */
export type ImageResource = { width: number; height: number; rgb: Uint8Array; alpha?: Uint8Array };
export type ExtGStateResource = { CA?: number; ca?: number; BM?: string };

/** A form's content (operators) plus the resources it names. */
export type FormContent = {
  bbox: Box;
  /** Optional form matrix; identity when absent. */
  matrix?: [number, number, number, number, number, number];
  content: string;
  /** Resource name → standard-14 base font (WinAnsi). */
  fonts: Record<string, string>;
  extGStates: Record<string, ExtGStateResource>;
  images: Record<string, ImageResource>;
};

/** Shares identical resources between forms of one document. */
export class FormWriter {
  private readonly context: PDFContext;
  private readonly images = new Map<ImageResource, PDFRef>();
  private readonly fonts = new Map<string, PDFRef>();

  constructor(context: PDFContext) {
    this.context = context;
  }

  private image(img: ImageResource): PDFRef {
    const known = this.images.get(img);
    if (known) return known;
    if (img.rgb.length !== img.width * img.height * 3) throw new Error("Image data size does not match width × height × 3");
    if (img.alpha && img.alpha.length !== img.width * img.height) throw new Error("Alpha data size does not match width × height");
    // Story 8.1: a transparent image (a signature) keeps its transparency as a soft mask.
    const smask = img.alpha
      ? this.context.register(
          this.context.flateStream(img.alpha, { Type: "XObject", Subtype: "Image", Width: img.width, Height: img.height, ColorSpace: "DeviceGray", BitsPerComponent: 8 }),
        )
      : undefined;
    const ref = this.context.register(
      this.context.flateStream(img.rgb, {
        Type: "XObject",
        Subtype: "Image",
        Width: img.width,
        Height: img.height,
        ColorSpace: "DeviceRGB",
        BitsPerComponent: 8,
        ...(smask ? { SMask: smask } : {}),
      }),
    );
    this.images.set(img, ref);
    return ref;
  }

  private font(baseFont: string): PDFRef {
    const known = this.fonts.get(baseFont);
    if (known) return known;
    const ref = this.context.register(
      this.context.obj({ Type: "Font", Subtype: "Type1", BaseFont: baseFont, Encoding: "WinAnsiEncoding" }),
    );
    this.fonts.set(baseFont, ref);
    return ref;
  }

  /** Builds the /Resources dictionary of a form. */
  resources(form: Pick<FormContent, "fonts" | "extGStates" | "images">): PDFDict {
    const c = this.context;
    const res = PDFDict.withContext(c);
    const gsNames = Object.keys(form.extGStates);
    if (gsNames.length > 0) {
      const gs = PDFDict.withContext(c);
      for (const n of gsNames) {
        const s = form.extGStates[n]!;
        const d = PDFDict.withContext(c);
        d.set(PDFName.of("Type"), PDFName.of("ExtGState"));
        if (s.CA !== undefined) d.set(PDFName.of("CA"), PDFNumber.of(s.CA));
        if (s.ca !== undefined) d.set(PDFName.of("ca"), PDFNumber.of(s.ca));
        if (s.BM !== undefined) d.set(PDFName.of("BM"), PDFName.of(s.BM));
        gs.set(PDFName.of(n), d);
      }
      res.set(PDFName.of("ExtGState"), gs);
    }
    const imgNames = Object.keys(form.images);
    if (imgNames.length > 0) {
      const xo = PDFDict.withContext(c);
      for (const n of imgNames) xo.set(PDFName.of(n), this.image(form.images[n]!));
      res.set(PDFName.of("XObject"), xo);
    }
    const fontNames = Object.keys(form.fonts);
    if (fontNames.length > 0) {
      const fonts = PDFDict.withContext(c);
      for (const n of fontNames) fonts.set(PDFName.of(n), this.font(form.fonts[n]!));
      res.set(PDFName.of("Font"), fonts);
    }
    return res;
  }

  /** Registers a form XObject and returns its reference. */
  form(form: FormContent): PDFRef {
    const c = this.context;
    const stream = c.flateStream(form.content, {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: form.bbox,
      ...(form.matrix ? { Matrix: form.matrix } : {}),
    });
    stream.dict.set(PDFName.of("Resources"), this.resources(form));
    return c.register(stream);
  }
}
