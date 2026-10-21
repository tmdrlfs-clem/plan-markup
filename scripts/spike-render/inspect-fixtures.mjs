// Prints size, page size and pdf.js operator counts for the render-spike fixtures
// (Story 2.3). Numbers only: nothing from the drawings' content is printed.
// Usage: node scripts/spike-render/inspect-fixtures.mjs [file ...]
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PDFJS = path.join(ROOT, "node_modules/pdfjs-dist");
const dir = (name) => {
  const p = path.join(PDFJS, name);
  return process.platform === "win32" ? pathToFileURL(p).href.replace(/^file:\/\/\//, "").replace(/\/?$/, "/") : `${p}/`;
};

export const FIXTURES = [
  "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf",
  "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf",
  "synthetic-a0-50mb.pdf",
];

const PATH_OPS = new Set([OPS.moveTo, OPS.lineTo, OPS.curveTo, OPS.curveTo2, OPS.curveTo3, OPS.closePath, OPS.rectangle]);

async function inspect(file) {
  const bytes = new Uint8Array(readFileSync(file));
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    standardFontDataUrl: dir("standard_fonts"),
    cMapUrl: dir("cmaps"),
    wasmUrl: dir("wasm"),
    iccUrl: dir("iccs"),
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const [x0, y0, x1, y1] = page.view;
    const t0 = performance.now();
    const list = await page.getOperatorList();
    const ms = performance.now() - t0;
    let pathOps = 0;
    let constructPath = 0;
    let images = 0;
    for (let i = 0; i < list.fnArray.length; i++) {
      const fn = list.fnArray[i];
      if (fn === OPS.constructPath) {
        constructPath++;
        // pdf.js 6 batches path segments into constructPath; count the segments.
        const args = list.argsArray[i];
        const data = args?.[1]?.[0];
        if (data && typeof data.length === "number") pathOps += countSegments(data);
      } else if (PATH_OPS.has(fn)) pathOps++;
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) images++;
    }
    return {
      file: path.basename(file),
      mb: +(statSync(file).size / 1024 / 1024).toFixed(2),
      pages: doc.numPages,
      pageSizePt: [+(x1 - x0).toFixed(1), +(y1 - y0).toFixed(1)],
      rotate: page.rotate,
      operatorListLength: list.fnArray.length,
      constructPathOps: constructPath,
      pathSegmentsApprox: pathOps,
      imageOps: images,
      nodeOperatorListMs: Math.round(ms),
    };
  } finally {
    await task.destroy();
  }
}

/** pdf.js 6 path data: a Float32Array of [op, ...coords] records (DrawOPS: 0 moveTo, 1 lineTo, 2 curveTo, 3 quadraticCurveTo, 4 closePath). */
function countSegments(data) {
  const SIZES = [3, 3, 7, 5, 1];
  let n = 0;
  for (let i = 0; i < data.length; ) {
    const size = SIZES[data[i]];
    if (!size) return n;
    n++;
    i += size;
  }
  return n;
}

const files = process.argv.slice(2);
const list = files.length > 0 ? files : FIXTURES.map((f) => path.join(ROOT, "fixtures/private/pdf", f));
for (const f of list) {
  try {
    console.log(JSON.stringify(await inspect(f)));
  } catch (e) {
    console.log(JSON.stringify({ file: path.basename(f), error: String(e?.message ?? e) }));
  }
}
