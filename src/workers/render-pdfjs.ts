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
import { textItemOf, type TextItem } from "@/core/search/page-text";
import { contentFlags, type OpsTable } from "@/core/render/content-flags";
import { operationsFilterFor, tileFraction, type OperationBoxes } from "@/core/render/op-culling";
import { RenderError, type ContentFlags, type PageInfo } from "./render-protocol";
import type { SnapOps } from "@/core/snap/extract";
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

/**
 * Long side (device px) of the canvas a page's operator boxes are recorded on
 * (op-culling.ts). The boxes are shares of the page in 1/256 steps, so the
 * recording does not need more; its cost is the operator list, not the pixels.
 */
const RECORD_PX = 1024;

type RecordingPage = PDFPageProxy & { recordedBBoxes?: OperationBoxes | null };

/** pdf.js 6.4.299 internals used to drop one intent's operator list (releaseOperatorList). */
type OpListInternals = {
  _transport?: { getRenderingIntent(intent: string, mode: number, storage: null, editing: boolean, opList: boolean): { cacheKey: string } };
  _intentStates?: Map<string, { renderTasks?: Set<unknown> }>;
};

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
  /**
   * Per page, its operators' boxes once a recording pass has completed
   * (op-culling.ts): tiles then run only the operators that can touch them.
   */
  private boxes = new Map<number, OperationBoxes>();
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
        const [x0, y0, x1, y1] = page.view;
        out.push({ width: vp.width, height: vp.height, rotate: page.rotate, view: [x0, y0, x1, y1], userUnit: page.userUnit });
      }
      if (this.task !== task) throw new RenderError("cancelled", "Superseded by another open or a close");
      this.doc = doc;
      this.pages = pages;
      this.boxes = new Map();
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
    const viewport = page.getViewport({ scale: job.scale });
    // A tile (not the whole page): run only the operators that can touch it.
    const whole = job.x <= 0 && job.y <= 0 && job.x + job.width >= Math.floor(viewport.width) && job.y + job.height >= Math.floor(viewport.height);
    const boxes = whole || job.content ? null : await this.operationBoxes(job.page, page, signal);
    const operationsFilter = boxes ? operationsFilterFor(boxes, tileFraction(job, viewport.width, viewport.height)) : undefined;
    const canvas = new OffscreenCanvas(job.width, job.height);
    // willReadFrequently forces a CPU (software) canvas. A GPU-backed worker canvas
    // sends every pdf.js path to the GPU process, which then starves the page's
    // compositor (measured: 1 fps during A0 tile renders). See the 2.3 report.
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error("No 2D context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, job.width, job.height);
    const task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      transform: [1, 0, 0, 1, -job.x, -job.y],
      // Existing annotations are drawn into the raster, read-only (A3); form
      // widgets are drawn as their appearance, never as live fields.
      annotationMode: AnnotationMode.ENABLE,
      background: "#ffffff",
      operationsFilter,
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

  /**
   * The page's operator boxes: recorded once by a whole-page pass on a small
   * canvas (pdf.js `recordOperations`; about one tile's cost), then kept. Null
   * when they cannot be recorded (the tile then runs every operator). A
   * cancelled pass rejects and leaves nothing behind, so the next tile records again.
   */
  private async operationBoxes(pageNo: number, page: PDFPageProxy, signal: AbortSignal): Promise<OperationBoxes | null> {
    const known = this.boxes.get(pageNo);
    if (known) return known;
    const recording = page as RecordingPage;
    const unit = page.getViewport({ scale: 1 });
    const scale = RECORD_PX / Math.max(unit.width, unit.height, 1);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!ctx) return null;
    // pdf.js records only when the page holds no boxes yet: drop any left by an unfinished pass.
    recording.recordedBBoxes = null;
    const task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      annotationMode: AnnotationMode.ENABLE,
      background: "#ffffff",
      recordOperations: true,
    });
    const onAbort = () => task.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal.aborted) task.cancel();
      await (this.parserFailed ? Promise.race([task.promise, this.parserFailed]) : task.promise);
    } catch (e) {
      // A cancelled or failed pass may leave partial boxes on the page (pdf.js keeps
      // what it recorded): never use them.
      recording.recordedBBoxes = null;
      if (signal.aborted) throw e;
      return null;
    } finally {
      signal.removeEventListener("abort", onAbort);
      canvas.width = canvas.height = 0;
    }
    const boxes = recording.recordedBBoxes ?? null;
    if (!boxes || this.pages.get(pageNo) !== page) return null;
    this.boxes.set(pageNo, boxes);
    return boxes;
  }

  /**
   * Story 4.1: the page's own content as an operator list for snapping. A
   * separate pdf.js intent (operator-list only, annotations off), never the
   * render's list: rendering turns each path into a Path2D, which cannot be read.
   */
  async operatorList(pageNo: number): Promise<{ fnArray: number[]; argsArray: unknown[]; ops: SnapOps; view: [number, number, number, number] }> {
    const page = this.pages.get(pageNo);
    if (!page) throw new RenderError("out-of-range", "Page not loaded");
    const list = await (this.parserFailed
      ? Promise.race([page.getOperatorList({ annotationMode: AnnotationMode.DISABLE }), this.parserFailed])
      : page.getOperatorList({ annotationMode: AnnotationMode.DISABLE }));
    const [x0, y0, x1, y1] = page.view;
    return { fnArray: list.fnArray, argsArray: list.argsArray, ops: OPS as unknown as SnapOps, view: [x0, y0, x1, y1] };
  }

  /**
   * Drops pdf.js's cached copy of the snapping operator list (tens of MB on an
   * A1 sheet) once the index is built. pdf.js has no public call for one
   * intent (cleanup() would also drop the render's list and its recorded
   * boxes), so this removes that intent's entry (pdf.js 6.4.299, pinned); if
   * the internals ever change it only keeps the memory.
   */
  releaseOperatorList(pageNo: number): void {
    const page = this.pages.get(pageNo) as (PDFPageProxy & OpListInternals) | undefined;
    try {
      const key = page?._transport?.getRenderingIntent("display", AnnotationMode.DISABLE, null, false, true)?.cacheKey;
      const state = key === undefined ? undefined : page?._intentStates?.get(key);
      if (state && (!state.renderTasks || state.renderTasks.size === 0)) page!._intentStates!.delete(key!);
    } catch {
      // Internals changed: nothing released.
    }
  }

  release(bitmap: ImageBitmap): void {
    bitmap.close();
  }

  async pageLabels(): Promise<(string | null)[] | null> {
    return this.doc ? this.doc.getPageLabels() : null;
  }

  /**
   * The page's text items in page space (pdf.js viewport at scale 1, /Rotate
   * applied) with their boxes (src/core/search/page-text.ts textItemOf). Empty
   * items are dropped; whitespace items are kept (they separate words).
   */
  async pageText(pageNo: number, signal: AbortSignal): Promise<TextItem[]> {
    const page = this.pages.get(pageNo);
    if (!page) throw new RenderError("out-of-range", "Page not loaded");
    const content = await (this.parserFailed ? Promise.race([page.getTextContent(), this.parserFailed]) : page.getTextContent());
    if (signal.aborted) return [];
    const viewport = page.getViewport({ scale: 1 });
    const toPage = (x: number, y: number) => viewport.convertToViewportPoint(x, y);
    const items: TextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      if (item.str === "") {
        // pdf.js marks line ends with empty items: the line break belongs to the item before.
        const last = items.at(-1);
        if (item.hasEOL && last) items[items.length - 1] = { ...last, eol: true };
        continue;
      }
      const style = content.styles[item.fontName] as { ascent?: number; descent?: number } | undefined;
      items.push(textItemOf(item, style ?? {}, toPage));
    }
    return items;
  }

  async close(): Promise<void> {
    this.pages = new Map();
    this.boxes = new Map();
    const task = this.task;
    this.task = null;
    this.doc = null;
    this.parserFailed = null;
    await task?.destroy().catch(() => undefined);
  }
}
