// Flatten in place and Unflatten (founder 2026-11-21). Framework-free.
//
// A drawing flattened in the app keeps what Unflatten needs inside the PDF, so
// it works after the PDF is saved and opened again: the catalog's
// /PlanMarkupFlatten names, per page, the content streams the flatten added
// (its `q` / `Q` wrap and its drawing), and holds the flattened markups as JSON
// (page indexes, not page ids: the unflattened PDF is another document), with
// the layers they are on and the pages' scales. Unflatten removes exactly those
// streams and the entry, and hands the record back; the page's own content and
// annotations are untouched either way.

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream, type PDFDocument } from "@cantoo/pdf-lib";
import { z } from "zod";

import { calibrationSchema, type Calibration } from "@/core/calibration/calibration";
import { layerListSchema, type Layer } from "@/core/schema/layer";
import { markupSchema, type Markup } from "@/core/schema/markup";

const KEY = PDFName.of("PlanMarkupFlatten");
const MAX_MARKUPS = 20_000;

const recordSchema = z.object({
  version: z.literal(1),
  markups: z.array(z.object({ pageIndex: z.number().int().min(0), markup: markupSchema })).max(MAX_MARKUPS),
  layers: layerListSchema,
  calibrations: z.array(z.object({ pageIndex: z.number().int().min(0), calibration: calibrationSchema })).max(10_000),
});

/** What Unflatten brings back: the flattened markups by page index, their layers and the pages' scales. */
export type FlattenRecord = {
  version: 1;
  markups: { pageIndex: number; markup: Markup }[];
  layers: Layer[];
  calibrations: { pageIndex: number; calibration: Calibration }[];
};

/** Content streams a flatten added to one page (flatten.ts flattenPage's `added`). */
export type AddedStreams = { pageIndex: number; refs: PDFRef[] };

/** Writes the record and the added streams into `doc`'s catalog (replacing an earlier one: a flatten over a flatten keeps only the last). */
export function embedFlattenRecord(doc: PDFDocument, record: FlattenRecord, added: readonly AddedStreams[]): void {
  const context = doc.context;
  const data = context.register(context.flateStream(JSON.stringify(record)));
  const pages = context.obj(added.map((a) => context.obj([PDFNumber.of(a.pageIndex), context.obj(a.refs)])));
  doc.catalog.set(KEY, context.obj({ Version: 1, Data: data, Pages: pages }));
}

/** The record in `doc`, or null when it has none (or it cannot be read). */
export function readFlattenRecord(doc: PDFDocument): FlattenRecord | null {
  const entry = doc.catalog.lookupMaybe(KEY, PDFDict);
  const stream = entry?.lookup(PDFName.of("Data"));
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    const text = new TextDecoder().decode(decodePDFRawStream(stream).decode());
    const parsed = recordSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as FlattenRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Takes the flatten out of `doc`: removes the streams it added from each page's
 * /Contents and the catalog entry. Returns the record, or null when `doc` was
 * not flattened in the app (then nothing is changed).
 */
export function removeFlatten(doc: PDFDocument): FlattenRecord | null {
  const record = readFlattenRecord(doc);
  const entry = doc.catalog.lookupMaybe(KEY, PDFDict);
  const pages = entry?.lookupMaybe(PDFName.of("Pages"), PDFArray);
  if (!record || !pages) return null;
  for (let i = 0; i < pages.size(); i++) {
    const item = pages.lookup(i);
    if (!(item instanceof PDFArray)) continue;
    const pageIndex = item.lookupMaybe(0, PDFNumber)?.asNumber();
    const refs = item.lookupMaybe(1, PDFArray);
    if (pageIndex === undefined || !refs || pageIndex < 0 || pageIndex >= doc.getPageCount()) continue;
    const added = refs.asArray().filter((r): r is PDFRef => r instanceof PDFRef);
    const keys = new Set(added.map((r) => r.toString()));
    const node = doc.getPage(pageIndex).node;
    const contents = node.get(PDFName.of("Contents"));
    if (contents instanceof PDFArray) {
      const kept = contents.asArray().filter((c) => !(c instanceof PDFRef && keys.has(c.toString())));
      node.set(PDFName.of("Contents"), doc.context.obj(kept));
    }
    for (const ref of added) doc.context.delete(ref);
  }
  doc.catalog.delete(KEY);
  return record;
}
