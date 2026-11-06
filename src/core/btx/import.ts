// Story 7.4 (FR42, NFR31): a parsed .btx tool set → one image per item, ready
// to become Tool Chest tools (framework-free; runs in the .btx worker).
//
// Every item is drawn the way Story 2.1 proved: its annotations (root and
// children at their -(X, Y) offsets, generated appearances where the file has
// none) on a one-page PDF the size of their bounds, rendered by pdf.js. The
// image keeps the item's paper size. An item that cannot be drawn is reported
// with its reason; the others still import. Faithful per-kind conversion
// (vector markups, counts, fonts) is Story 7.5.

import type { Box } from "./appearance";
import { getText } from "./pdf-object";
import type { BtxItem, BtxToolSet } from "./parse";
import { buildItemPdf } from "./to-pdf";

/** Render px per pt, and the longest side an item image may have. */
export const IMPORT_PX_PER_PT = 4;
export const IMPORT_MAX_SIDE_PX = 2048;
/** Paper size limits of one item (pt): A0's long side is about 3370 pt. */
export const IMPORT_MAX_SIDE_PT = 4000;

export const REASON_NOTHING = "Nothing to draw: the file has no appearance for it";
export const REASON_BLANK = "It draws nothing (its appearance is missing or empty)";
export const REASON_TOO_LARGE = "Too large to import as an image";
export const REASON_FAILED = "It could not be drawn";
export const REASON_UNREADABLE = "Unreadable in the file";

/** Draws a one-page PDF to a PNG `widthPx` × `heightPx` with a transparent background; null when nothing is drawn. */
export type ItemRenderer = (pdf: Uint8Array, size: { widthPx: number; heightPx: number; scale: number }) => Promise<Uint8Array | null>;

export type ImportedItem =
  | { name: string; ok: true; widthPt: number; heightPt: number; png: Uint8Array; warnings: string[] }
  | { name: string; ok: false; reason: string };

export type ImportedToolSet = { title: string; items: ImportedItem[]; warnings: string[] };

/** The name an item shows: its root's /Subj, else "Tool n". */
export function itemName(item: BtxItem, index: number): string {
  const subject = item.annotations[0] ? getText(item.annotations[0].dict, "Subj")?.trim() : undefined;
  return subject ? subject.slice(0, 100) : `Tool ${index + 1}`;
}

/** The px size and scale an item of `box` renders at. */
export function renderSize(box: Box, maxSidePx = IMPORT_MAX_SIDE_PX): { widthPx: number; heightPx: number; scale: number } {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const scale = Math.min(IMPORT_PX_PER_PT, maxSidePx / Math.max(w, h, 1e-6));
  return { widthPx: Math.max(1, Math.round(w * scale)), heightPx: Math.max(1, Math.round(h * scale)), scale };
}

/**
 * Each item of `set` drawn by `render`, in file order; items the parser
 * skipped come last as unreadable (their warning is the reason).
 */
export async function importItems(set: BtxToolSet, render: ItemRenderer, maxPngBytes: number): Promise<ImportedToolSet> {
  const items: ImportedItem[] = [];
  for (const [i, item] of set.items.entries()) {
    const name = itemName(item, i);
    try {
      const built = await buildItemPdf(item, { margin: 0 });
      if (built.annotations.length === 0) {
        items.push({ name, ok: false, reason: REASON_NOTHING });
        continue;
      }
      const box = built.pageBox;
      const widthPt = box[2] - box[0];
      const heightPt = box[3] - box[1];
      if (!(widthPt > 0 && heightPt > 0)) {
        items.push({ name, ok: false, reason: REASON_NOTHING });
        continue;
      }
      if (widthPt > IMPORT_MAX_SIDE_PT || heightPt > IMPORT_MAX_SIDE_PT) {
        items.push({ name, ok: false, reason: REASON_TOO_LARGE });
        continue;
      }
      const png = await render(built.bytes, renderSize(box));
      if (!png) items.push({ name, ok: false, reason: REASON_BLANK });
      else if (png.byteLength > maxPngBytes) items.push({ name, ok: false, reason: REASON_TOO_LARGE });
      else items.push({ name, ok: true, widthPt, heightPt, png, warnings: built.warnings });
    } catch {
      items.push({ name, ok: false, reason: REASON_FAILED });
    }
  }
  const warnings: string[] = [];
  for (const w of set.warnings) {
    if (w.endsWith("(item skipped)")) items.push({ name: w.replace(/:.*$/, ""), ok: false, reason: REASON_UNREADABLE });
    else warnings.push(w);
  }
  return { title: set.title.trim(), items, warnings };
}
