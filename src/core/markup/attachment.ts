// File attachment markup (Bluebeam toolbar set, founder 2026-11-21). Framework-free.
// A paperclip on the sheet that carries a file (kept in the markup as base64;
// exported as a PDF file attachment, the file embedded).

/** The largest file attached: 5 MB (the markup is saved with the drawing's markups). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
/** Its base64 length. */
export const MAX_ATTACHMENT_DATA = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
export const MAX_ATTACHMENT_NAME = 255;
export const ATTACHMENT_DATA_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
/** A media type as kept ("type/subtype"; anything else is application/octet-stream). */
export const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;
export const ATTACHMENT_ICON_PT = 14;

export function attachmentMime(type: string): string {
  const t = type.toLowerCase();
  return MIME_PATTERN.test(t) ? t : "application/octet-stream";
}

/** A file name safe to keep: no path, no control characters, at most 255 characters. */
export function attachmentName(name: string): string {
  const base = name.split(/[\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (base || "attachment").slice(0, MAX_ATTACHMENT_NAME);
}

/** Bytes as base64 (chunked, so a large file does not overflow the call stack). */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** "12 KB", "1.4 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
