// pdf.js tile renderer for the render worker (Story 2.3 spike). Runs inside our
// Web Worker: pdf.js draws onto an OffscreenCanvas, the result leaves as an
// ImageBitmap. No DOM: the canvas and filter factories below replace pdf.js's
// DOM ones, and fonts go through the worker's own FontFaceSet (self.fonts).
//
// Two pdf.js setups (measured in docs/spikes/2-3-render-report.md):
// - "inline": pdf.js's parser (pdf.worker.mjs) runs in this worker too, as
//   pdf.js's "fake worker" (globalThis.pdfjsWorker). One thread parses and draws.
// - "nested": pdf.js's parser runs in its own nested worker, loaded from
//   `${assetBase}build/pdf.worker.min.mjs`; parsing overlaps drawing.

import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import type { PageInfo, RendererOptions, TileJob, TileRenderer } from "./render.worker";

type CanvasAndContext = { canvas: OffscreenCanvas | null; context: OffscreenCanvasRenderingContext2D | null };

/** pdf.js CanvasFactory backed by OffscreenCanvas (pdf.js's default needs `document`). */
// pdf.js constructs it with { ownerDocument, enableHWA }; neither is needed here.
class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }
  reset(entry: CanvasAndContext, width: number, height: number): void {
    if (!entry.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    entry.canvas.width = width;
    entry.canvas.height = height;
  }
  destroy(entry: CanvasAndContext): void {
    if (!entry.canvas) throw new Error("Canvas is not specified");
    entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

/** pdf.js FilterFactory without SVG filters (pdf.js's base behaviour; the DOM one needs `document`). */
class NoFilterFactory {
  addFilter(): string { return "none"; }
  addHCMFilter(): string { return "none"; }
  addAlphaFilter(): string { return "none"; }
  addLuminosityFilter(): string { return "none"; }
  addKnockoutFilter(): string { return "none"; }
  addHighlightHCMFilter(): string { return "none"; }
  addSelectionHCMFilter(): string { return "none"; }
  addSelectionFilter(): string { return "none"; }
  createSelectionStyle(): null { return null; }
  destroy(): void {}
}

type FontScope = { fonts?: unknown };

/** Progressive preview snapshots: first after this long, then at this interval (ms). */
const PARTIAL_FIRST_MS = 300;
const PARTIAL_EVERY_MS = 500;

let setupMode: "inline" | "nested" | null = null;

/** Configures pdf.js's own worker once per realm (it cannot be switched afterwards). */
async function setupPdfjsWorker(mode: "inline" | "nested", assetBase: string): Promise<void> {
  if (setupMode) {
    if (setupMode !== mode) throw new Error(`pdf.js worker already set up as "${setupMode}"`);
    return;
  }
  if (mode === "inline") {
    const parser = await import("pdfjs-dist/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = parser;
  } else {
    GlobalWorkerOptions.workerPort = new Worker(`${assetBase}build/pdf.worker.min.mjs`, { type: "module" });
  }
  setupMode = mode;
}

export class PdfjsTileRenderer implements TileRenderer<ImageBitmap> {
  private task: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private readonly pages = new Map<number, PDFPageProxy>();

  /** `assetBase` is an absolute URL ending in "/" that serves pdf.js's wasm, fonts, cmaps, iccs and build/. */
  constructor(private readonly assetBase: string) {}

  async open(bytes: Uint8Array, options: RendererOptions): Promise<PageInfo[]> {
    await setupPdfjsWorker(options.pdfjsWorker ?? "inline", this.assetBase);
    const fontScope: FontScope = { fonts: (globalThis as FontScope).fonts };
    this.task = getDocument({
      data: bytes,
      isEvalSupported: false,
      // Our factories: pdf.js's defaults create DOM canvases and SVG filters.
      CanvasFactory: OffscreenCanvasFactory,
      FilterFactory: NoFilterFactory,
      // The FontLoader only touches `ownerDocument.fonts`; workers have their own FontFaceSet.
      ownerDocument: fontScope as unknown as Document,
      isOffscreenCanvasSupported: true,
      // Explicit, so pdf.js does not read document.baseURI to decide; its parser fetches these.
      useWorkerFetch: true,
      wasmUrl: `${this.assetBase}wasm/`,
      standardFontDataUrl: `${this.assetBase}standard_fonts/`,
      cMapUrl: `${this.assetBase}cmaps/`,
      cMapPacked: true,
      iccUrl: `${this.assetBase}iccs/`,
      verbosity: 0,
    } as Parameters<typeof getDocument>[0]);
    this.doc = await this.task.promise;
    const out: PageInfo[] = [];
    for (let i = 1; i <= this.doc.numPages; i++) {
      const page = await this.doc.getPage(i);
      this.pages.set(i, page);
      const vp = page.getViewport({ scale: 1 });
      out.push({ width: vp.width, height: vp.height });
    }
    return out;
  }

  async render(job: TileJob, signal: AbortSignal, onPartial?: (bitmap: ImageBitmap) => void): Promise<ImageBitmap> {
    const page = this.pages.get(job.page);
    if (!page) throw new RangeError("page not loaded");
    const canvas = new OffscreenCanvas(job.width, job.height);
    // willReadFrequently forces a CPU (software) canvas. A GPU-backed worker canvas
    // sends every pdf.js path to the GPU process, which then starves the page's
    // compositor (measured: 1 fps during A0 tile renders). See the spike report.
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error("No 2D context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, job.width, job.height);
    const viewport = page.getViewport({ scale: job.scale });
    const task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      transform: [1, 0, 0, 1, -job.x, -job.y],
      annotationMode: AnnotationMode.ENABLE,
      background: "#ffffff",
    });
    if (onPartial) {
      // pdf.js calls onContinue between execution slices: snapshot the canvas
      // now and then so a slow page shows up progressively.
      let next = performance.now() + PARTIAL_FIRST_MS;
      task.onContinue = (cont: () => void) => {
        const now = performance.now();
        if (now >= next) {
          next = now + PARTIAL_EVERY_MS;
          void createImageBitmap(canvas).then(onPartial, () => undefined);
        }
        cont();
      };
    }
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal.aborted) task.cancel();
      await task.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    return canvas.transferToImageBitmap();
  }

  release(bitmap: ImageBitmap): void {
    bitmap.close();
  }

  async close(): Promise<void> {
    this.pages.clear();
    const task = this.task;
    this.task = null;
    this.doc = null;
    await task?.destroy();
  }
}
