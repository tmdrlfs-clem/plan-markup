// Client-generated ids (architecture: markups use UUID v7). Framework-free.
//
// Validation uses a permissive pattern (any version / variant nibble): Zod v4's
// uuid() rejects ids other tools write (project pitfall), so ids are checked by
// shape only.

/** 8-4-4-4-12 hex, any version and variant. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fills `bytes` with random values (crypto.getRandomValues by default). */
export type RandomFill = (bytes: Uint8Array) => Uint8Array;

const cryptoFill: RandomFill = (bytes) => globalThis.crypto.getRandomValues(bytes);

/**
 * A UUID v7 (RFC 9562): 48-bit Unix milliseconds, version 7, 74 random bits
 * with the RFC variant. Ids made later sort after earlier ones (by millisecond).
 */
export function uuidv7(now: number = Date.now(), random: RandomFill = cryptoFill): string {
  const bytes = random(new Uint8Array(16));
  const ms = Math.max(0, Math.floor(now));
  // 48-bit big-endian timestamp (2 ** 48 ms is year 10889).
  for (let i = 5; i >= 0; i--) bytes[5 - i] = Math.floor(ms / 2 ** (8 * i)) & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
