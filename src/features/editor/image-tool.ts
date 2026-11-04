// Story 5.8: the Image tool (FR31, NFR27). The rail's Image button picks a
// PNG or JPEG file; it is checked (size, signature, declared pixels: core
// image.ts), decoded by the browser, scaled down to at most 2048 px and
// re-encoded (dropping its metadata), then Image is armed: a click places it
// centred there, upright on screen, at its natural size (96 px an inch) or
// smaller to fit in 40 % of the view (D1); Select then has it, to resize. A
// refused file says why (a toast) and arms nothing.
//
// Images are painted from a cache of decoded elements by their data URL; one
// still decoding (or that failed) shows as its box crossed out.

import { createStore } from "zustand/vanilla";

import { toast } from "@/components/ui/toast-store";
import { uuidv7 } from "@/core/ids/uuid";
import { IMAGE_MAX_SIDE_PX, IMAGE_PT_PER_PX, IMAGE_VIEW_SHARE, fitSize, imageRefusal, sniffImage, type ImageKind } from "@/core/markup/image";
import { boxFrom, screenAxes } from "@/core/markup/text";
import { DEFAULT_MARKUP_STYLE, IMAGE_SRC_PATTERN, MAX_IMAGE_SRC_LENGTH, type ImageMarkup, type MarkupStyle } from "@/core/schema/markup";
import { notifyMarkups, setTool, type LayerView } from "@/features/viewer";

import { lastViewOf } from "./text-tool";

type Point = { x: number; y: number };

export const ADD_IMAGE = "Add image";
export const IMAGE_FAILED = "The image could not be inserted.";

/** An image picked and ready to place: its data URL and its size in pixels. */
export type PickedImage = { src: string; width: number; height: number };

/** The image waiting for its click (the Image tool is armed while there is one). */
export const imageStore = createStore<{ picked: PickedImage | null }>(() => ({ picked: null }));
export const pickedImage = (): PickedImage | null => imageStore.getState().picked;
export function clearPickedImage(): void {
  if (imageStore.getState().picked) imageStore.setState({ picked: null });
}

/** Decodes an accepted file and re-encodes it, scaled down to `maxSide` (the browser's decoder). */
export type ImageDecoder = (file: Blob, kind: ImageKind, maxSide: number) => Promise<PickedImage>;

async function decodeInBrowser(file: Blob, kind: ImageKind, maxSide: number): Promise<PickedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitSize(bitmap.width, bitmap.height, maxSide, maxSide);
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("no 2d context");
    // A JPEG has no transparency: on white, as on the sheet.
    if (kind === "jpeg") {
      c.fillStyle = "#ffffff";
      c.fillRect(0, 0, width, height);
    }
    c.drawImage(bitmap, 0, 0, width, height);
    return { src: canvas.toDataURL(kind === "png" ? "image/png" : "image/jpeg", 0.9), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Reads, checks and decodes `file`; on success it waits to be placed and Image is armed. A
 * refused or undecodable file says why and arms nothing. True when it was picked.
 */
export async function pickImageFile(file: File, decode: ImageDecoder = decodeInBrowser): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const info = sniffImage(head);
  const refusal = imageRefusal(file.size, info);
  if (refusal || !info) {
    toast({ title: IMAGE_FAILED, description: refusal ?? undefined, variant: "warning" });
    return false;
  }
  let picked: PickedImage;
  try {
    picked = await decode(file, info.kind, IMAGE_MAX_SIDE_PX);
  } catch {
    toast({ title: IMAGE_FAILED, description: "The file could not be read as an image.", variant: "warning" });
    return false;
  }
  if (picked.src.length > MAX_IMAGE_SRC_LENGTH || !IMAGE_SRC_PATTERN.test(picked.src)) {
    toast({ title: IMAGE_FAILED, description: "The image is too large once decoded.", variant: "warning" });
    return false;
  }
  imageStore.setState({ picked });
  setTool("image");
  return true;
}

/**
 * The image markup for `picked` centred at `at` on page `pageId`: upright on screen as the page
 * was last painted, its natural size or smaller to fit in IMAGE_VIEW_SHARE of that view.
 */
export function imageMarkupAt(picked: PickedImage, at: Point, pageId: string, style: MarkupStyle = DEFAULT_MARKUP_STYLE): ImageMarkup {
  const view = lastViewOf(pageId);
  const unit = view && view.userUnit > 0 ? view.userUnit : 1;
  // The natural size in user units, then fitted to the view's share (its device px in user units).
  let size = { width: (picked.width * IMAGE_PT_PER_PX) / unit, height: (picked.height * IMAGE_PT_PER_PX) / unit };
  if (view && view.width > 0 && view.height > 0 && view.devicePerPt > 0) {
    const perUser = view.devicePerPt * unit;
    size = fitSize(size.width, size.height, (view.width / perUser) * IMAGE_VIEW_SHARE, (view.height / perUser) * IMAGE_VIEW_SHARE);
  }
  const { right, down } = screenAxes(at, view?.toDevice ?? ((p) => ({ x: p.x, y: -p.y })));
  const origin = { x: at.x - (right.x * size.width + down.x * size.height) / 2, y: at.y - (right.y * size.width + down.y * size.height) / 2 };
  return {
    id: uuidv7(),
    pageId,
    createdAt: new Date().toISOString(),
    style,
    type: "image",
    points: boxFrom(origin, right, down, size.width, size.height),
    src: picked.src,
  };
}

/** Decoded images by data URL (the markups share one element per image). */
const decoded = new Map<string, HTMLImageElement | "failed">();
const DECODED_KEPT = 64;

/** The decoded image of `src`, or null while it decodes (the layer is painted again when it has) or when it failed. */
function imageOf(src: string): HTMLImageElement | null {
  const known = decoded.get(src);
  if (known === "failed") return null;
  if (known) return known.complete && known.naturalWidth > 0 ? known : null;
  if (typeof Image === "undefined") return null;
  const img = new Image();
  img.onload = () => notifyMarkups({});
  img.onerror = () => {
    decoded.set(src, "failed");
    notifyMarkups({});
  };
  img.src = src;
  decoded.set(src, img);
  if (decoded.size > DECODED_KEPT) decoded.delete(decoded.keys().next().value!);
  return null;
}

export function forgetDecodedImages(): void {
  decoded.clear();
}

/** An image markup in its box (device corners p0 top left, p1 top right, p3 bottom left); crossed out until decoded. */
export function paintImage(c: CanvasRenderingContext2D, m: ImageMarkup, box: readonly Point[], view: LayerView): void {
  const [p0, p1, p2, p3] = box;
  const img = imageOf(m.src);
  c.save();
  if ((m.style.opacity ?? 1) < 1) c.globalAlpha = m.style.opacity ?? 1;
  if (img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    c.transform((p1.x - p0.x) / w, (p1.y - p0.y) / w, (p3.x - p0.x) / h, (p3.y - p0.y) / h, p0.x, p0.y);
    c.drawImage(img, 0, 0);
  } else {
    c.beginPath();
    c.moveTo(p0.x, p0.y);
    c.lineTo(p1.x, p1.y);
    c.lineTo(p2.x, p2.y);
    c.lineTo(p3.x, p3.y);
    c.closePath();
    c.moveTo(p0.x, p0.y);
    c.lineTo(p2.x, p2.y);
    c.moveTo(p1.x, p1.y);
    c.lineTo(p3.x, p3.y);
    c.lineWidth = Math.max(1, view.dpr);
    c.strokeStyle = view.colors.warning;
    c.stroke();
  }
  c.restore();
}
