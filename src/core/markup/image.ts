// Image markups (Story 5.8, FR31, NFR27). Framework-free.
//
// An image file is checked before the browser decodes it: by size, by its
// signature (PNG or JPEG only: never SVG or anything that can run script) and
// by the pixel size its header declares (a small file can declare a huge
// image). The editor then decodes it, scales it down to at most
// IMAGE_MAX_SIDE_PX and re-encodes it (which also drops its metadata).

/** The largest image file accepted (bytes). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** The most pixels an image may declare (a decompression bomb is refused before decoding). */
export const IMAGE_MAX_PIXELS = 50_000_000;
/** A stored image's longest side, in pixels (larger ones are scaled down). */
export const IMAGE_MAX_SIDE_PX = 2048;
/** An image's natural size on the page: one pixel is a CSS pixel (96 per inch), 0.75 pt. */
export const IMAGE_PT_PER_PX = 0.75;
/** A placed image fits in this share of the view (D1). */
export const IMAGE_VIEW_SHARE = 0.4;

export type ImageKind = "png" | "jpeg";
export type ImageInfo = { kind: ImageKind; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image's kind and declared size from its header; null when it is not a PNG or JPEG we can read. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length >= 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    // The first chunk is IHDR: width and height, big-endian.
    if (String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return valid({ kind: "png", width: view.getUint32(16), height: view.getUint32(20) });
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    // Walk the markers to the first start of frame (SOF0–SOF15 less DHT, JPG, DAC).
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = (bytes[i + 2] << 8) | bytes[i + 3];
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        return valid({ kind: "jpeg", width, height });
      }
      if (marker === 0xd9 || marker === 0xda) return null;
      i += 2 + length;
    }
  }
  return null;
}

function valid(info: ImageInfo): ImageInfo | null {
  return info.width > 0 && info.height > 0 ? info : null;
}

/** Why an image file is refused, or null when it may be decoded. */
export function imageRefusal(size: number, info: ImageInfo | null): string | null {
  if (size > IMAGE_MAX_BYTES) return `The image is larger than ${IMAGE_MAX_BYTES / 1024 / 1024} MB.`;
  if (!info) return "Only PNG and JPEG images can be inserted.";
  if (info.width * info.height > IMAGE_MAX_PIXELS) return "The image has too many pixels.";
  return null;
}

/** The size scaled down (never up) to fit in `maxWidth` × `maxHeight`, its aspect kept. */
export function fitSize(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const k = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: width * k, height: height * k };
}
