// Flattening (prototype of FR58/FR61, framework-free): draws each annotation's
// normal appearance into the page content and removes the annotation.
//
// Placement follows ISO 32000-1 12.5.5: the form's /BBox is transformed by its
// /Matrix, and the resulting box is mapped onto the annotation /Rect by a
// scale + translate matrix A; the page draws `q A cm /Name Do Q` (Do applies the
// form's own /Matrix). Annotations on a hidden layer (OCG off in the default
// configuration), hidden/no-view annotations and empty appearances are removed
// without drawing. Visible layered content stays on its layer: it is wrapped
// in `/OC /name BDC … EMC`. Links keep working: their appearance is flattened
// and the link stays as a borderless annotation without /AP. Form fields
// (widgets) are left alone.

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "@cantoo/pdf-lib";

import { nums, type Box } from "../pdf/content";

export type Matrix = [number, number, number, number, number, number];

export type FlattenResult = {
  /** Annotations drawn into the page content. */
  flattened: number;
  /** Annotations removed without drawing (hidden layer, hidden flag, no appearance). */
  dropped: number;
  /** Annotations kept (links without /AP, widgets). */
  kept: number;
};

const FLAG_HIDDEN = 1 << 1;
const FLAG_NO_VIEW = 1 << 5;

export function multiply(a: Matrix, b: Matrix): Matrix {
  // Row-vector convention (PDF): p' = p × a × b.
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function transformBox(box: Box, m: Matrix): Box {
  const pts = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[2], box[3]],
    [box[0], box[3]],
  ].map(([x, y]) => [x! * m[0] + y! * m[2] + m[4], x! * m[1] + y! * m[3] + m[5]] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Matrix A of ISO 32000-1 12.5.5: maps the form's transformed bounding box
 * onto the annotation rectangle. Undefined when the box is degenerate.
 */
export function appearanceMatrix(rect: Box, bbox: Box, formMatrix: Matrix): Matrix | undefined {
  const t = transformBox(bbox, formMatrix);
  const w = t[2] - t[0];
  const h = t[3] - t[1];
  if (!(w > 0) || !(h > 0)) return undefined;
  const sx = (rect[2] - rect[0]) / w;
  const sy = (rect[3] - rect[1]) / h;
  return [sx, 0, 0, sy, rect[0] - t[0] * sx, rect[1] - t[1] * sy];
}

function numbers(arr: PDFArray | undefined, n: number): number[] | undefined {
  if (!arr || arr.size() < n) return undefined;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = arr.lookup(i);
    if (!(v instanceof PDFNumber)) return undefined;
    out.push(v.asNumber());
  }
  return out;
}

function normalize(b: number[]): Box {
  return [Math.min(b[0]!, b[2]!), Math.min(b[1]!, b[3]!), Math.max(b[0]!, b[2]!), Math.max(b[1]!, b[3]!)];
}

/** The normal appearance stream (resolving an /AS appearance state). */
function normalAppearance(annot: PDFDict): { stream: PDFStream; ref: PDFRef | undefined } | undefined {
  const ap = annot.lookupMaybe(PDFName.of("AP"), PDFDict);
  if (!ap) return undefined;
  let raw: PDFObject | undefined = ap.get(PDFName.of("N"));
  let ref = raw instanceof PDFRef ? raw : undefined;
  let n = ap.lookup(PDFName.of("N"));
  if (n instanceof PDFDict && !(n instanceof PDFStream)) {
    const as = annot.lookupMaybe(PDFName.of("AS"), PDFName);
    if (!as) return undefined;
    raw = n.get(as);
    ref = raw instanceof PDFRef ? raw : undefined;
    n = n.lookup(as);
  }
  return n instanceof PDFStream ? { stream: n, ref } : undefined;
}

/** OCGs that are off in the default configuration. */
function hiddenGroups(doc: PDFDocument): { off: Set<string>; baseOff: boolean; on: Set<string> } {
  const props = doc.catalog.lookupMaybe(PDFName.of("OCProperties"), PDFDict);
  const d = props?.lookupMaybe(PDFName.of("D"), PDFDict);
  const set = (key: string) => {
    const arr = d?.lookupMaybe(PDFName.of(key), PDFArray);
    const out = new Set<string>();
    if (arr) for (let i = 0; i < arr.size(); i++) {
      const r = arr.get(i);
      if (r instanceof PDFRef) out.add(r.toString());
    }
    return out;
  };
  const base = d?.lookupMaybe(PDFName.of("BaseState"), PDFName);
  return { off: set("OFF"), on: set("ON"), baseOff: base?.asString() === "/OFF" };
}

function groupVisible(ref: PDFRef, state: ReturnType<typeof hiddenGroups>): boolean {
  const key = ref.toString();
  if (state.off.has(key)) return false;
  if (state.baseOff) return state.on.has(key);
  return true;
}

/** Visibility of an /OC entry (OCG, or OCMD with the default /AnyOn policy). */
function ocVisible(context: PDFContext, oc: PDFObject | undefined, state: ReturnType<typeof hiddenGroups>): boolean {
  if (!(oc instanceof PDFRef)) return true;
  const dict = context.lookup(oc);
  if (!(dict instanceof PDFDict)) return true;
  const type = dict.lookupMaybe(PDFName.of("Type"), PDFName)?.asString();
  if (type === "/OCG") return groupVisible(oc, state);
  if (type === "/OCMD") {
    const ocgs = dict.get(PDFName.of("OCGs"));
    const refs: PDFRef[] = [];
    if (ocgs instanceof PDFRef && context.lookup(ocgs) instanceof PDFDict && !(context.lookup(ocgs) instanceof PDFArray)) refs.push(ocgs);
    const arr = dict.lookupMaybe(PDFName.of("OCGs"), PDFArray);
    if (arr) for (let i = 0; i < arr.size(); i++) {
      const r = arr.get(i);
      if (r instanceof PDFRef) refs.push(r);
    }
    const policy = dict.lookupMaybe(PDFName.of("P"), PDFName)?.asString() ?? "/AnyOn";
    const vis = refs.map((r) => groupVisible(r, state));
    if (vis.length === 0) return true;
    if (policy === "/AllOn") return vis.every(Boolean);
    if (policy === "/AnyOff") return vis.some((v) => !v);
    if (policy === "/AllOff") return vis.every((v) => !v);
    return vis.some(Boolean);
  }
  return true;
}

function propertiesDict(page: PDFPage): PDFDict {
  const { Resources } = page.node.normalizedEntries();
  let props = Resources.lookupMaybe(PDFName.of("Properties"), PDFDict);
  if (!props) {
    props = page.doc.context.obj({});
    Resources.set(PDFName.of("Properties"), props);
  }
  return props;
}

/** Flattens the annotations of one page. */
export function flattenPage(doc: PDFDocument, pageIndex: number): FlattenResult {
  const context = doc.context;
  const page = doc.getPage(pageIndex);
  const annots = page.node.Annots();
  const result: FlattenResult = { flattened: 0, dropped: 0, kept: 0 };
  if (!annots || annots.size() === 0) return result;
  const state = hiddenGroups(doc);
  const ops: string[] = [];
  const keep: PDFObject[] = [];
  const ocNames = new Map<string, string>();

  for (let i = 0; i < annots.size(); i++) {
    const entry = annots.get(i);
    const annot = annots.lookup(i);
    if (!(annot instanceof PDFDict)) continue;
    const subtype = annot.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString();
    if (subtype === "/Widget") {
      keep.push(entry);
      result.kept++;
      continue;
    }
    if (subtype === "/Popup") {
      result.dropped++;
      continue;
    }
    const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
    const oc = annot.get(PDFName.of("OC"));
    const visible = (flags & (FLAG_HIDDEN | FLAG_NO_VIEW)) === 0 && ocVisible(context, oc, state);
    const ap = visible ? normalAppearance(annot) : undefined;
    const rect = numbers(annot.lookupMaybe(PDFName.of("Rect"), PDFArray), 4);
    const bbox = ap ? numbers(ap.stream.dict.lookupMaybe(PDFName.of("BBox"), PDFArray), 4) : undefined;
    const fm = (ap && numbers(ap.stream.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray), 6)) ?? [1, 0, 0, 1, 0, 0];
    const a = ap && rect && bbox ? appearanceMatrix(normalize(rect), normalize(bbox), fm as Matrix) : undefined;

    if (ap && a) {
      const formRef = ap.ref ?? context.register(ap.stream);
      const xName = page.node.newXObject("FlatAp", formRef);
      let open = "";
      let close = "";
      if (oc instanceof PDFRef) {
        let ocName = ocNames.get(oc.toString());
        if (!ocName) {
          const props = propertiesDict(page);
          let k = 0;
          do ocName = `OCFlat${k++}`;
          while (props.has(PDFName.of(ocName)));
          props.set(PDFName.of(ocName), oc);
          ocNames.set(oc.toString(), ocName);
        }
        open = `/OC /${ocName} BDC\n`;
        close = "\nEMC";
      }
      ops.push(`${open}q\n${nums(...a)} cm\n${xName.asString()} Do\nQ${close}`);
      result.flattened++;
    } else {
      result.dropped += subtype === "/Link" ? 0 : 1;
    }

    if (subtype === "/Link") {
      annot.delete(PDFName.of("AP"));
      annot.set(PDFName.of("Border"), context.obj([0, 0, 0]));
      keep.push(entry);
      result.kept++;
    }
  }

  if (ops.length > 0) {
    // Isolate the existing content's graphics state from ours.
    const start = context.register(context.flateStream("q\n"));
    const end = context.register(context.flateStream("\nQ\n"));
    page.node.wrapContentStreams(start, end);
    page.node.addContentStream(context.register(context.flateStream(ops.join("\n") + "\n")));
  }
  if (keep.length > 0) page.node.set(PDFName.of("Annots"), context.obj(keep));
  else page.node.delete(PDFName.of("Annots"));
  return result;
}

/** Flattens every page. */
export function flattenDocument(doc: PDFDocument): FlattenResult {
  const total: FlattenResult = { flattened: 0, dropped: 0, kept: 0 };
  for (let i = 0; i < doc.getPageCount(); i++) {
    const r = flattenPage(doc, i);
    total.flattened += r.flattened;
    total.dropped += r.dropped;
    total.kept += r.kept;
  }
  return total;
}
