// Story 8.1 (FR60, AR25): File → Export → Editable PDF. The open drawing's
// markups on the chosen pages (those on hidden layers only when chosen) are
// converted on the main thread (core/export/from-app.ts: the app's captions,
// decoded images), then the export worker writes them onto the original PDF
// with pdf-lib; the result downloads under the drawing's own file name. The
// original file and the markup set are not changed.

import { pageIdOf } from "@/core/calibration/calibration";
import { exportJob, type DecodedImage, type ExportJob } from "@/core/export/from-app";
import type { Markup } from "@/core/schema/markup";
import { editorStore, layersOf, markupsOf } from "@/features/editor";
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

export type ExportChoice = { pages: readonly number[]; includeHidden: boolean };
export type ExportOutcome = { ok: true; name: string; annotations: number; pages: number } | { ok: false; reason: string };

export type ExportDeps = {
  decode: (src: string) => Promise<DecodedImage | null>;
  write: (bytes: Uint8Array, job: ExportJob, date: Date) => Promise<{ bytes: Uint8Array; annotations: number; pages: number } | null>;
  save: (name: string, bytes: Uint8Array) => void;
};

/** Whether the shown drawing can be exported now (null), else why not. */
export function exportBlocked(): string | null {
  const v = viewerStore.getState();
  if (!v.file || !v.documentId || v.pageCount === 0 || v.status === "error") return NO_DRAWING;
  if (v.standIn) return STAND_IN;
  return null;
}

/** Exports the open drawing (see the header); never throws. */
export async function runExport(choice: ExportChoice, deps: ExportDeps = browserDeps): Promise<ExportOutcome> {
  const blocked = exportBlocked();
  if (blocked) return { ok: false, reason: blocked };
  const v = viewerStore.getState();
  const file = v.file!;
  const documentId = v.documentId!;
  const state = editorStore.getState();
  const markups = markupsOf(state, documentId);
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
    const decoded = await deps.decode(m.src).catch(() => null);
    if (decoded) images.set(m.id, decoded);
  }
  const job = exportJob({ markups, layers: layersOf(state, documentId), pages, author, images, includeHidden: choice.includeHidden });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "The drawing's file could not be read again." };
  }
  const out = await deps.write(bytes, job, new Date()).catch(() => null);
  if (!out) return { ok: false, reason: EXPORT_FAILED };
  const name = exportName(file.name);
  deps.save(name, out.bytes);
  return { ok: true, name, annotations: out.annotations, pages: out.pages };
}

/** The exported file's name: the drawing's own (a .pdf). */
export function exportName(fileName: string): string {
  const stem = fileName.replace(/\.pdf$/i, "").trim() || "drawing";
  return `${stem}.pdf`;
}

/** The markups an export of `choice` would write (the dialog's count). */
export function exportCount(choice: ExportChoice): number {
  const v = viewerStore.getState();
  if (!v.documentId) return 0;
  const state = editorStore.getState();
  const hidden = new Set(layersOf(state, v.documentId).filter((l) => l.hidden).map((l) => l.id));
  const pages = new Set(choice.pages.map((i) => pageIdOf(v.documentId!, i)));
  return markupsOf(state, v.documentId).filter((m: Markup) => pages.has(m.pageId) && (choice.includeHidden || !m.layerId || !hidden.has(m.layerId))).length;
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

/** Writes the job in a fresh export worker (ended after the reply, or after EXPORT_TIMEOUT_MS). */
function writeInWorker(bytes: Uint8Array, job: ExportJob, date: Date): Promise<{ bytes: Uint8Array; annotations: number; pages: number } | null> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("../../workers/export.worker.ts", import.meta.url), { type: "module" });
    const done = (value: { bytes: Uint8Array; annotations: number; pages: number } | null) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), EXPORT_TIMEOUT_MS);
    worker.addEventListener("message", (event: MessageEvent<ExportWorkerReply>) => {
      const reply = event.data;
      done(reply.type === "exported" ? { bytes: reply.bytes, annotations: reply.annotations, pages: reply.pages } : null);
    });
    worker.addEventListener("error", () => done(null));
    worker.postMessage({ type: "export", reqId: 1, bytes, job, date: date.toISOString() }, [bytes.buffer as ArrayBuffer]);
  });
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

const browserDeps: ExportDeps = { decode: decodeImage, write: writeInWorker, save: saveFile };
