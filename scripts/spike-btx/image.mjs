// Image helpers for the .btx spike harness: trim, scale, pixel diff, contact sheet.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import pixelmatch from "pixelmatch";

// A known font for labels (the system "sans-serif" fallback can be a CJK face).
const LABEL_FONT = "SpikeLabel";
GlobalFonts.registerFromPath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
  LABEL_FONT,
);

/** Pass when the diff is at most this share of the reference's non-white pixels (A9). */
export const PASS_DIFF_PERCENT = 2;
/** pixelmatch colour threshold (0..1); anti-aliased pixels are ignored. */
export const PIXELMATCH_THRESHOLD = 0.1;

const isInk = (d, i) => d[i + 3] > 0 && (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250);

/** Bounding box of non-white pixels, or null when the image is blank. */
export function inkBox({ width, height, data }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(data, (y * width + x) * 4)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function countInk({ data }) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (isInk(data, i)) n++;
  return n;
}

function toCanvas(img) {
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  const id = ctx.createImageData(img.width, img.height);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  return c;
}

/** Crops to the ink box and scales to w×h on white. */
function cropScale(img, box, w, h) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(toCanvas(img), box.x, box.y, box.w, box.h, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/** Trims to the ink box (no scaling). */
export function trim(img) {
  const box = inkBox(img);
  return box ? cropScale(img, box, box.w, box.h) : null;
}

/** Allowed ink-box size difference: this share of the reference size or SIZE_TOLERANCE_PX, whichever is larger. */
export const SIZE_TOLERANCE = 0.05;
export const SIZE_TOLERANCE_PX = 2;

const sizeOff = (cand, ref) => Math.abs(cand - ref) > Math.max(SIZE_TOLERANCE * ref, SIZE_TOLERANCE_PX);

/**
 * Compares a candidate render with a reference: both trimmed to their ink
 * box. Fails when the ink boxes differ in width or height by more than the
 * size tolerance (a scale or aspect error), else the candidate is scaled
 * uniformly (one factor, centred) onto the reference box and pixelmatch runs
 * with PIXELMATCH_THRESHOLD and anti-aliasing ignored.
 * Returns { diffPercent, pass, reason?, diffImage? }.
 */
export function compare(candidate, reference) {
  const refBox = inkBox(reference);
  if (!refBox) return { diffPercent: null, pass: false, reason: "reference is blank" };
  const candBox = inkBox(candidate);
  if (!candBox) return { diffPercent: 100, pass: false, reason: "render is blank" };
  if (sizeOff(candBox.w, refBox.w) || sizeOff(candBox.h, refBox.h)) {
    return {
      diffPercent: null,
      pass: false,
      reason: `size differs (${candBox.w}x${candBox.h} px vs reference ${refBox.w}x${refBox.h} px)`,
    };
  }
  const ref = cropScale(reference, refBox, refBox.w, refBox.h);
  const k = Math.min(refBox.w / candBox.w, refBox.h / candBox.h);
  const cand = cropFit(candidate, candBox, refBox.w, refBox.h, k);
  const out = new Uint8ClampedArray(ref.data.length);
  const diff = pixelmatch(cand.data, ref.data, out, ref.width, ref.height, {
    threshold: PIXELMATCH_THRESHOLD,
    includeAA: false,
  });
  const refInk = countInk(ref);
  const diffPercent = refInk === 0 ? 100 : (diff / refInk) * 100;
  const pass = diffPercent <= PASS_DIFF_PERCENT;
  return { diffPercent, pass, reason: pass ? undefined : "pixels differ", diffImage: { width: ref.width, height: ref.height, data: out } };
}

/** Crops to the ink box and draws it scaled by k (both axes), centred on a w×h white canvas. */
function cropFit(img, box, w, h, k) {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  const dw = box.w * k;
  const dh = box.h * k;
  ctx.drawImage(toCanvas(img), box.x, box.y, box.w, box.h, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

export async function encodePng(img) {
  return toCanvas(img).encode("png");
}

export async function decodePng(bytes) {
  const im = await loadImage(bytes);
  const c = createCanvas(im.width, im.height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, im.width, im.height);
  ctx.drawImage(im, 0, 0);
  return { width: im.width, height: im.height, data: ctx.getImageData(0, 0, im.width, im.height).data };
}

/**
 * Grid of renders with "index subject" labels. `cells` = [{ label, image|null }].
 * Each image is trimmed and fitted into the cell (aspect kept, upscaled at most 4×
 * for legibility). Returns PNG bytes.
 */
export async function contactSheet(cells, { cell = 220, label = 28, columns = 8 } = {}) {
  const rows = Math.max(1, Math.ceil(cells.length / columns));
  const c = createCanvas(columns * cell, rows * (cell + label));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  cells.forEach((entry, i) => {
    const x = (i % columns) * cell;
    const y = Math.floor(i / columns) * (cell + label);
    ctx.strokeStyle = "#cccccc";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell + label - 1);
    const img = entry.image ? trim(entry.image) : null;
    if (img) {
      const pad = 10;
      const k = Math.min(4, (cell - 2 * pad) / img.width, (cell - 2 * pad) / img.height);
      const w = Math.max(1, Math.round(img.width * k));
      const h = Math.max(1, Math.round(img.height * k));
      ctx.drawImage(toCanvas(img), 0, 0, img.width, img.height, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    } else {
      ctx.fillStyle = "#cc0000";
      ctx.font = `16px ${LABEL_FONT}`;
      ctx.fillText("(blank)", x + 10, y + cell / 2);
    }
    ctx.fillStyle = "#000000";
    ctx.font = `14px ${LABEL_FONT}`;
    ctx.fillText(entry.label.slice(0, 28), x + 6, y + cell + 19);
  });
  return c.encode("png");
}
