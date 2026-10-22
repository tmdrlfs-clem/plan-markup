// Export entry point (framework-free): base PDF bytes + markups → PDF bytes.
//   native           - editable annotations with appearance streams
//   appearance-only  - /Stamp annotations that carry only /AP
//   flattened        - native annotations drawn into the page content, then removed

import { PDFDocument } from "@cantoo/pdf-lib";

import { writeAnnotations } from "./annotations";
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
