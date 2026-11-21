// New blank drawing (founder 2026-11-21): a PDF of empty pages, ISO A1, A3 or
// A4, portrait or landscape, 1 to 200 pages. Framework-free.

import { PDFDocument } from "@cantoo/pdf-lib";

export const BLANK_SIZES = { A1: [594, 841], A3: [297, 420], A4: [210, 297] } as const;
export type BlankSize = keyof typeof BLANK_SIZES;
export type Orientation = "portrait" | "landscape";
export const MAX_BLANK_PAGES = 200;

export type BlankSpec = { size: BlankSize; orientation: Orientation; pages: number };

const PT_PER_MM = 72 / 25.4;

/** The page size in points [width, height]. */
export function blankPageSize(size: BlankSize, orientation: Orientation): [number, number] {
  const [short, long] = BLANK_SIZES[size].map((mm) => Math.round(mm * PT_PER_MM * 100) / 100);
  return orientation === "portrait" ? [short, long] : [long, short];
}

/** The page count kept: a whole number from 1 to MAX_BLANK_PAGES. */
export function blankPageCount(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_BLANK_PAGES, Math.max(1, Math.round(n))) : 1;
}

/** The blank PDF's bytes (its creation date makes each one a new drawing). */
export async function blankPdf(spec: BlankSpec, date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  doc.setTitle(blankName(spec, date).replace(/\.pdf$/, ""));
  const size = blankPageSize(spec.size, spec.orientation);
  for (let i = 0; i < blankPageCount(spec.pages); i++) doc.addPage(size);
  return doc.save({ useObjectStreams: false });
}

/** "Untitled A3 landscape 2026-11-21 1405.pdf". */
export function blankName(spec: BlankSpec, date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}${p(date.getMinutes())}`;
  return `Untitled ${spec.size} ${spec.orientation} ${stamp}.pdf`;
}
