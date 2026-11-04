// Story 5.13: the signature's images in the browser. A drawn signature is
// cut to its ink; an uploaded one is checked, decoded, scaled down and
// re-encoded as PNG (its metadata goes); a stamp is the stored image with the
// signer's name and the date drawn under it, as one PNG data URL.

import { fitSize, imageRefusal, sniffImage } from "@/core/markup/image";
import { SIGNATURE_MAX_SIDE_PX, SIGNATURE_UPLOAD_MAX_BYTES, signatureCaption } from "@/core/signature/signature";
import type { SignatureMeta } from "@/core/schema/markup";

/** A PNG ready to store: its base64, a data URL to preview and its size. */
export type SignaturePng = { base64: string; dataUrl: string; width: number; height: number };

/** Ink a signature is drawn with, and around its cut. */
export const INK_COLOR = "#111111";
const TRIM_PAD_PX = 8;

function toPng(canvas: HTMLCanvasElement): SignaturePng {
  const dataUrl = canvas.toDataURL("image/png");
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), dataUrl, width: canvas.width, height: canvas.height };
}

/** The drawn pad cut to its ink (with a little margin), scaled to fit SIGNATURE_MAX_SIDE_PX; null when it has none. */
export function trimmedPad(pad: HTMLCanvasElement): SignaturePng | null {
  const c = pad.getContext("2d");
  if (!c) return null;
  const { width, height } = pad;
  const data = c.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const x0 = Math.max(0, minX - TRIM_PAD_PX);
  const y0 = Math.max(0, minY - TRIM_PAD_PX);
  const w = Math.min(width, maxX + TRIM_PAD_PX + 1) - x0;
  const h = Math.min(height, maxY + TRIM_PAD_PX + 1) - y0;
  const size = fitSize(w, h, SIGNATURE_MAX_SIDE_PX, SIGNATURE_MAX_SIDE_PX);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(size.width));
  out.height = Math.max(1, Math.round(size.height));
  out.getContext("2d")!.drawImage(pad, x0, y0, w, h, 0, 0, out.width, out.height);
  return toPng(out);
}

/** An uploaded PNG or JPEG as a stored signature; a string says why it was refused. */
export async function uploadedSignature(file: File): Promise<SignaturePng | string> {
  if (file.size > SIGNATURE_UPLOAD_MAX_BYTES) return "The image is larger than 5 MB.";
  const info = sniffImage(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()));
  const refusal = imageRefusal(file.size, info);
  if (refusal || !info) return refusal ?? "Use a PNG or JPEG image.";
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const size = fitSize(bitmap.width, bitmap.height, SIGNATURE_MAX_SIDE_PX, SIGNATURE_MAX_SIDE_PX);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(size.width));
      canvas.height = Math.max(1, Math.round(size.height));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return toPng(canvas);
    } finally {
      bitmap.close();
    }
  } catch {
    return "The file could not be read as an image.";
  }
}

/** The stored signature at `url` (a signed URL) as a blob, or null when it cannot be read. */
export async function fetchSignature(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type === "image/png" || blob.type === "" ? blob : null;
  } catch {
    return null;
  }
}

/** The stamp of `signature` for `name` today: the signature with "name · date" under it, as a PNG data URL. */
export async function stampImage(signature: Blob, name: string, now: Date = new Date()): Promise<{ src: string; width: number; height: number; signature: SignatureMeta }> {
  const bitmap = await createImageBitmap(signature);
  try {
    const caption = signatureCaption(name, now);
    const font = Math.max(16, Math.round(bitmap.height * 0.2));
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = `${font}px sans-serif`;
    const textWidth = Math.ceil(measure.measureText(caption).width);
    const width = Math.max(bitmap.width, textWidth + 8);
    const height = bitmap.height + Math.round(font * 1.5);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d")!;
    c.drawImage(bitmap, Math.round((width - bitmap.width) / 2), 0);
    c.font = `${font}px sans-serif`;
    c.fillStyle = INK_COLOR;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.fillText(caption, width / 2, bitmap.height + font);
    const date = caption.slice(caption.lastIndexOf(" ") + 1);
    return { src: canvas.toDataURL("image/png"), width, height, signature: { signer: (name.trim() || "Signed").slice(0, 100), date } };
  } finally {
    bitmap.close();
  }
}
