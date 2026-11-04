// Story 5.13: the user's signature (FR83). Framework-free.
//
// A signature is stored as a PNG of at most SIGNATURE_MAX_BYTES and
// SIGNATURE_MAX_SIDE_PX a side: the browser draws or re-encodes it (an
// uploaded image is decoded and scaled down first, so its metadata is gone),
// and the server checks the bytes again before storing them.

import { sniffImage } from "@/core/markup/image";

/** The largest stored signature (bytes; the bucket's limit too). */
export const SIGNATURE_MAX_BYTES = 512 * 1024;
/** A stored signature's longest side (px). */
export const SIGNATURE_MAX_SIDE_PX = 1200;
/** The largest file a user may upload to make a signature from (it is scaled down and re-encoded). */
export const SIGNATURE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** A signed URL lives at most this long (AR19: ≤ 10 min). */
export const SIGNED_URL_SECONDS = 600;

/** Why `bytes` cannot be stored as a signature, or null with its size when it can. */
export function checkSignaturePng(bytes: Uint8Array): { ok: true; width: number; height: number } | { ok: false; reason: string } {
  if (bytes.length === 0) return { ok: false, reason: "The signature is empty." };
  if (bytes.length > SIGNATURE_MAX_BYTES) return { ok: false, reason: "The signature is larger than 512 KB." };
  const info = sniffImage(bytes);
  if (!info || info.kind !== "png") return { ok: false, reason: "The signature must be a PNG image." };
  if (info.width > SIGNATURE_MAX_SIDE_PX || info.height > SIGNATURE_MAX_SIDE_PX) return { ok: false, reason: "The signature is larger than 1200 px a side." };
  return { ok: true, width: info.width, height: info.height };
}

/** The caption a placed signature carries: the signer's name and the date (YYYY-MM-DD, local). */
export function signatureCaption(name: string, at: Date): string {
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  const who = name.trim() || "Signed";
  return `${who} · ${date}`;
}
