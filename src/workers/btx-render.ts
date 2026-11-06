// Story 7.4: draws one .btx item's one-page PDF to a transparent PNG with
// pdf.js, inside the .btx worker (the same safety settings as the render
// worker: no eval, no scripting, annotations drawn into the raster only, the
// same-origin pdf.js assets). Each item gets its own document, destroyed after
// it is drawn; a draw that takes too long is cancelled.

import { AnnotationMode, getDocument } from "pdfjs-dist";

import type { ItemRenderer } from "@/core/btx/import";

import { NoFilterFactory, OffscreenCanvasFactory, ensureParserWorker, pdfjsAssetBase } from "./render-pdfjs";

/** One item's draw (open + render) is given up after this long. */
export const ITEM_RENDER_TIMEOUT_MS = 15_000;

type FontScope = { fonts?: unknown };

/** Whether any pixel of RGBA `data` is not fully transparent. */
export function drawsSomething(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
  return false;
}

/** A pdf.js renderer for the worker at `assetBase` (an absolute URL ending in "/"). */
export function pdfjsItemRenderer(assetBase: string): ItemRenderer {
  return async (pdf, size) => {
    const { failed } = ensureParserWorker(assetBase);
    const fontScope: FontScope = { fonts: (globalThis as FontScope).fonts };
    const task = getDocument({
      data: pdf,
      isEvalSupported: false,
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: NoFilterFactory,
      ownerDocument: fontScope as unknown as Document,
      isOffscreenCanvasSupported: true,
      useWorkerFetch: true,
      wasmUrl: `${assetBase}wasm/`,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      iccUrl: `${assetBase}iccs/`,
      enableXfa: false,
      verbosity: 0,
    } as Parameters<typeof getDocument>[0]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Item draw timed out")), ITEM_RENDER_TIMEOUT_MS);
    });
    try {
      const draw = (async () => {
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: size.scale });
        const canvas = new OffscreenCanvas(size.widthPx, size.heightPx);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("No 2D context");
        const job = page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
          annotationMode: AnnotationMode.ENABLE,
          background: "rgba(0,0,0,0)",
        });
        try {
          await job.promise;
        } catch (e) {
          job.cancel();
          throw e;
        }
        if (!drawsSomething(ctx.getImageData(0, 0, size.widthPx, size.heightPx).data)) return null;
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return new Uint8Array(await blob.arrayBuffer());
      })();
      return await Promise.race([draw, timeout, failed]);
    } finally {
      clearTimeout(timer);
      // Awaited: the next item's document must not start while pdf.js is still tearing this one down
      // (its parser worker port is shared: "PDFWorker.create - the worker is being destroyed").
      await task.destroy().catch(() => undefined);
    }
  };
}

/** The renderer for a worker served from `origin`. */
export function itemRendererFor(origin: string): ItemRenderer {
  return pdfjsItemRenderer(pdfjsAssetBase(origin));
}
