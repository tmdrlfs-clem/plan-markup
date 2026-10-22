// Export writer: markups → PDF annotations on an existing page (framework-free,
// @cantoo/pdf-lib low-level object API). Two modes:
//   native           - the standard ISO 32000 subtype per markup type, with
//                      geometry keys, measurement dictionaries, layers and
//                      groups, so other viewers can edit the markups;
//   appearance-only  - the same geometry and appearance as a /Stamp that has
//                      only /AP (no editable semantics), the A5 fallback.
// Every annotation gets an /AP /N we draw ourselves (appearance.ts).
//
// Private keys: /PM_Device (device stamp metadata). With `revuKeys`, the
// Revu interoperability keys observed in the founder's own Revu files are
// added (docs/export-mapping.md lists each one and why).

import type { PDFDocument, PDFPage, PDFRef } from "@cantoo/pdf-lib";
import { PDFArray, PDFDict, PDFName } from "@cantoo/pdf-lib";

import type { Box, Pt } from "../pdf/content";
import { FormWriter, type FormContent } from "../pdf/form";
import { name, text, toPdfDict, toPdfObject, type PdfDictValue, type PdfValue } from "../pdf/value";
import { AREA_FILL_OPACITY, arcVertices, markupAppearance } from "./appearance";
import { measureDictionary, measureValue } from "./measure";
import type { Calibration, ExportDocument, Markup, MarkupType, Rgb } from "./model";

export type ExportMode = "native" | "appearance-only";

export type ExportOptions = {
  mode: ExportMode;
  /** Adds the Revu-observed measurement keys (variant file). */
  revuKeys?: boolean;
  /** Creation / modification time written to /CreationDate and /M. */
  date: Date;
  /** Page to annotate (0-based). Default 0. */
  pageIndex?: number;
};

/** One PDF annotation produced from a markup (plain data, before pdf-lib). */
export type AnnotationSpec = {
  /** /NM. */
  id: string;
  markupId: string;
  type: MarkupType;
  subtype: string;
  dict: PdfDictValue;
  form: FormContent;
  layer?: string;
  /** Group key; the first spec with a key is the group root. */
  group?: string;
};

/** Revu stores counts as Polygon + /IT /PolygonCount with this /MeasurementTypes flag (observed). */
export const REVU_COUNT_MEASUREMENT_TYPE = 128;
/** Value Revu writes in /BBMeasure /TargetUnitConversion (observed; equals one point in metres). */
export const REVU_TARGET_UNIT_CONVERSION = 0.0254 / 72;
/** Prefix of our private dictionary keys. */
export const PRIVATE_KEY_PREFIX = "PM_";

/** PDF date string (UTC): D:YYYYMMDDHHmmSSZ. */
export function pdfDate(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

const flat = (pts: Pt[]): number[] => pts.flatMap((p) => [p[0], p[1]]);

/** QuadPoints in the order Acrobat writes and pdf.js reads: UL, UR, LL, LR. */
export function quadPoints(quads: Box[]): number[] {
  return quads.flatMap((q) => [q[0], q[3], q[2], q[3], q[0], q[1], q[2], q[1]]);
}

function rgb(c: Rgb | undefined): PdfValue | undefined {
  return c ? [...c] : undefined;
}

function border(m: Markup, width = m.width ?? 1): PdfDictValue {
  return m.dash && m.dash.length > 0
    ? { Type: name("Border"), W: width, S: name("D"), D: [...m.dash] }
    : { Type: name("Border"), W: width, S: name("S") };
}

/** /DA for free text: font, size, text colour (rg) and border colour (RG). */
function defaultAppearance(size: number, textColor: Rgb, borderColor: Rgb | undefined): string {
  const f = (c: Rgb) => c.map((x) => String(Math.round(x * 1000) / 1000)).join(" ");
  return `${borderColor ? `${f(borderColor)} RG ` : ""}${f(textColor)} rg /Helv ${size} Tf`;
}

function defaultStyle(size: number, textColor: Rgb): string {
  const hex = textColor.map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  return `font: Helvetica ${size}pt; text-align:left; color:#${hex}`;
}

function contentsOf(m: Markup, cal: Calibration): string | undefined {
  const v = measureValue(m, cal);
  if (v) return v.text;
  switch (m.type) {
    case "textBox":
    case "typewriter":
    case "callout":
    case "cloudPlus":
    case "note":
      return m.text;
    default:
      return m.comment;
  }
}

/** Standard subtype and type-specific keys (native mode). */
function nativeKeys(m: Markup, cal: Calibration, form: FormContent, rd: [number, number, number, number] | undefined): { subtype: string; keys: PdfDictValue } {
  const measure = measureDictionary(cal);
  const bs = border(m);
  const rdValue = rd ? [...rd] : undefined;
  switch (m.type) {
    case "line":
      return { subtype: "Line", keys: { L: flat([m.from, m.to]), LE: [name("None"), name("None")], BS: bs } };
    case "arrow":
      return { subtype: "Line", keys: { L: flat([m.from, m.to]), LE: m.endings.map((e) => name(e)), BS: bs, IC: rgb(m.fill) } };
    case "polyline":
      return { subtype: "PolyLine", keys: { Vertices: flat(m.points), BS: bs } };
    case "arc":
      // No arc subtype in ISO 32000: a polyline through points on the arc (the appearance stays a true arc).
      return { subtype: "PolyLine", keys: { Vertices: flat(arcVertices(m.center, m.radius, m.startDeg, m.sweepDeg)), BS: bs } };
    case "polygon":
      return { subtype: "Polygon", keys: { Vertices: flat(m.points), BS: bs, IC: rgb(m.fill) } };
    case "cloud":
    case "cloudPlus":
      return {
        subtype: "Polygon",
        keys: { Vertices: flat(m.points), BS: bs, IC: rgb(m.fill), IT: name("PolygonCloud"), BE: { S: name("C"), I: m.intensity } },
      };
    case "rectangle":
      return { subtype: "Square", keys: { BS: bs, IC: rgb(m.fill), RD: rdValue } };
    case "whiteout":
      return { subtype: "Square", keys: { BS: border(m, 0), IC: rgb(m.fill ?? [1, 1, 1]), RD: rdValue } };
    case "ellipse":
      return { subtype: "Circle", keys: { BS: bs, IC: rgb(m.fill), RD: rdValue } };
    case "callout":
      return { subtype: "FreeText", keys: freeTextKeys(m, m.textRect, m.leader, form, "FreeTextCallout") };
    case "textBox":
      return { subtype: "FreeText", keys: freeTextKeys(m, m.rect, undefined, form, "FreeText") };
    case "typewriter":
      return { subtype: "FreeText", keys: { ...freeTextKeys({ ...m, color: undefined }, form.bbox, undefined, form, "FreeTextTypeWriter"), BS: border(m, 0) } };
    case "note":
      return { subtype: "Text", keys: { Name: name("Comment"), Open: false } };
    case "highlight":
      return { subtype: "Highlight", keys: { QuadPoints: quadPoints(m.quads) } };
    case "underline":
      return { subtype: "Underline", keys: { QuadPoints: quadPoints(m.quads) } };
    case "strikeout":
      return { subtype: "StrikeOut", keys: { QuadPoints: quadPoints(m.quads) } };
    case "pen":
      return { subtype: "Ink", keys: { InkList: m.strokes.map(flat), BS: bs } };
    case "stamp":
      return { subtype: "Stamp", keys: { Name: name("Approved") } };
    case "imageStamp":
      return { subtype: "Stamp", keys: { Name: name(`${PRIVATE_KEY_PREFIX}Image`) } };
    case "flag":
      return { subtype: "Stamp", keys: { Name: name(`${PRIVATE_KEY_PREFIX}Flag`) } };
    case "deviceStamp":
      return {
        subtype: "Stamp",
        keys: {
          Name: name(`${PRIVATE_KEY_PREFIX}Device`),
          [`${PRIVATE_KEY_PREFIX}Device`]: {
            Kind: name(m.device.kind),
            Model: text(m.device.model),
            KFactor: m.device.kFactor,
            TemperatureC: m.device.temperatureC,
            Orientation: m.device.orientation ? name(m.device.orientation) : undefined,
          },
        },
      };
    case "hyperlink":
      return {
        subtype: "Link",
        keys: { A: { Type: name("Action"), S: name("URI"), URI: text(m.uri) }, Border: [0, 0, 0], H: name("I") },
      };
    case "dimension":
      return {
        subtype: "Line",
        keys: {
          L: flat([m.from, m.to]),
          LE: [name("ClosedArrow"), name("ClosedArrow")],
          LL: m.leader,
          LLE: m.leaderExtension,
          Cap: true,
          CP: name("Top"),
          IT: name("LineDimension"),
          Measure: measure,
          BS: bs,
        },
      };
    case "length":
      return {
        subtype: "Line",
        keys: { L: flat([m.from, m.to]), LE: [name("Butt"), name("Butt")], Cap: true, CP: name("Top"), IT: name("LineDimension"), Measure: measure, BS: bs },
      };
    case "polylength":
      return { subtype: "PolyLine", keys: { Vertices: flat(m.points), IT: name("PolyLineDimension"), Measure: measure, BS: bs } };
    case "perimeter":
      // A closed path written as a polyline that returns to its first vertex.
      return { subtype: "PolyLine", keys: { Vertices: flat([...m.points, m.points[0]!]), IT: name("PolyLineDimension"), Measure: measure, BS: bs } };
    case "area":
    case "dynamicFill":
      return { subtype: "Polygon", keys: { Vertices: flat(m.points), IT: name("PolygonDimension"), Measure: measure, BS: bs, IC: rgb(m.fill) } };
    case "count":
      // No count intent in ISO 32000: a polygon whose vertices are the counted points.
      return { subtype: "Polygon", keys: { Vertices: flat(m.points), BS: bs } };
    case "angle":
      // No angle intent: a three-vertex polyline (ray end, vertex, ray end).
      return { subtype: "PolyLine", keys: { Vertices: flat([m.a, m.vertex, m.b]), BS: bs } };
    case "radius":
    case "diameter":
      // No radius/diameter intent: the measured circle, with the measure dictionary.
      return { subtype: "Circle", keys: { RD: rdValue, Measure: measure, BS: bs } };
  }
}

function freeTextKeys(
  m: Markup & { fontSize: number; textColor: Rgb },
  textRect: Box,
  leader: Pt[] | undefined,
  form: FormContent,
  intent: string,
): PdfDictValue {
  const b = form.bbox;
  return {
    IT: name(intent),
    DA: text(defaultAppearance(m.fontSize, m.textColor, m.color)),
    DS: text(defaultStyle(m.fontSize, m.textColor)),
    Q: 0,
    CL: leader ? flat(leader) : undefined,
    LE: leader ? name("OpenArrow") : undefined,
    RD: [textRect[0] - b[0], b[3] - textRect[3], b[2] - textRect[2], textRect[1] - b[1]],
    BS: border(m),
    // FreeText /C is read as the background colour by common viewers.
    C: rgb(m.type === "cloudPlus" ? [1, 1, 1] : m.fill),
  };
}

/** Revu interoperability keys for measurement markups (variant file). */
function revuKeys(m: Markup, cal: Calibration): PdfDictValue {
  const v = measureValue(m, cal);
  if (!v) return {};
  const keys: PdfDictValue = {
    BBMeasure: { ...measureDictionary(cal), TargetUnitConversion: REVU_TARGET_UNIT_CONVERSION },
  };
  if (m.type === "count") {
    keys.IT = name("PolygonCount");
    keys.NumCounts = m.points.length;
    keys.MeasurementTypes = REVU_COUNT_MEASUREMENT_TYPE;
    keys.CountStyle = name("Checkmark");
  }
  if (m.type === "area" || m.type === "dynamicFill") keys.FillOpacity = AREA_FILL_OPACITY;
  return keys;
}

/** Builds the annotation specs (plain data) for one markup. */
export function annotationSpecs(m: Markup, cal: Calibration, options: Pick<ExportOptions, "mode" | "revuKeys" | "date">): AnnotationSpec[] {
  const ap = markupAppearance(m, cal);
  const date = text(pdfDate(options.date));
  const common = (form: FormContent, id: string): PdfDictValue => ({
    Type: name("Annot"),
    Rect: [...form.bbox],
    NM: text(id),
    Subj: text(m.subject),
    T: text(m.author),
    M: date,
    CreationDate: date,
    F: 4,
  });
  const group = m.type === "cloudPlus" ? (m.group ?? m.id) : m.group;
  const contents = contentsOf(m, cal);

  if (options.mode === "appearance-only") {
    const forms = [ap.form, ...(ap.extra ?? [])];
    return forms.map((form, i) => {
      const id = i === 0 ? m.id : `${m.id}-${i}`;
      const subtype = m.type === "hyperlink" ? "Link" : "Stamp";
      const dict: PdfDictValue = {
        ...common(form, id),
        Subtype: name(subtype),
        Contents: contents !== undefined ? text(contents) : undefined,
      };
      if (m.type === "hyperlink") Object.assign(dict, nativeKeys(m, cal, form, ap.rd).keys);
      return { id, markupId: m.id, type: m.type, subtype, dict, form, layer: m.layer, group };
    });
  }

  const { subtype, keys } = nativeKeys(m, cal, ap.form, ap.rd);
  const dict: PdfDictValue = {
    ...common(ap.form, m.id),
    Subtype: name(subtype),
    C: rgb(m.color),
    CA: m.opacity,
    ...keys,
    Contents: contents !== undefined ? text(contents) : undefined,
    ...(options.revuKeys ? revuKeys(m, cal) : {}),
  };
  if (m.type === "hyperlink") {
    delete dict.C;
    delete dict.CA;
  }
  const specs: AnnotationSpec[] = [{ id: m.id, markupId: m.id, type: m.type, subtype, dict, form: ap.form, layer: m.layer, group }];
  if (m.type === "cloudPlus" && ap.extra?.[0]) {
    const form = ap.extra[0];
    const id = `${m.id}-text`;
    specs.push({
      id,
      markupId: m.id,
      type: m.type,
      subtype: "FreeText",
      dict: {
        ...common(form, id),
        Subtype: name("FreeText"),
        CA: m.opacity,
        ...freeTextKeys(m, m.textRect, m.leader, form, "FreeTextCallout"),
        Contents: text(m.text),
      },
      form,
      layer: m.layer,
      group,
    });
  }
  return specs;
}

export type WrittenAnnotations = {
  specs: AnnotationSpec[];
  refs: PDFRef[];
  /** Layer id → OCG reference. */
  ocgs: Map<string, PDFRef>;
};

/** Adds the layers as optional content groups and wires the catalog's /OCProperties. */
export function addLayers(doc: PDFDocument, layers: ExportDocument["layers"]): Map<string, PDFRef> {
  const context = doc.context;
  const ocgs = new Map<string, PDFRef>();
  if (layers.length === 0) return ocgs;
  for (const layer of layers) {
    ocgs.set(layer.id, context.register(toPdfDict(context, { Type: name("OCG"), Name: text(layer.name) })));
  }
  const refs = [...ocgs.values()];
  const on = layers.filter((l) => l.visible).map((l) => ocgs.get(l.id)!);
  const off = layers.filter((l) => !l.visible).map((l) => ocgs.get(l.id)!);
  const existing = doc.catalog.lookupMaybe(PDFName.of("OCProperties"), PDFDict);
  if (existing) {
    const append = (d: PDFDict, key: string, items: PDFRef[]) => {
      const arr = d.lookupMaybe(PDFName.of(key), PDFArray);
      if (arr) for (const r of items) arr.push(r);
      else d.set(PDFName.of(key), context.obj(items));
    };
    append(existing, "OCGs", refs);
    let d = existing.lookupMaybe(PDFName.of("D"), PDFDict);
    if (!d) {
      d = context.obj({});
      existing.set(PDFName.of("D"), d);
    }
    append(d, "Order", refs);
    if (on.length) append(d, "ON", on);
    if (off.length) append(d, "OFF", off);
  } else {
    const d = PDFDict.withContext(context);
    d.set(PDFName.of("Name"), toPdfObject(context, text("Default")));
    d.set(PDFName.of("BaseState"), PDFName.of("ON"));
    d.set(PDFName.of("Order"), context.obj(refs));
    d.set(PDFName.of("ON"), context.obj(on));
    d.set(PDFName.of("OFF"), context.obj(off));
    const props = PDFDict.withContext(context);
    props.set(PDFName.of("OCGs"), context.obj(refs));
    props.set(PDFName.of("D"), d);
    doc.catalog.set(PDFName.of("OCProperties"), props);
  }
  return ocgs;
}

/** Writes every markup of `model` as annotations on one page of `doc`. */
export function writeAnnotations(doc: PDFDocument, model: ExportDocument, options: ExportOptions): WrittenAnnotations {
  const context = doc.context;
  const page: PDFPage = doc.getPage(options.pageIndex ?? 0);
  const forms = new FormWriter(context);
  const ocgs = addLayers(doc, model.layers);
  const roots = new Map<string, PDFRef>();
  const specs: AnnotationSpec[] = [];
  const refs: PDFRef[] = [];
  for (const m of model.markups) {
    if (m.layer && !ocgs.has(m.layer)) throw new Error(`Markup ${m.id}: unknown layer ${m.layer}`);
    for (const spec of annotationSpecs(m, model.calibration, options)) {
      const dict = toPdfDict(context, spec.dict);
      dict.set(PDFName.of("P"), page.ref);
      const ap = PDFDict.withContext(context);
      ap.set(PDFName.of("N"), forms.form(spec.form));
      dict.set(PDFName.of("AP"), ap);
      if (spec.layer) dict.set(PDFName.of("OC"), ocgs.get(spec.layer)!);
      const ref = context.register(dict);
      if (spec.group) {
        const root = roots.get(spec.group);
        if (root) {
          dict.set(PDFName.of("IRT"), root);
          dict.set(PDFName.of("RT"), PDFName.of("Group"));
        } else {
          roots.set(spec.group, ref);
        }
      }
      page.node.addAnnot(ref);
      specs.push(spec);
      refs.push(ref);
    }
  }
  return { specs, refs, ocgs };
}
