// Render worker protocol (Story 3.1, AR14). Shared by the worker
// (render.worker.ts) and the main thread (src/workers/rpc.ts, the viewer).
// Framework-free; imports nothing from the worker itself so the main thread can
// use the types and schemas without bundling pdf.js.
//
// Requests (main -> worker): { type: "render.<verb>", reqId, payload }
//   render.open     { bytes: ArrayBuffer }  The bytes are transferred (renderOpenMessage).
//                   -> result OpenResult (page sizes and page labels). A reopen of a cached file answers from the
//                   IndexedDB raster cache before pdf.js has parsed anything.
//   render.preview  { page, maxWidth, maxHeight, progressive? }  One whole-page tile
//                   scaled to fit maxWidth x maxHeight device px.
//                   -> progress { tile } snapshots while it renders (progressive),
//                   -> result PreviewResult (with the page's content flags).
//   render.tile     { page, bucket, scale, col, row, tileSize }  `scale` is device px
//                   per point. -> result TileResult.
//   render.thumbnail { page, widthPx, heightPx }  The whole page fitted into a
//                   widthPx x heightPx device-px box (/Rotate applied), cached in
//                   IndexedDB under <sha>:<page>:thumb:<w>x<h>. Runs after every
//                   queued open / preview / tile, and a running thumbnail yields
//                   (is re-queued) when one arrives. -> result ThumbnailResult.
//   render.sheetLabel { page }  The page's sheet number detected from its text near
//                   the title block (src/core/pdf/sheet-label.ts), cached per document.
//                   -> result { label: string | null }.
//   render.text     { page }  The page's text items (string, baseline run and quad in page
//                   space) and its normalised search text (src/core/search/page-text.ts).
//                   Read once per page and shared with render.sheetLabel; cached per
//                   document in memory and in IndexedDB (<sha>:<page>:text:v1). Same
//                   priority as render.sheetLabel (after tiles, before thumbnails).
//                   -> result TextResult (the index's typed arrays are transferred).
//   render.cancel   { reqIds?, all? }  Each cancelled request gets an error reply
//                   with code "cancelled"; the cancel itself gets result {}.
//   render.close    {}  Cancels everything and releases the document. -> result {}.
// Replies (worker -> main):
//   { type: "result", reqId, payload }   exactly one final reply per request:
//   { type: "error", reqId, code, error } either this or a result
//   { type: "progress", reqId, payload } zero or more before the final reply
// Bitmaps travel as transferables (no copies). `reqId` is null on an error reply
// to a message that had no usable reqId, and on a "worker-failed" reply (the
// worker could not start; the client treats it as fatal).
//
// Raster scales are quantised (src/core/render/tiles.ts scaleStep): the worker
// renders tiles and previews at quantizeScale(requested scale), never below it,
// and reports that scale in the reply.

import { z } from "zod";
import { MAX_BUCKET, MIN_BUCKET } from "@/core/render/tiles";
import type { ContentFlags as CoreContentFlags } from "@/core/render/content-flags";
import type { PageTextIndex, TextItem } from "@/core/search/page-text";
import type { SerializedWorkerError } from "@/core/worker/error";

/** Stable error codes of the render worker (the "code" pattern from Story 2.1). */
export const RENDER_ERROR_CODES = [
  "invalid-pdf",
  "password-required",
  "invalid-request",
  "no-document",
  "out-of-range",
  "cancelled",
  "render-failed",
  // The worker itself failed (start-up, an uncaught error): every pending request
  // rejects with it and the client starts a new worker on the next open.
  "worker-failed",
] as const;
export type RenderErrorCode = (typeof RENDER_ERROR_CODES)[number];

/** An error with a protocol code; anything else thrown becomes "render-failed". */
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

export function isRenderErrorCode(value: unknown): value is RenderErrorCode {
  return typeof value === "string" && (RENDER_ERROR_CODES as readonly string[]).includes(value);
}

/** Page size in points with the page's /Rotate applied (pdf.js viewport at scale 1). */
export type PageInfo = { width: number; height: number; rotate: number };

/**
 * What the page's operator list draws (src/core/render/content-flags.ts).
 * `imageOnly`: a scan, where snapping and scale detection cannot work (UX-DR31).
 */
export type ContentFlags = CoreContentFlags;

export type OpenResult = {
  sha256: string;
  pageCount: number;
  pages: PageInfo[];
  /**
   * Cleaned /PageLabels (src/core/pdf/sheet-label.ts cleanPageLabels), one per page;
   * null when the document has none or they are all just the page numbers.
   */
  pageLabels: string[] | null;
  /** True when the answer came from the raster cache (pdf.js still loads in the background). */
  fromCache: boolean;
};

export type TilePayload<B> = {
  page: number;
  /** Zoom bucket; null for the whole-page preview. */
  bucket: number | null;
  col: number;
  row: number;
  /** Device px per point of the bitmap. */
  scale: number;
  /** Device-pixel rectangle of the tile within the page at `scale`. */
  x: number;
  y: number;
  width: number;
  height: number;
  bitmap: B;
  fromCache: boolean;
  /** Time spent rendering, and waiting in the queue before that (ms). */
  renderMs: number;
  waitMs: number;
};

export type PreviewResult<B> = { tile: TilePayload<B>; content: ContentFlags | null };
export type PreviewProgress<B> = { tile: TilePayload<B> };
export type TileResult<B> = { tile: TilePayload<B> };
export type ThumbnailResult<B> = { tile: TilePayload<B> };

const reqId = z.number().finite();
const pageNumber = z.number().int().min(1);
const positive = z.number().finite().positive();
const index = z.number().int().min(0);

export const openPayloadSchema = z.object({
  bytes: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
});
export const previewPayloadSchema = z.object({
  page: pageNumber,
  maxWidth: positive.min(1).max(16384),
  maxHeight: positive.min(1).max(16384),
  progressive: z.boolean().optional(),
});
export const tilePayloadSchema = z.object({
  page: pageNumber,
  bucket: z.number().int().min(MIN_BUCKET).max(MAX_BUCKET),
  scale: positive.max(1000),
  col: index,
  row: index,
  tileSize: z.number().int().min(16).max(4096),
});
export const sheetLabelPayloadSchema = z.object({ page: pageNumber });
export const textPayloadSchema = z.object({ page: pageNumber });
/** Thumbnail box in device px (panel width steps x DPR). */
const thumbPx = z.number().int().min(16).max(2048);
export const thumbnailPayloadSchema = z.object({ page: pageNumber, widthPx: thumbPx, heightPx: thumbPx });
export const cancelPayloadSchema = z.object({
  reqIds: z.array(reqId).max(10_000).optional(),
  all: z.boolean().optional(),
});
export const closePayloadSchema = z.object({}).optional();

export const renderRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("render.open"), reqId, payload: openPayloadSchema }),
  z.object({ type: z.literal("render.preview"), reqId, payload: previewPayloadSchema }),
  z.object({ type: z.literal("render.tile"), reqId, payload: tilePayloadSchema }),
  z.object({ type: z.literal("render.sheetLabel"), reqId, payload: sheetLabelPayloadSchema }),
  z.object({ type: z.literal("render.text"), reqId, payload: textPayloadSchema }),
  z.object({ type: z.literal("render.thumbnail"), reqId, payload: thumbnailPayloadSchema }),
  z.object({ type: z.literal("render.cancel"), reqId, payload: cancelPayloadSchema }),
  z.object({ type: z.literal("render.close"), reqId, payload: closePayloadSchema }),
]);

export type RenderRequest = z.infer<typeof renderRequestSchema>;
export type RenderVerb = RenderRequest["type"];
export type OpenPayload = z.infer<typeof openPayloadSchema>;
export type PreviewPayload = z.infer<typeof previewPayloadSchema>;
export type TileRequestPayload = z.infer<typeof tilePayloadSchema>;
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;
export type SheetLabelPayload = z.infer<typeof sheetLabelPayloadSchema>;
export type SheetLabelResult = { label: string | null };
export type TextPayload = z.infer<typeof textPayloadSchema>;
/** A page's text: its items with their boxes, and the normalised text to search (src/core/search). */
export type TextResult = { items: TextItem[]; index: PageTextIndex };
export type ThumbnailPayload = z.infer<typeof thumbnailPayloadSchema>;

/** Result payload per verb. */
export type RenderResultMap<B> = {
  "render.open": OpenResult;
  "render.preview": PreviewResult<B>;
  "render.tile": TileResult<B>;
  "render.sheetLabel": SheetLabelResult;
  "render.text": TextResult;
  "render.thumbnail": ThumbnailResult<B>;
  "render.cancel": Record<string, never>;
  "render.close": Record<string, never>;
};
/** Request payload per verb (main-thread side). */
export type RenderPayloadMap = {
  "render.open": { bytes: ArrayBuffer };
  "render.preview": PreviewPayload;
  "render.tile": TileRequestPayload;
  "render.sheetLabel": SheetLabelPayload;
  "render.text": TextPayload;
  "render.thumbnail": ThumbnailPayload;
  "render.cancel": CancelPayload;
  "render.close": Record<string, never>;
};

export type RenderReply<B> =
  | { type: "result"; reqId: number; payload: unknown }
  | { type: "progress"; reqId: number; payload: PreviewProgress<B> }
  | { type: "error"; reqId: number | null; code: RenderErrorCode; error: SerializedWorkerError };

/** Main-thread helper: the open message and its transfer list (the bytes move, no copy). */
export function renderOpenMessage(reqId: number, bytes: ArrayBuffer): [RenderRequest, Transferable[]] {
  return [{ type: "render.open", reqId, payload: { bytes } }, [bytes]];
}
