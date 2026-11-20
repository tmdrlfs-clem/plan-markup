import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { DEFAULT_MARKUP_STYLE, type Markup } from "@/core/schema/markup";

import { exportJobPdf, unflattenPdf } from "./export";
import { readFlattenRecord, type FlattenRecord } from "./flatten-record";
import { exportJob } from "./from-app";

const SHA = "a".repeat(64);
const P0 = `${SHA}:0`;
const cal: Calibration = { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100 };

const rect = (id: string): Markup =>
  ({
    id,
    pageId: P0,
    createdAt: "2026-11-21T00:00:00Z",
    style: DEFAULT_MARKUP_STYLE,
    type: "rectangle",
    points: [
      { x: 50, y: 120 },
      { x: 150, y: 120 },
      { x: 150, y: 50 },
      { x: 50, y: 50 },
    ],
  }) as Markup;

/** The page's content, decoded and joined. */
function pageText(doc: PDFDocument): string {
  const contents = doc.getPage(0).node.get(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs
    .map((r) => doc.context.lookup(r!))
    .map((s) => (s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : ""))
    .join("|");
}

async function base(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  page.drawText("SHEET", { x: 10, y: 10, size: 12 });
  return doc.save();
}

describe("flatten in place and Unflatten (founder 2026-11-21)", () => {
  it("a flatten with a record keeps what Unflatten needs; Unflatten takes the drawing out and hands the markups back", async () => {
    const original = await base();
    const markup = rect("00000000-0000-7000-8000-000000000001");
    const record: FlattenRecord = { version: 1, markups: [{ pageIndex: 0, markup }], layers: [], calibrations: [{ pageIndex: 0, calibration: cal }] };
    const job = exportJob({ markups: [markup], layers: [], pages: [{ pageIndex: 0, pageId: P0, calibration: cal, userUnit: 1 }], author: "Kim", images: new Map(), includeHidden: true });
    const flat = await exportJobPdf(original, job, new Date("2026-11-21T00:00:00Z"), { flatten: true, record });
    expect(flat).toMatchObject({ annotations: 0, flattened: 1 });

    const flatDoc = await PDFDocument.load(flat.bytes);
    expect(pageText(flatDoc)).toMatch(/FlatAp\S* Do/);
    expect(readFlattenRecord(flatDoc)).toEqual(record);

    const back = await unflattenPdf(flat.bytes);
    expect(back?.record).toEqual(record);
    const doc = await PDFDocument.load(back!.bytes);
    const text = pageText(doc);
    expect(text).not.toMatch(/FlatAp\S* Do/);
    // The sheet's own drawing stays.
    expect(text).toContain("Tj");
    expect(doc.catalog.lookupMaybe(PDFName.of("PlanMarkupFlatten"), PDFDict)).toBeUndefined();
    expect(readFlattenRecord(doc)).toBeNull();
  });

  it("a PDF not flattened in the app has nothing to unflatten; a download-only flatten records nothing", async () => {
    const original = await base();
    expect(await unflattenPdf(original)).toBeNull();
    const markup = rect("00000000-0000-7000-8000-000000000002");
    const job = exportJob({ markups: [markup], layers: [], pages: [{ pageIndex: 0, pageId: P0, calibration: null, userUnit: 1 }], author: "Kim", images: new Map(), includeHidden: true });
    const flat = await exportJobPdf(original, job, new Date("2026-11-21T00:00:00Z"), { flatten: true });
    expect(await unflattenPdf(flat.bytes)).toBeNull();
  });
});
