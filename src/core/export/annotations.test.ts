import { readFileSync } from "node:fs";

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, decodePDFRawStream, type PDFRawStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { isDictValue, isNameValue, isTextValue, type PdfDictValue, type PdfValue } from "../pdf/value";
import { annotationSpecs, pdfDate, quadPoints, REVU_COUNT_MEASUREMENT_TYPE, writeAnnotations, type AnnotationSpec } from "./annotations";
import { CALIBRATED_TYPES, MEASUREMENT_TYPES, type Markup, type MarkupType } from "./model";
import { SAMPLE_DATE, sampleDocument } from "./sample-set";

const SAMPLE = new URL("../../../fixtures/pdf/export-sample.pdf", import.meta.url);
const OPTS = { mode: "native" as const, date: SAMPLE_DATE };

/** Standard subtype (and intent) each markup type maps to in the native export. */
const EXPECTED: Record<MarkupType, { subtype: string; it?: string }> = {
  line: { subtype: "Line" },
  arrow: { subtype: "Line" },
  polyline: { subtype: "PolyLine" },
  polygon: { subtype: "Polygon" },
  rectangle: { subtype: "Square" },
  ellipse: { subtype: "Circle" },
  arc: { subtype: "PolyLine" },
  cloud: { subtype: "Polygon", it: "PolygonCloud" },
  cloudPlus: { subtype: "Polygon", it: "PolygonCloud" },
  callout: { subtype: "FreeText", it: "FreeTextCallout" },
  textBox: { subtype: "FreeText", it: "FreeText" },
  typewriter: { subtype: "FreeText", it: "FreeTextTypeWriter" },
  note: { subtype: "Text" },
  highlight: { subtype: "Highlight" },
  underline: { subtype: "Underline" },
  strikeout: { subtype: "StrikeOut" },
  squiggly: { subtype: "Squiggly" },
  pen: { subtype: "Ink" },
  stamp: { subtype: "Stamp" },
  imageStamp: { subtype: "Stamp" },
  flag: { subtype: "Stamp" },
  deviceStamp: { subtype: "Stamp" },
  hyperlink: { subtype: "Link" },
  whiteout: { subtype: "Square" },
  dimension: { subtype: "Line", it: "LineDimension" },
  length: { subtype: "Line", it: "LineDimension" },
  polylength: { subtype: "PolyLine", it: "PolyLineDimension" },
  perimeter: { subtype: "PolyLine", it: "PolyLineDimension" },
  area: { subtype: "Polygon", it: "PolygonDimension" },
  dynamicFill: { subtype: "Polygon", it: "PolygonDimension" },
  count: { subtype: "Polygon" },
  angle: { subtype: "PolyLine" },
  radius: { subtype: "Circle" },
  diameter: { subtype: "Circle" },
};

const nameOf = (v: PdfValue | undefined) => (isNameValue(v) ? v.$name : undefined);
const nums = (v: PdfValue | undefined): number[] => (Array.isArray(v) ? v.flat(2).filter((x): x is number => typeof x === "number") : []);

/** Every coordinate pair of the geometry keys. */
function geometryPoints(dict: PdfDictValue): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const key of ["L", "Vertices", "InkList", "QuadPoints", "CL"]) {
    const n = nums(dict[key]);
    for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  }
  return out;
}

/** q/Q and BT/ET balanced, operators only from a known set. */
function checkContent(content: string): void {
  let q = 0;
  let bt = 0;
  const ops = new Set(["q", "Q", "cm", "w", "J", "j", "d", "gs", "m", "l", "c", "h", "re", "S", "s", "f", "B", "n", "W", "RG", "rg", "G", "g", "K", "k", "BT", "ET", "Tf", "Tm", "Tj", "Do"]);
  const tokens = content.replace(/\((?:\\.|[^\\)])*\)/g, " ").split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (/^-?[\d.]+$/.test(t) || t.startsWith("/") || t.startsWith("[") || t.endsWith("]")) continue;
    expect(ops.has(t), `operator ${t}`).toBe(true);
    if (t === "q") q++;
    if (t === "Q") q--;
    if (t === "BT") bt++;
    if (t === "ET") bt--;
    expect(q).toBeGreaterThanOrEqual(0);
  }
  expect(q).toBe(0);
  expect(bt).toBe(0);
}

function specsFor(m: Markup, opts: Parameters<typeof annotationSpecs>[2] = OPTS): AnnotationSpec[] {
  return annotationSpecs(m, sampleDocument().calibration, opts);
}

describe("native annotation specs (every type on the synthetic page)", () => {
  const doc = sampleDocument();

  it("covers every markup type", () => {
    const types = new Set(doc.markups.map((m) => m.type));
    expect([...types].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const m of doc.markups) {
    it(`${m.id} (${m.type})`, () => {
      const specs = specsFor(m);
      const root = specs[0]!;
      const want = EXPECTED[m.type];
      expect(nameOf(root.dict.Subtype)).toBe(want.subtype);
      expect(nameOf(root.dict.IT)).toBe(want.it);
      for (const s of specs) {
        const d = s.dict;
        // Common markup keys.
        expect(nameOf(d.Type)).toBe("Annot");
        for (const k of ["NM", "Subj", "T", "M", "CreationDate"]) expect(isTextValue(d[k]), k).toBe(true);
        expect(d.F).toBe(4);
        // /AP: the form box is the /Rect, the content is well formed.
        const rect = d.Rect as number[];
        expect(rect).toEqual(s.form.bbox);
        expect(rect[2]).toBeGreaterThan(rect[0]!);
        expect(rect[3]).toBeGreaterThan(rect[1]!);
        checkContent(s.form.content);
        expect(s.form.content.length).toBeGreaterThan(10);
        // /Rect contains the geometry.
        for (const [x, y] of geometryPoints(d)) {
          expect(x).toBeGreaterThanOrEqual(rect[0]! - 1e-6);
          expect(x).toBeLessThanOrEqual(rect[2]! + 1e-6);
          expect(y).toBeGreaterThanOrEqual(rect[1]! - 1e-6);
          expect(y).toBeLessThanOrEqual(rect[3]! + 1e-6);
        }
      }
      // Measurements.
      if (CALIBRATED_TYPES.has(m.type)) {
        const measure = root.dict.Measure;
        expect(isDictValue(measure)).toBe(true);
        const md = measure as PdfDictValue;
        expect(nameOf(md.Type)).toBe("Measure");
        expect(nameOf(md.Subtype)).toBe("RL");
        expect((md.R as { $text: string }).$text).toBe("1:100");
        for (const k of ["X", "D", "A"]) expect(Array.isArray(md[k]), k).toBe(true);
      } else {
        expect(root.dict.Measure).toBeUndefined();
      }
      if (MEASUREMENT_TYPES.has(m.type)) expect(isTextValue(root.dict.Contents)).toBe(true);
    });
  }

  it("writes stroke, interior colour, opacity and border style", () => {
    const ellipse = doc.markups.find((m) => m.type === "ellipse")!;
    const d = specsFor(ellipse)[0]!.dict;
    expect(d.C).toEqual([0, 0.55, 0.2]);
    expect(d.IC).toEqual([0.85, 1, 0.85]);
    expect(d.CA).toBe(0.8);
    expect(nameOf((d.BS as PdfDictValue).S)).toBe("S");
    expect(d.RD).toHaveLength(4);
    const rect = doc.markups.find((m) => m.type === "rectangle")!;
    const bs = specsFor(rect)[0]!.dict.BS as PdfDictValue;
    expect(nameOf(bs.S)).toBe("D");
    expect(bs.D).toEqual([4, 2]);
  });

  it("encodes arrows, dimensions, clouds, callouts and links with their specific keys", () => {
    const get = (t: MarkupType) => specsFor(doc.markups.find((m) => m.type === t)!);
    expect((get("arrow")[0]!.dict.LE as PdfValue[]).map(nameOf)).toEqual(["None", "ClosedArrow"]);
    const dim = get("dimension")[0]!.dict;
    expect(dim.LL).toBe(30);
    expect(dim.LLE).toBe(4);
    expect(dim.Cap).toBe(true);
    const cloud = get("cloud")[0]!.dict.BE as PdfDictValue;
    expect(nameOf(cloud.S)).toBe("C");
    expect(cloud.I).toBe(1);
    const callout = get("callout")[0]!.dict;
    expect(nums(callout.CL)).toHaveLength(6);
    expect(nameOf(callout.LE)).toBe("OpenArrow");
    expect((callout.DA as { $text: string }).$text).toMatch(/\/Helv 7 Tf/);
    const link = get("hyperlink")[0]!.dict;
    expect(nameOf((link.A as PdfDictValue).S)).toBe("URI");
    expect(link.C).toBeUndefined();
    const device = get("deviceStamp")[0]!.dict.PM_Device as PdfDictValue;
    expect(nameOf(device.Kind)).toBe("Sprinkler");
    expect(device.KFactor).toBe(80);
  });

  it("writes cloud+ as a cloud and a callout in one group", () => {
    const specs = get2("cloudPlus");
    expect(specs.map((s) => s.subtype)).toEqual(["Polygon", "FreeText"]);
    expect(specs[0]!.group).toBe(specs[1]!.group);
    expect(nameOf(specs[1]!.dict.IT)).toBe("FreeTextCallout");
    function get2(t: MarkupType) {
      return specsFor(doc.markups.find((m) => m.type === t)!);
    }
  });

  it("writes text markup quads in UL, UR, LL, LR order", () => {
    expect(quadPoints([[0, 0, 10, 5]])).toEqual([0, 5, 10, 5, 0, 0, 10, 0]);
  });

  it("formats PDF dates in UTC", () => {
    expect(pdfDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("D:20260102030405Z");
  });
});

describe("appearance-only and Revu-key variants", () => {
  const doc = sampleDocument();

  it("appearance-only keeps /AP, identity keys, layer and group, and drops type semantics", () => {
    for (const m of doc.markups) {
      for (const s of specsFor(m, { mode: "appearance-only", date: SAMPLE_DATE })) {
        expect(s.subtype).toBe(m.type === "hyperlink" ? "Link" : "Stamp");
        for (const k of ["L", "Vertices", "InkList", "QuadPoints", "Measure", "IT", "IC", "BS", "CL"]) expect(s.dict[k], `${m.id} ${k}`).toBeUndefined();
        expect(s.form.content.length).toBeGreaterThan(10);
        expect(s.layer).toBe(m.layer);
      }
    }
  });

  it("adds the observed Revu count keys and /BBMeasure only when asked", () => {
    const count = doc.markups.find((m) => m.type === "count")!;
    const plain = specsFor(count)[0]!.dict;
    expect(plain.IT).toBeUndefined();
    expect(plain.BBMeasure).toBeUndefined();
    const revu = specsFor(count, { ...OPTS, revuKeys: true })[0]!.dict;
    expect(nameOf(revu.IT)).toBe("PolygonCount");
    expect(revu.NumCounts).toBe(5);
    expect(revu.MeasurementTypes).toBe(REVU_COUNT_MEASUREMENT_TYPE);
    expect(isDictValue(revu.BBMeasure)).toBe(true);
    const line = specsFor(doc.markups.find((m) => m.type === "line")!, { ...OPTS, revuKeys: true })[0]!.dict;
    expect(line.BBMeasure).toBeUndefined();
  });
});

describe("writeAnnotations on the sample PDF", () => {
  async function written(mode: "native" | "appearance-only") {
    const pdf = await PDFDocument.load(readFileSync(SAMPLE));
    const model = sampleDocument();
    const result = writeAnnotations(pdf, model, { mode, date: SAMPLE_DATE });
    const reloaded = await PDFDocument.load(await pdf.save());
    return { result, reloaded, model };
  }

  it("wires /AP, /P, layers (OCGs in /OCProperties) and group linkage", async () => {
    const { result, reloaded, model } = await written("native");
    const page = reloaded.getPage(0);
    const annots = page.node.Annots()!;
    expect(annots.size()).toBe(result.specs.length);

    const props = reloaded.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
    const ocgs = props.lookup(PDFName.of("OCGs"), PDFArray);
    expect(ocgs.size()).toBe(model.layers.length);
    const d = props.lookup(PDFName.of("D"), PDFDict);
    expect(d.lookup(PDFName.of("Order"), PDFArray).size()).toBe(2);
    expect(d.lookup(PDFName.of("ON"), PDFArray).size()).toBe(2);
    const ocgNames = new Map<string, string>();
    for (let i = 0; i < ocgs.size(); i++) {
      const r = ocgs.get(i) as PDFRef;
      const g = reloaded.context.lookup(r, PDFDict);
      expect(g.lookup(PDFName.of("Type"))).toBe(PDFName.of("OCG"));
      ocgNames.set(r.toString(), g.lookup(PDFName.of("Name"))!.toString());
    }

    const byNm = new Map<string, { dict: PDFDict; ref: PDFRef }>();
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i) as PDFRef;
      const dict = reloaded.context.lookup(ref, PDFDict);
      const nm = dict.lookup(PDFName.of("NM"))!.toString().replace(/^\(|\)$/g, "");
      byNm.set(nm, { dict, ref });
      expect(dict.get(PDFName.of("P"))).toBeInstanceOf(PDFRef);
      const ap = dict.lookup(PDFName.of("AP"), PDFDict);
      const n = ap.lookup(PDFName.of("N"));
      expect(n).toBeInstanceOf(PDFStream);
      const content = new TextDecoder().decode(decodePDFRawStream(n as PDFRawStream).decode());
      checkContent(content);
    }

    for (const spec of result.specs) {
      const { dict } = byNm.get(spec.id)!;
      const oc = dict.get(PDFName.of("OC"));
      if (spec.layer) expect(ocgNames.has((oc as PDFRef).toString())).toBe(true);
      else expect(oc).toBeUndefined();
    }

    const root = byNm.get("pm-group-root")!;
    expect(root.dict.get(PDFName.of("IRT"))).toBeUndefined();
    for (const id of ["pm-group-ellipse", "pm-group-text"]) {
      const member = byNm.get(id)!.dict;
      expect(member.get(PDFName.of("IRT"))).toBe(root.ref);
      expect(member.get(PDFName.of("RT"))).toBe(PDFName.of("Group"));
    }
    const cloudRoot = byNm.get("pm-cloudplus")!;
    expect(byNm.get("pm-cloudplus-text")!.dict.get(PDFName.of("IRT"))).toBe(cloudRoot.ref);
  });

  it("appearance-only writes the same number of annotations", async () => {
    const { result, reloaded } = await written("appearance-only");
    expect(reloaded.getPage(0).node.Annots()!.size()).toBe(result.specs.length);
  });

  it("rejects a markup on an unknown layer", async () => {
    const pdf = await PDFDocument.load(readFileSync(SAMPLE));
    const model = sampleDocument();
    model.markups[0]!.layer = "nope";
    expect(() => writeAnnotations(pdf, model, OPTS)).toThrow(/unknown layer/);
  });

  it("merges layers into an existing /OCProperties", async () => {
    const pdf = await PDFDocument.load(readFileSync(SAMPLE));
    const model = sampleDocument();
    writeAnnotations(pdf, { ...model, markups: [] }, OPTS);
    writeAnnotations(pdf, { ...model, markups: [], layers: [{ id: "x", name: "Extra", visible: false }] }, OPTS);
    const props = pdf.catalog.lookup(PDFName.of("OCProperties"), PDFDict);
    expect(props.lookup(PDFName.of("OCGs"), PDFArray).size()).toBe(3);
    expect(props.lookup(PDFName.of("D"), PDFDict).lookup(PDFName.of("OFF"), PDFArray).size()).toBe(1);
  });
});
