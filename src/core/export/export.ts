// Export entry point (framework-free): base PDF bytes + markups → PDF bytes.
//   native           - editable annotations with appearance streams
//   appearance-only  - /Stamp annotations that carry only /AP
//   flattened        - native annotations drawn into the page content, then removed

import { PDFDocument, type PDFRef } from "@cantoo/pdf-lib";

import { addLayers, writeAnnotations } from "./annotations";
import type { ExportJob } from "./from-app";
import { flattenPage, type FlattenResult } from "./flatten";
import { embedFlattenRecord, removeFlatten, type AddedStreams, type FlattenRecord } from "./flatten-record";
import type { ExportDocument } from "./model";
import { addNotice } from "./notice";

export type ExportKind = "native" | "appearance-only" | "flattened";

export type ExportPdfOptions = {
  kind: ExportKind;
  /** Adds the Revu-observed measurement keys (native/flattened). */
  revuKeys?: boolean;
  date: Date;
  pageIndex?: number;
};

export type ExportPdfResult = { bytes: Uint8Array; annotations: number; flatten?: FlattenResult };

export async function exportPdf(base: Uint8Array, model: ExportDocument, options: ExportPdfOptions): Promise<ExportPdfResult> {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const pageIndex = options.pageIndex ?? 0;
  const written = writeAnnotations(doc, model, {
    mode: options.kind === "appearance-only" ? "appearance-only" : "native",
    revuKeys: options.revuKeys,
    date: options.date,
    pageIndex,
  });
  const flatten = options.kind === "flattened" ? flattenPage(doc, pageIndex) : undefined;
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes, annotations: written.refs.length, flatten };
}

/** `annotations` left editable; `flattened` drawn into the pages. */
export type ExportJobResult = { bytes: Uint8Array; annotations: number; flattened: number; pages: number };

/**
 * Story 8.1 (FR60): writes an export job (core/export/from-app.ts) onto the base PDF: each page's
 * markups as native annotations, the layers shared by all pages, then each page's covers
 * (white-out, eraser) flattened into it (A5). Story 8.2 (FR58, FR61): with `flatten`, every markup
 * written is drawn into its page instead (on its layer), none left as an annotation. The base's
 * own annotations are left as they are either way.
 */
export async function exportJobPdf(
  base: Uint8Array,
  job: ExportJob,
  date: Date,
  options: { flatten?: boolean; notice?: boolean; record?: FlattenRecord } = {},
): Promise<ExportJobResult> {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const ocgs = addLayers(doc, job.layers);
  let annotations = 0;
  let flattened = 0;
  let pages = 0;
  // Flatten in place: what the flatten adds is recorded, so Unflatten can take it out again.
  const record = options.flatten ? options.record : undefined;
  const added: AddedStreams[] = [];
  for (const page of job.pages) {
    if (page.pageIndex < 0 || page.pageIndex >= doc.getPageCount() || page.model.markups.length === 0) continue;
    const written = writeAnnotations(doc, page.model, { mode: "native", date, pageIndex: page.pageIndex, ocgs });
    annotations += written.refs.length;
    pages++;
    const covers = new Set(page.flatten);
    const refs = new Set(options.flatten ? written.refs : written.refs.filter((_, i) => covers.has(written.specs[i].markupId)));
    if (refs.size > 0) {
      const streams: PDFRef[] = [];
      flattenPage(doc, page.pageIndex, refs, record ? streams : undefined);
      if (streams.length > 0) added.push({ pageIndex: page.pageIndex, refs: streams });
      annotations -= refs.size;
      flattened += refs.size;
    }
  }
  // Story 9.12 (FR78): the advisory notice on every exported page, drawn in.
  if (options.notice) await addNotice(doc, job.pages.map((p) => p.pageIndex));
  if (record) embedFlattenRecord(doc, record, added);
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes, annotations, flattened, pages };
}

/** Unflatten: `base` without what a flatten in place added, and that flatten's record; null when it has none. */
export async function unflattenPdf(base: Uint8Array): Promise<{ bytes: Uint8Array; record: FlattenRecord } | null> {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const record = removeFlatten(doc);
  if (!record) return null;
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes, record };
}
