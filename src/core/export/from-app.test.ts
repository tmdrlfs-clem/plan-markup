import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString, PDFHexString } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration as AppCalibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, markupSchema, type Markup as AppMarkup } from "@/core/schema/markup";

import { exportJobPdf } from "./export";
import { axisAligned, captionText, exportCalibration, exportJob, exportMarkup, legendText, rgbOf, type ConvertContext } from "./from-app";
import { measureValue } from "./measure";

const SHA = "a".repeat(64);
const P0 = `${SHA}:0`;
const P1 = `${SHA}:1`;
const cal: AppCalibration = { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100 };
const LAYER = "00000000-0000-7000-8000-00000000aaaa";
const HIDDEN = "00000000-0000-7000-8000-00000000bbbb";

let n = 0;
function mk(type: string, points: { x: number; y: number }[], extra: object = {}, pageId = P0): AppMarkup {
  const m = { id: `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`, pageId, createdAt: "2026-11-08T00:00:00Z", style: DEFAULT_MARKUP_STYLE, type, points, ...extra };
  expect(markupSchema.safeParse(m).success, type).toBe(true);
  return m as AppMarkup;
}
const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y1 },
  { x: x1, y: y1 },
  { x: x1, y: y0 },
  { x: x0, y: y0 },
];
const ctx = (over: Partial<ConvertContext> = {}): ConvertContext => ({ calibration: cal, userUnit: 1, author: "Kim Lee", images: new Map(), documentMarkups: [], ...over });

describe("app markups → export model (Story 8.1, FR60)", () => {
  it("a calibration as the page's /Measure: its unit per user unit and decimals; none measures in points", () => {
    const c = exportCalibration(cal, 1);
    expect(c).toMatchObject({ label: "1:100", unit: "mm", decimals: 0 });
    expect(c.unitsPerPoint).toBeCloseTo((25.4 / 72) * 100);
    expect(exportCalibration({ ...cal, unit: "m", precision: "0.00" }, 2).unitsPerPoint).toBeCloseTo(((25.4 / 72) * 100 * 2) / 1000);
    expect(exportCalibration(null, 1)).toMatchObject({ unit: "pt", unitsPerPoint: 1 });
    expect(rgbOf("#ff8000")).toEqual([1, 128 / 255, 0]);
  });

  it("measurements carry the caption the app shows (NFR8), also without a scale", () => {
    const length = mk("length", [
      { x: 0, y: 0 },
      { x: 72, y: 0 },
    ]);
    const out = exportMarkup(length, ctx())!;
    expect(out).toMatchObject({ type: "length", from: [0, 0], to: [72, 0], subject: "Length", author: "Kim Lee", color: [1, 0, 0] });
    expect(measureValue(out, exportCalibration(cal, 1))!.text).toBe(captionText(length, cal, 1));
    expect(captionText(length, cal, 1)).toBe("2540 mm");
    expect(exportMarkup(length, ctx({ calibration: null }))!.valueText).toBe("Scale not set");
    const count = mk("count", [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(exportMarkup(count, ctx())).toMatchObject({ type: "count", valueText: "2" });
    const dim = mk("dimension", [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 30, y: 20 }]);
    expect(exportMarkup(dim, ctx())).toMatchObject({ type: "dimension", leader: 20, valueText: "2540 mm" });
    expect(exportMarkup(mk("dimension", [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 30, y: -20 }]), ctx())).toMatchObject({ leader: -20 });
  });

  it("boxes: upright ones as rectangles, ellipses and text boxes; a turned one keeps its shape as a polygon", () => {
    const upright = box(10, 20, 110, 70);
    expect(axisAligned(upright)).toBe(true);
    expect(exportMarkup(mk("rectangle", upright), ctx())).toMatchObject({ type: "rectangle", rect: [10, 20, 110, 70] });
    const turned = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 20 }, { x: -10, y: 10 }];
    expect(exportMarkup(mk("rectangle", turned), ctx())).toMatchObject({ type: "polygon", points: [[0, 0], [10, 10], [0, 20], [-10, 10]] });
    expect(exportMarkup(mk("ellipse", turned), ctx())).toMatchObject({ type: "polygon" });
    expect(exportMarkup(mk("text", upright, { text: "Hi" }), ctx())).toMatchObject({ type: "textBox", rect: [10, 20, 110, 70], text: "Hi", fontSize: 10 });
    const tw = exportMarkup(mk("typewriter", upright, { text: "Hi" }), ctx())!;
    expect(tw).toMatchObject({ type: "typewriter", at: [10, 70] });
    expect(tw.color).toBeUndefined();
  });

  it("callouts and Cloud+ keep their leaders (tip or cloud first); covers are white and flattened", () => {
    const callout = exportMarkup(mk("callout", [...box(100, 100, 200, 140), { x: 20, y: 20 }], { text: "Note" }), ctx())!;
    expect(callout).toMatchObject({ type: "callout", textRect: [100, 100, 200, 140], leader: [[20, 20], [100, 120]] });
    const cloudPlus = exportMarkup(mk("cloudplus", [...box(0, 0, 50, 50), ...box(100, 100, 200, 140)], { text: "Fix" }), ctx())!;
    expect(cloudPlus).toMatchObject({ type: "cloudPlus", points: [[0, 50], [50, 50], [50, 0], [0, 0]], leader: [[50, 50], [100, 120]] });
    expect(exportMarkup(mk("whiteout", box(0, 0, 10, 10)), ctx())).toMatchObject({ type: "whiteout", fill: [1, 1, 1] });
    expect(exportMarkup(mk("eraser", [{ x: 0, y: 0 }, { x: 9, y: 9 }]), ctx())).toMatchObject({ type: "pen", color: [1, 1, 1] });
  });

  it("an image needs its decoded pixels; a revision stamp and a legend write the text they show", () => {
    const image = mk("image", box(0, 0, 20, 10), { src: "data:image/png;base64,iVBORw0KGgo=" });
    expect(exportMarkup(image, ctx())).toBeNull();
    const pixels = { width: 1, height: 1, rgb: new Uint8Array([0, 0, 0]), alpha: new Uint8Array([255]) };
    expect(exportMarkup(image, ctx({ images: new Map([[image.id, pixels]]) }))).toMatchObject({ type: "imageStamp", rect: [0, 0, 20, 10], image: pixels });
    const rev = mk("revision", box(0, 0, 180, 54), { revision: { rev: "C", description: "As-built", author: "Kim", date: "2026-11-08" } });
    expect(exportMarkup(rev, ctx())).toMatchObject({ type: "textBox", text: "Rev C · 2026-11-08\nAs-built\nKim" });
    const device = mk("ellipse", box(0, 0, 5, 5), { device: { group: "Sprinklers", label: "Pendant" } });
    const legend = mk("legend", box(300, 300, 400, 360), { legend: { title: "LEGEND", scope: "page" } });
    expect(exportMarkup(legend, ctx({ documentMarkups: [device, device, legend] }))).toMatchObject({ type: "textBox", text: "LEGEND (QTY)\nPendant: 2\nTotal: 2" });
    expect(legendText("LEGEND", [])).toBe("LEGEND (QTY)\nNo devices placed");
  });

  it("the job: the chosen pages only, markups on hidden layers left out unless chosen, covers to flatten", () => {
    const layers = [
      { id: LAYER, name: "Fire" },
      { id: HIDDEN, name: "Old", hidden: true },
    ];
    const onLayer = mk("line", [{ x: 0, y: 0 }, { x: 9, y: 9 }], { layerId: LAYER });
    const onHidden = mk("line", [{ x: 0, y: 0 }, { x: 9, y: 9 }], { layerId: HIDDEN });
    const cover = mk("whiteout", box(0, 0, 10, 10));
    const other = mk("line", [{ x: 0, y: 0 }, { x: 9, y: 9 }], {}, P1);
    const input = { markups: [onLayer, onHidden, cover, other], layers, pages: [{ pageIndex: 0, pageId: P0, calibration: cal, userUnit: 1 }], author: "Kim", images: new Map() };
    const job = exportJob({ ...input, includeHidden: false });
    expect(job.layers).toEqual([{ id: LAYER, name: "Fire", visible: true }]);
    expect(job.pages).toHaveLength(1);
    expect(job.pages[0].model.markups.map((m) => m.id)).toEqual([onLayer.id, cover.id]);
    expect(job.pages[0].flatten).toEqual([cover.id]);
    const all = exportJob({ ...input, includeHidden: true });
    expect(all.layers).toEqual([
      { id: LAYER, name: "Fire", visible: true },
      { id: HIDDEN, name: "Old", visible: false },
    ]);
    expect(all.pages[0].model.markups).toHaveLength(3);
  });

  it("writes a PDF: native annotations on each page, one set of layers, covers flattened into the page", async () => {
    const base = await PDFDocument.create();
    base.addPage([842, 595]);
    base.addPage([842, 595]);
    const bytes = await base.save();
    const layers = [{ id: LAYER, name: "Fire" }];
    const a = mk("length", [{ x: 100, y: 100 }, { x: 172, y: 100 }], { layerId: LAYER });
    const cover = mk("whiteout", box(200, 200, 260, 240));
    const b = mk("rectangle", box(50, 50, 150, 120), { layerId: LAYER }, P1);
    const job = exportJob({
      markups: [a, cover, b],
      layers,
      pages: [
        { pageIndex: 0, pageId: P0, calibration: cal, userUnit: 1 },
        { pageIndex: 1, pageId: P1, calibration: null, userUnit: 1 },
      ],
      author: "Kim",
      images: new Map(),
      includeHidden: false,
    });
    const out = await exportJobPdf(bytes, job, new Date("2026-11-08T00:00:00Z"));
    expect(out).toMatchObject({ annotations: 2, pages: 2 });
    const doc = await PDFDocument.load(out.bytes);
    const annots = (i: number) => doc.getPage(i).node.Annots();
    const nm = (d: PDFDict) => (d.lookup(PDFName.of("NM")) as PDFString | PDFHexString).decodeText();
    const first = annots(0)!;
    expect(first.size()).toBe(1);
    const length = first.lookup(0, PDFDict);
    expect(nm(length)).toBe(a.id);
    expect((length.lookup(PDFName.of("Contents")) as PDFString | PDFHexString).decodeText()).toBe("2540 mm");
    expect(nm(annots(1)!.lookup(0, PDFDict))).toBe(b.id);
    const ocgs = doc.catalog.lookup(PDFName.of("OCProperties"), PDFDict).lookup(PDFName.of("OCGs"), PDFArray);
    expect(ocgs.size()).toBe(1);
    // The cover is drawn into page 1's content (an XObject named FlatAp…).
    const xobjects = doc.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    expect(xobjects.keys().some((k) => k.asString().startsWith("/FlatAp"))).toBe(true);
  });
});
