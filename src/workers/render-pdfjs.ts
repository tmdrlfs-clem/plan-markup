// pdf.js tile renderer for the render worker (Story 3.1, from the Story 2.3
// spike). Runs inside our Web Worker: pdf.js draws onto an OffscreenCanvas and
// the result leaves as an ImageBitmap. No DOM: the canvas and filter factories
// below replace pdf.js's DOM ones, and fonts go through the worker's own
// FontFaceSet (self.fonts).
//
// pdf.js's parser (pdf.worker.min.mjs) runs in its own nested worker loaded
// from the same-origin static copy in public/pdfjs/<version>/ (2.3 report:
// parsing overlaps drawing, 1.35-1.7 s vs 3.4 s first frame on L17). That
// response carries its own narrow CSP (PDFJS_WORKER_CSP, ADR 0005).
//
// Safety (AR27, NFR30): isEvalSupported is off, no scripting is ever set up
// (pdf.sandbox and the quickjs wasm are not shipped), no annotation layer is
// built (annotations are drawn into the raster only, so nothing is clickable
// and no link or action is ever followed), and forms are not rendered as widgets.

import {
  AnnotationMode,
  GlobalWorkerOptions,
  OPS,
  getDocument,
  version as pdfjsVersion,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import { contentFlags, type OpsTable } from "@/core/render/content-flags";
import { RenderError, type ContentFlags, type PageInfo } from "./render-protocol";
import type { RenderedTile, TileJob, TileRenderer } from "./render.worker";

/** Absolute URL (ending in "/") of the same-origin pdf.js assets for this pdf.js version. */
export function pdfjsAssetBase(origin: string): string {
  return `${origin}/pdfjs/${pdfjsVersion}/`;
}

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

/** The live parser worker and a promise that rejects when it fails. */
export type ParserSlot = { worker: Worker; failed: Promise<never> };

type ParserWorkerLike = Pick<Worker, "addEventListener" | "terminate">;

let parser: ParserSlot | null = null;

/**
 * Starts pdf.js's parser worker (once per realm: pdf.js keeps using the same
 * port). If it fails (an `error` event: it could not load, or crashed), it is
 * terminated, `failed` rejects so the current task fails instead of hanging,
 * and the next call starts a new worker on a fresh port.
 */
export function ensureParserWorker(
  assetBase: string,
  create: (url: string) => ParserWorkerLike = (url) => new Worker(url, { type: "module" }),
  setPort: (port: Worker | null) => void = (port) => {
    GlobalWorkerOptions.workerPort = port;
  },
): ParserSlot {
  if (parser) return parser;
  const worker = create(`${assetBase}build/pdf.worker.min.mjs`) as Worker;
  let fail!: (e: RenderError) => void;
  const failed = new Promise<never>((_, reject) => (fail = reject));
  failed.catch(() => undefined); // observed by the tasks that race it
  const slot: ParserSlot = { worker, failed };
  worker.addEventListener("error", () => {
    if (parser !== slot) return;
    parser = null;
    setPort(null);
    worker.terminate();
    fail(new RenderError("render-failed", "The PDF parser worker failed"));
  });
  parser = slot;
  setPort(worker);
  return slot;
}

/** Maps pdf.js open failures to protocol codes. */
export function openError(e: unknown): RenderError {
  const name = e instanceof Error ? e.name : "";
  if (name === "PasswordException") {
    return new RenderError("password-required", "The PDF is password-protected");
  }
  return new RenderError("invalid-pdf", "The file is not a valid PDF");
}

type RenderTaskInternals = { _internalRenderTask?: { operatorList?: { fnArray?: number[]; argsArray?: unknown[] } } };

/**
 * Content flags from the operator list pdf.js just executed. The list is only
 * reachable through RenderTask's internal task (pdf.js 6.4.299, pinned); a
 * separate getOperatorList() call would parse the page a second time. Returns
 * null if the internals ever change, which only hides the image-only hint.
 */
function flagsOf(task: unknown): ContentFlags | null {
  const list = (task as RenderTaskInternals)._internalRenderTask?.operatorList;
  if (!list || !Array.isArray(list.fnArray) || !Array.isArray(list.argsArray)) return null;
  return contentFlags(list.fnArray, list.argsArray, OPS as unknown as OpsTable);
}

export class PdfjsTileRenderer implements TileRenderer<ImageBitmap> {
  private task: PDFDocumentLoadingTask | null = null;
  private doc: PDFDocumentProxy | null = null;
  private pages = new Map<number, PDFPageProxy>();
  /** Rejects when the parser worker of the open document fails. */
  private parserFailed: Promise<never> | null = null;

  /** `assetBase` is an absolute URL ending in "/" (pdfjsAssetBase). */
  constructor(private readonly assetBase: string) {}

  async open(bytes: Uint8Array): Promise<PageInfo[]> {
    const { failed } = ensureParserWorker(this.assetBase);
    const fontScope: FontScope = { fonts: (globalThis as FontScope).fonts };
    const task = getDocument({
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
      enableXfa: false,
      verbosity: 0,
    } as Parameters<typeof getDocument>[0]);
    this.task = task;
    this.parserFailed = failed;
    try {
      // Local state only until the end: a close() or newer open() may run meanwhile.
      const doc = await Promise.race([task.promise, failed]);
      const pages = new Map<number, PDFPageProxy>();
      const out: PageInfo[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await Promise.race([doc.getPage(i), failed]);
        pages.set(i, page);
        const vp = page.getViewport({ scale: 1 });
        out.push({ width: vp.width, height: vp.height, rotate: page.rotate });
      }
      if (this.task !== task) throw new RenderError("cancelled", "Superseded by another open or a close");
      this.doc = doc;
      this.pages = pages;
      return out;
    } catch (e) {
      if (this.task === task) await this.close();
      else void task.destroy().catch(() => undefined);
      if (e instanceof RenderError) throw e;
      throw openError(e);
    }
  }

  async render(job: TileJob, signal: AbortSignal, onPartial?: (bitmap: ImageBitmap) => void): Promise<RenderedTile<ImageBitmap>> {
    const page = this.pages.get(job.page);
    if (!page) throw new RenderError("out-of-range", "Page not loaded");
    const canvas = new OffscreenCanvas(job.width, job.height);
    // willReadFrequently forces a CPU (software) canvas. A GPU-backed worker canvas
    // sends every pdf.js path to the GPU process, which then starves the page's
    // compositor (measured: 1 fps during A0 tile renders). See the 2.3 report.
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
      // Existing annotations are drawn into the raster, read-only (A3); form
      // widgets are drawn as their appearance, never as live fields.
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
      await (this.parserFailed ? Promise.race([task.promise, this.parserFailed]) : task.promise);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    const content = job.content ? flagsOf(task) : undefined;
    // convertToBlob copies the pixels synchronously, so the canvas can be handed over next.
    const encoded = job.encode ? canvas.convertToBlob({ type: "image/png" }) : null;
    return { bitmap: canvas.transferToImageBitmap(), encoded, content };
  }

  release(bitmap: ImageBitmap): void {
    bitmap.close();
  }

  async close(): Promise<void> {
    this.pages = new Map();
    const task = this.task;
    this.task = null;
    this.doc = null;
    this.parserFailed = null;
    await task?.destroy().catch(() => undefined);
  }
}
