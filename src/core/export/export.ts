// Export entry point (framework-free): base PDF bytes + markups → PDF bytes.
//   native           - editable annotations with appearance streams
//   appearance-only  - /Stamp annotations that carry only /AP
//   flattened        - native annotations drawn into the page content, then removed

import { PDFDocument } from "@cantoo/pdf-lib";

import { addLayers, writeAnnotations } from "./annotations";
import type { ExportJob } from "./from-app";
import { flattenPage, type FlattenResult } from "./flatten";
import type { ExportDocument } from "./model";

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

export type ExportJobResult = { bytes: Uint8Array; annotations: number; pages: number };

/**
 * Story 8.1 (FR60): writes an export job (core/export/from-app.ts) onto the base PDF: each page's
 * markups as native annotations, the layers shared by all pages, then each page's covers
 * (white-out, eraser) flattened into it (A5). The base's own annotations are left as they are.
 */
export async function exportJobPdf(base: Uint8Array, job: ExportJob, date: Date): Promise<ExportJobResult> {
  const doc = await PDFDocument.load(base, { updateMetadata: false });
  const ocgs = addLayers(doc, job.layers);
  let annotations = 0;
  let pages = 0;
  for (const page of job.pages) {
    if (page.pageIndex < 0 || page.pageIndex >= doc.getPageCount() || page.model.markups.length === 0) continue;
    const written = writeAnnotations(doc, page.model, { mode: "native", date, pageIndex: page.pageIndex, ocgs });
    annotations += written.refs.length;
    pages++;
    if (page.flatten.length > 0) {
      const covers = new Set(page.flatten);
      const refs = new Set(written.refs.filter((_, i) => covers.has(written.specs[i].markupId)));
      flattenPage(doc, page.pageIndex, refs);
      annotations -= refs.size;
    }
  }
  const bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  return { bytes, annotations, pages };
}
