// .btx item(s) → a one-page in-memory PDF that holds the annotation(s) and
// their resolved resources (framework-free; @cantoo/pdf-lib low-level API).
// pdf.js then draws the page with annotations: one rendering pipeline for
// every item. Annotations without /AP get an appearance from appearance.ts.
//
// Placement: every annotation (root and children) sits with its own /Rect
// origin at (-X, -Y) relative to the tool's anchor. Verified on the founder's
// files: concentric group members (ring + dot) only line up with this sign.

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFRawStream,
  type PDFContext,
  type PDFObject,
  type PDFRef,
} from "@cantoo/pdf-lib";

import { generateAppearance, hasAppearance, normalizeRect, type Box, type GeneratedAppearance } from "./appearance";
import type { BtxAnnotation, BtxItem } from "./parse";
import {
  dictGet,
  dictWith,
  getName,
  getNumbers,
  isDict,
  isRef,
  dictWithout,
  pdfDict,
  pdfName,
  type PdfDict,
  type PdfObject,
} from "./pdf-object";

export type Placement = { item: BtxItem; dx?: number; dy?: number };

export type BuildPdfOptions = {
  /** Margin around the union of the annotation rects, in pt. Default 4. */
  margin?: number;
  /** Mark children as a Revu-style group (/IRT root + /RT /Group), as a placed group in a Revu PDF. */
  linkGroups?: boolean;
};

export type BuiltAnnotation = {
  placement: number;
  member: number;
  subtype: string | undefined;
  generated: boolean;
  box: Box;
};

export type BuiltPdf = {
  bytes: Uint8Array;
  pageBox: Box;
  annotations: BuiltAnnotation[];
  warnings: string[];
};

/** Offset that places an annotation's own coordinates in the tool frame. */
export function memberOffset(a: Pick<BtxAnnotation, "x" | "y">): [number, number] {
  return [-a.x, -a.y];
}

function shiftPairs(v: PdfObject | undefined, dx: number, dy: number): PdfObject | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((n, i) => (typeof n === "number" ? n + (i % 2 === 0 ? dx : dy) : n));
}

/** A copy of the dictionary moved by (dx, dy): Rect, L, Vertices, InkList, CL, QuadPoints. */
export function translateAnnotation(dict: PdfDict, dx: number, dy: number): PdfDict {
  if (dx === 0 && dy === 0) return dict;
  let out = dict;
  for (const key of ["Rect", "L", "Vertices", "CL", "QuadPoints"]) {
    const moved = shiftPairs(dictGet(out, key), dx, dy);
    if (moved) out = dictWith(out, key, moved);
  }
  const ink = dictGet(out, "InkList");
  if (Array.isArray(ink)) {
    out = dictWith(
      out,
      "InkList",
      ink.map((path) => shiftPairs(path, dx, dy) ?? path),
    );
  }
  return out;
}

/** Union of the placed rects of one item (tool frame, before margin). */
export function itemBounds(item: BtxItem, dx = 0, dy = 0): Box | undefined {
  let box: Box | undefined;
  for (const a of item.annotations) {
    const r = normalizeRect(getNumbers(a.dict, "Rect"));
    if (!r) continue;
    const [ox, oy] = memberOffset(a);
    const placed: Box = [r[0] + ox + dx, r[1] + oy + dy, r[2] + ox + dx, r[3] + oy + dy];
    box = box
      ? [Math.min(box[0], placed[0]), Math.min(box[1], placed[1]), Math.max(box[2], placed[2]), Math.max(box[3], placed[3])]
      : placed;
  }
  return box;
}

// ---------------------------------------------------------------- PdfObject → pdf-lib

class Converter {
  private readonly refs = new Map<string, PDFRef>();
  private placeholder: PDFRef | undefined;
  readonly missing = new Set<string>();

  private readonly context: PDFContext;
  private readonly resources: Map<string, PdfObject>;

  constructor(context: PDFContext, resources: Map<string, PdfObject>) {
    this.context = context;
    this.resources = resources;
  }

  /** The PDFRef for a BBObjPtr id; converts the resource on first use. */
  ref(id: string): PDFRef {
    const known = this.refs.get(id);
    if (known) return known;
    const obj = this.resources.get(id);
    if (obj === undefined) {
      // Revu sometimes omits nested XObjects; an empty form keeps the rest drawable.
      this.missing.add(id);
      if (!this.placeholder) {
        this.placeholder = this.context.register(
          PDFRawStream.of(this.dict(pdfDict([["Type", pdfName("XObject")], ["Subtype", pdfName("Form")], ["BBox", [0, 0, 0, 0]]])), new Uint8Array()),
        );
      }
      this.refs.set(id, this.placeholder);
      return this.placeholder;
    }
    const ref = this.context.nextRef();
    this.refs.set(id, ref); // before converting: cycles resolve to the same ref
    this.context.assign(ref, this.value(obj, true));
    return ref;
  }

  dict(d: PdfDict): PDFDict {
    const out = PDFDict.withContext(this.context);
    for (const [k, v] of d.entries) out.set(PDFName.of(k), this.value(v, false));
    return out;
  }

  value(o: PdfObject, topLevel: boolean): PDFObject {
    if (o === null) return PDFNull;
    if (typeof o === "boolean") return o ? PDFBool.True : PDFBool.False;
    if (typeof o === "number") return PDFNumber.of(o);
    if (Array.isArray(o)) {
      const arr = PDFArray.withContext(this.context);
      for (const x of o) arr.push(this.value(x, false));
      return arr;
    }
    switch (o.kind) {
      case "name":
        return PDFName.of(o.value);
      case "string":
        return PDFHexString.fromBytes(o.bytes);
      case "ref":
        return this.ref(o.ref);
      case "dict":
        return this.dict(o);
      case "stream": {
        const s = PDFRawStream.of(this.dict(o.dict), o.data);
        return topLevel ? s : this.context.register(s);
      }
    }
  }
}

function appearanceStream(context: PDFContext, conv: Converter, ap: GeneratedAppearance): PDFRef {
  const res = PDFDict.withContext(context);
  const gsNames = Object.keys(ap.extGStates);
  if (gsNames.length > 0) {
    const gs = PDFDict.withContext(context);
    for (const name of gsNames) {
      const state = ap.extGStates[name]!;
      const d = PDFDict.withContext(context);
      d.set(PDFName.of("Type"), PDFName.of("ExtGState"));
      if (state.CA !== undefined) d.set(PDFName.of("CA"), PDFNumber.of(state.CA));
      if (state.ca !== undefined) d.set(PDFName.of("ca"), PDFNumber.of(state.ca));
      gs.set(PDFName.of(name), d);
    }
    res.set(PDFName.of("ExtGState"), gs);
  }
  const xNames = Object.keys(ap.xObjects);
  if (xNames.length > 0) {
    const xo = PDFDict.withContext(context);
    for (const name of xNames) xo.set(PDFName.of(name), conv.ref(ap.xObjects[name]!));
    res.set(PDFName.of("XObject"), xo);
  }
  const fontNames = Object.keys(ap.fonts);
  if (fontNames.length > 0) {
    const fonts = PDFDict.withContext(context);
    for (const name of fontNames) {
      const f = PDFDict.withContext(context);
      f.set(PDFName.of("Type"), PDFName.of("Font"));
      f.set(PDFName.of("Subtype"), PDFName.of("Type1"));
      f.set(PDFName.of("BaseFont"), PDFName.of(ap.fonts[name]!));
      f.set(PDFName.of("Encoding"), PDFName.of("WinAnsiEncoding"));
      fonts.set(PDFName.of(name), f);
    }
    res.set(PDFName.of("Font"), fonts);
  }
  const dict = PDFDict.withContext(context);
  dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  dict.set(PDFName.of("BBox"), context.obj(ap.bbox));
  dict.set(PDFName.of("Resources"), res);
  return context.register(PDFRawStream.of(dict, new TextEncoder().encode(ap.content)));
}

/** Builds one page holding all placements (each item shifted by its dx/dy). */
export async function buildPdf(placements: Placement[], options: BuildPdfOptions = {}): Promise<BuiltPdf> {
  const margin = options.margin ?? 4;
  const doc = await PDFDocument.create({ updateMetadata: false });
  const context = doc.context;
  const page = doc.addPage([10, 10]);
  const annotRefs: PDFRef[] = [];
  const built: BuiltAnnotation[] = [];
  const warnings: string[] = [];
  let union: Box | undefined;

  placements.forEach((placement, pi) => {
    const { item } = placement;
    const conv = new Converter(context, item.resources);
    let rootRef: PDFRef | undefined;
    item.annotations.forEach((a, mi) => {
      const [ox, oy] = memberOffset(a);
      const dx = ox + (placement.dx ?? 0);
      const dy = oy + (placement.dy ?? 0);
      let dict = translateAnnotation(a.dict, dx, dy);
      // Revu writes /OC as a layer-name string; viewers expect an OCG/OCMD
      // dictionary and report the annotation as malformed. Drop it here only.
      const oc = dictGet(dict, "OC");
      if (oc !== undefined && !isDict(oc) && !isRef(oc)) dict = dictWithout(dict, "OC");
      const rect = normalizeRect(getNumbers(dict, "Rect"));
      if (!rect) {
        warnings.push(`Placement ${pi} member ${mi}: no /Rect, skipped`);
        return;
      }
      let generated = false;
      let apRef: PDFRef | undefined;
      if (!hasAppearance(a.dict)) {
        const ap = generateAppearance(a.dict);
        if (ap) {
          apRef = appearanceStream(context, conv, ap);
          generated = true;
        } else {
          warnings.push(`Placement ${pi} member ${mi}: no /AP and no generator for /${getName(a.dict, "Subtype") ?? "?"}`);
        }
      }
      const libDict = conv.dict(dict);
      if (apRef) {
        const apDict = PDFDict.withContext(context);
        apDict.set(PDFName.of("N"), apRef);
        libDict.set(PDFName.of("AP"), apDict);
      }
      libDict.set(PDFName.of("Type"), PDFName.of("Annot"));
      libDict.set(PDFName.of("P"), page.ref);
      const ref = context.register(libDict);
      if (mi === 0) rootRef = ref;
      else if (options.linkGroups && rootRef) {
        libDict.set(PDFName.of("IRT"), rootRef);
        libDict.set(PDFName.of("RT"), PDFName.of("Group"));
      }
      annotRefs.push(ref);
      built.push({ placement: pi, member: mi, subtype: getName(a.dict, "Subtype"), generated, box: rect });
      union = union
        ? [Math.min(union[0], rect[0]), Math.min(union[1], rect[1]), Math.max(union[2], rect[2]), Math.max(union[3], rect[3])]
        : rect;
    });
    if (conv.missing.size > 0) warnings.push(`Placement ${pi}: ${conv.missing.size} missing resource(s) drawn empty`);
  });

  const box: Box = union
    ? [union[0] - margin, union[1] - margin, union[2] + margin, union[3] + margin]
    : [0, 0, 2 * margin, 2 * margin];
  page.setMediaBox(box[0], box[1], box[2] - box[0], box[3] - box[1]);
  page.node.set(PDFName.of("Annots"), context.obj(annotRefs));
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes, pageBox: box, annotations: built, warnings };
}

/** One item on its own page. */
export function buildItemPdf(item: BtxItem, options: BuildPdfOptions = {}): Promise<BuiltPdf> {
  return buildPdf([{ item }], options);
}
