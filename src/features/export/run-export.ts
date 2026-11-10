// Story 8.1 (FR60, AR25): File → Export → Editable PDF. The open drawing's
// markups on the chosen pages (those on hidden layers only when chosen) are
// converted on the main thread (core/export/from-app.ts: the app's captions,
// decoded images), then the export worker writes them onto the original PDF
// with pdf-lib; the result downloads under the drawing's own file name. The
// original file and the markup set are not changed.
//
// Story 8.2 (FR58, FR61): Flatten (Ctrl+Shift+M) or File → Export → Flattened
// PDF writes the same markups drawn into the pages instead, as a new file
// ("… (flattened).pdf"); the markups in the app stay editable.
//
// Story 8.3 (FR68): Print (Ctrl+P) builds a print PDF the same way (markups
// drawn in, or none), laid on the chosen paper at fit or actual size
// (core/export/print.ts), and prints it from a hidden frame through the
// browser's PDF viewer, so actual size measures right on paper.
//
// Story 8.4 (FR80): a completed export or print is recorded as an activity
// event (markup.exported / drawing.printed): the kind, the page and markup
// counts and the user's markup set, never the file name or content.

import type { ActivityEvent } from "@/core/activity/activity-event";
import { pageIdOf } from "@/core/calibration/calibration";
import { exportJob, type DecodedImage, type ExportJob } from "@/core/export/from-app";
import type { Paper, PrintOptions, PrintScale } from "@/core/export/print";
import type { Markup } from "@/core/schema/markup";
import { recordActivity } from "@/features/activity/actions";
import { editorStore, layersOf, markupsOf } from "@/features/editor";
import { markupSetIdOf } from "@/features/markup-set/sync";
import { viewerStore } from "@/features/viewer";
import type { ExportWorkerReply } from "@/workers/export.worker";

/** An export longer than this is given up (a fresh worker each time). */
export const EXPORT_TIMEOUT_MS = 120_000;
export const NO_DRAWING = "Open a drawing to export it.";
export const STAND_IN = "Open this markup set's PDF to export it (blank pages stand in for it now).";
export const EXPORT_FAILED = "The PDF could not be written.";

let author = "";

/** The signed-in user's name, written as each annotation's author (the workspace sets it). */
export function setExportAuthor(name: string): void {
  author = name;
}

/** Story 8.2: editable annotations, or markups drawn into the pages. */
export type ExportKind = "editable" | "flattened";
/** Story 9.12: `notice` draws the advisory notice onto each exported page. */
export type ExportChoice = { kind?: ExportKind; pages: readonly number[]; includeHidden: boolean; notice?: boolean };
export type WriteResult = { bytes: Uint8Array; annotations: number; flattened: number; pages: number };
export type ExportOutcome = ({ ok: true; name: string } & Omit<WriteResult, "bytes">) | { ok: false; reason: string };

export type ExportDeps = {
  decode: (src: string) => Promise<DecodedImage | null>;
  write: (bytes: Uint8Array, job: ExportJob, date: Date, flatten: boolean, notice?: boolean) => Promise<WriteResult | null>;
  save: (name: string, bytes: Uint8Array) => void;
  /** Story 8.4: records the completed action (never awaited; never fails the export). */
  record?: (event: ReportedEvent) => void;
};

/** Story 8.4: what is reported of a completed export or print; the markup set is added on the way. */
export type ReportedEvent = Omit<ActivityEvent, "drawingId">;

/** Story 8.4 (FR80): records the event with the user's markup set for the shown file (fire and forget). */
function reportActivity(event: ReportedEvent): void {
  const documentId = viewerStore.getState().documentId;
  void (async () => {
    const drawingId = documentId ? await markupSetIdOf(documentId) : null;
    await recordActivity({ ...event, drawingId });
  })().catch(() => undefined);
}

/** Whether the shown drawing can be exported now (null), else why not. */
export function exportBlocked(): string | null {
  const v = viewerStore.getState();
  if (!v.file || !v.documentId || v.pageCount === 0 || v.status === "error") return NO_DRAWING;
  if (v.standIn) return STAND_IN;
  return null;
}

/** The drawing's file and the job for `choice` (images decoded), or why not. */
async function prepare(choice: Pick<ExportChoice, "pages" | "includeHidden">, decode: ExportDeps["decode"]): Promise<{ ok: true; file: File; bytes: Uint8Array; job: ExportJob } | { ok: false; reason: string }> {
  const blocked = exportBlocked();
  if (blocked) return { ok: false, reason: blocked };
  const v = viewerStore.getState();
  const file = v.file!;
  const documentId = v.documentId!;
  const state = editorStore.getState();
  // Story 9.2: zones are design data, never exported or printed.
  const markups = markupsOf(state, documentId).filter((m) => m.type !== "zone");
  const pages = choice.pages
    .filter((i) => i >= 0 && i < v.pageCount)
    .map((i) => {
      const pageId = pageIdOf(documentId, i);
      const u = v.pages[i]?.userUnit;
      return { pageIndex: i, pageId, calibration: v.calibrations[pageId] ?? null, userUnit: u && u > 0 ? u : 1 };
    });
  const chosen = new Set(pages.map((p) => p.pageId));
  const images = new Map<string, DecodedImage>();
  for (const m of markups) {
    if (m.type !== "image" || !chosen.has(m.pageId)) continue;
    const decoded = await decode(m.src).catch(() => null);
    if (decoded) images.set(m.id, decoded);
  }
  const job = exportJob({ markups, layers: layersOf(state, documentId), pages, author, images, includeHidden: choice.includeHidden });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "The drawing's file could not be read again." };
  }
  return { ok: true, file, bytes, job };
}

/** Exports the open drawing (see the header); never throws. */
export async function runExport(choice: ExportChoice, deps: ExportDeps = browserDeps): Promise<ExportOutcome> {
  const ready = await prepare(choice, deps.decode);
  if (!ready.ok) return ready;
  const { file, bytes, job } = ready;
  const flatten = choice.kind === "flattened";
  const out = await deps.write(bytes, job, new Date(), flatten, choice.notice === true).catch(() => null);
  if (!out) return { ok: false, reason: EXPORT_FAILED };
  const name = exportName(file.name, choice.kind);
  deps.save(name, out.bytes);
  deps.record?.({ name: "markup.exported", kind: flatten ? "flattened" : "editable", pageCount: choice.pages.length, markupCount: out.annotations + out.flattened });
  return { ok: true, name, annotations: out.annotations, flattened: out.flattened, pages: out.pages };
}

/** Story 8.3: what to print. */
export type PrintChoice = { pages: readonly number[]; includeHidden: boolean; markups: boolean; paper: Paper; scale: PrintScale };
export type PrintOutcome = { ok: true; sheets: number; clipped: number } | { ok: false; reason: string };
export type PrintDeps = {
  decode: ExportDeps["decode"];
  build: (bytes: Uint8Array, job: ExportJob | null, date: Date, options: PrintOptions) => Promise<{ bytes: Uint8Array; sheets: number; clipped: number } | null>;
  print: (bytes: Uint8Array) => Promise<boolean>;
  record?: ExportDeps["record"];
};
export const PRINT_FAILED = "The print file could not be made.";
export const PRINT_BLOCKED = "The browser did not open its print dialog.";

/** Prints the open drawing (see the header); never throws. */
export async function runPrint(choice: PrintChoice, deps: PrintDeps = printDeps): Promise<PrintOutcome> {
  const ready = await prepare(choice, deps.decode);
  if (!ready.ok) return ready;
  // Markups on hidden layers that were chosen print too: their layers start shown.
  const job = choice.markups ? { ...ready.job, layers: ready.job.layers.map((l) => ({ ...l, visible: true })), pages: ready.job.pages.map((p) => ({ ...p, model: { ...p.model, layers: p.model.layers.map((l) => ({ ...l, visible: true })) } })) } : null;
  const out = await deps.build(ready.bytes, job, new Date(), { pages: choice.pages, paper: choice.paper, scale: choice.scale }).catch(() => null);
  if (!out || out.sheets === 0) return { ok: false, reason: PRINT_FAILED };
  if (!(await deps.print(out.bytes).catch(() => false))) return { ok: false, reason: PRINT_BLOCKED };
  const markupCount = job ? job.pages.reduce((n, p) => n + p.model.markups.length, 0) : 0;
  deps.record?.({ name: "drawing.printed", kind: job ? "with_markups" : "without_markups", pageCount: out.sheets, markupCount });
  return { ok: true, sheets: out.sheets, clipped: out.clipped };
}

/** The exported file's name: the drawing's own (a .pdf); Story 8.2: "… (flattened).pdf" when flattened. */
export function exportName(fileName: string, kind: ExportKind = "editable"): string {
  const stem = fileName.replace(/\.pdf$/i, "").trim() || "drawing";
  return kind === "flattened" ? `${stem} (flattened).pdf` : `${stem}.pdf`;
}

/** The markups an export of `choice` would write (the dialog's count). */
export function exportCount(choice: ExportChoice): number {
  const v = viewerStore.getState();
  if (!v.documentId) return 0;
  const state = editorStore.getState();
  const hidden = new Set(layersOf(state, v.documentId).filter((l) => l.hidden).map((l) => l.id));
  const pages = new Set(choice.pages.map((i) => pageIdOf(v.documentId!, i)));
  return markupsOf(state, v.documentId).filter((m: Markup) => m.type !== "zone" && pages.has(m.pageId) && (choice.includeHidden || !m.layerId || !hidden.has(m.layerId))).length;
}

/** An image markup's pixels: 8-bit RGB, and alpha when any pixel is not opaque. */
async function decodeImage(src: string): Promise<DecodedImage | null> {
  const comma = src.indexOf(",");
  const type = /^data:([^;]+);base64$/.exec(src.slice(0, comma))?.[1];
  if (comma < 0 || !type) return null;
  const binary = atob(src.slice(comma + 1));
  const raw = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([raw], { type }));
  const { width, height } = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = c.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let opaque = true;
  for (let i = 0, j = 0, k = 0; i < data.length; i += 4, j += 3, k++) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
    alpha[k] = data[i + 3];
    if (data[i + 3] !== 255) opaque = false;
  }
  return opaque ? { width, height, rgb } : { width, height, rgb, alpha };
}

/** Sends one request to a fresh export worker (ended after the reply, or after EXPORT_TIMEOUT_MS). */
function inWorker(message: object, bytes: Uint8Array): Promise<ExportWorkerReply | null> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../../workers/export.worker.ts", import.meta.url), { type: "module" });
    const done = (value: ExportWorkerReply | null) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), EXPORT_TIMEOUT_MS);
    worker.addEventListener("message", (event: MessageEvent<ExportWorkerReply>) => done(event.data));
    worker.addEventListener("error", () => done(null));
    worker.postMessage({ ...message, reqId: 1, bytes }, [bytes.buffer as ArrayBuffer]);
  });
}

async function buildInWorker(bytes: Uint8Array, job: ExportJob | null, date: Date, print: PrintOptions) {
  const reply = await inWorker({ type: "print", job, date: date.toISOString(), print }, bytes);
  return reply?.type === "printed" ? { bytes: reply.bytes, sheets: reply.sheets, clipped: reply.clipped } : null;
}

let printFrame: HTMLIFrameElement | null = null;

/** Opens the browser's print dialog for the PDF (a hidden blob: frame; it stays until the next print). */
function printInFrame(bytes: Uint8Array): Promise<boolean> {
  printFrame?.remove();
  if (printFrame?.src) URL.revokeObjectURL(printFrame.src);
  const frame = document.createElement("iframe");
  printFrame = frame;
  frame.title = "Print";
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", border: "0", opacity: "0", pointerEvents: "none" });
  frame.src = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 30_000);
    frame.addEventListener("load", () => {
      clearTimeout(timer);
      // The PDF viewer needs a moment after load before print() shows its pages.
      setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          resolve(true);
        } catch {
          resolve(false);
        }
      }, 300);
    });
    document.body.append(frame);
  });
}

const printDeps: PrintDeps = { decode: decodeImage, build: buildInWorker, print: printInFrame, record: reportActivity };

/** Writes the job in a fresh export worker (ended after the reply, or after EXPORT_TIMEOUT_MS). */
function writeInWorker(bytes: Uint8Array, job: ExportJob, date: Date, flatten: boolean, notice = false): Promise<WriteResult | null> {
  return inWorker({ type: "export", job, date: date.toISOString(), flatten, notice }, bytes).then((reply) =>
    reply?.type === "exported" ? { bytes: reply.bytes, annotations: reply.annotations, flattened: reply.flattened, pages: reply.pages } : null,
  );
}

function saveFile(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const browserDeps: ExportDeps = { decode: decodeImage, write: writeInWorker, save: saveFile, record: reportActivity };
