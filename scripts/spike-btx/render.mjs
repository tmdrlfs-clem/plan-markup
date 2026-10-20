// Renders a PDF page with pdf.js (legacy build for Node) onto an
// @napi-rs/canvas canvas. Same code path the browser uses (pdf.js on a canvas,
// annotations enabled, isEvalSupported: false); only the canvas differs.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCanvas } from "@napi-rs/canvas";
import { AnnotationMode, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Pixels per PDF point (4 px/pt ≈ 288 dpi). */
export const SCALE = 4;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PDFJS = path.join(ROOT, "node_modules/pdfjs-dist");
// pdf.js in Node reads these as file paths; trailing slash required.
const asDir = (p) => pathToFileURL(p).href.replace(/^file:\/\/\//, "").replace(/\/?$/, "/");
const dir = (name) => (process.platform === "win32" ? asDir(path.join(PDFJS, name)) : `${path.join(PDFJS, name)}/`);
// wasmUrl is required for CCITT/JBIG2/JPX images (pdf.js 6 decodes them in wasm);
// the browser build needs the same option.
const PDFJS_DIRS = {
  standardFontDataUrl: dir("standard_fonts"),
  cMapUrl: dir("cmaps"),
  wasmUrl: dir("wasm"),
  iccUrl: dir("iccs"),
};

/**
 * Renders page 1 of `bytes` at `scale` px/pt on white.
 * Returns { width, height, data: Uint8ClampedArray (RGBA), canvas }.
 */
export async function renderPdf(bytes, { scale = SCALE } = {}) {
  const task = getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    ...PDFJS_DIRS,
    cMapPacked: true,
    verbosity: Number(process.env.PDFJS_VERBOSITY ?? 0),
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      annotationMode: AnnotationMode.ENABLE,
      background: "#ffffff",
    }).promise;
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data, canvas };
  } finally {
    await task.destroy();
  }
}
