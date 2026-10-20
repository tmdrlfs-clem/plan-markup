// Hex + zlib decoding for .btx values (framework-free). Inflation uses the
// platform DecompressionStream (browser, Web Worker, Node >= 18): no zlib
// dependency. Budgets are enforced while reading chunks, so a zip bomb is
// stopped as soon as it crosses a limit, not after it has been expanded.

import { BtxError } from "./errors";
import { BTX_LIMITS, type BtxLimits } from "./limits";

/** Running inflate budget for one file. */
export type InflateBudget = {
  maxValueBytes: number;
  remainingTotalBytes: number;
};

export function createInflateBudget(limits: Pick<BtxLimits, "maxInflatedValueBytes" | "maxInflatedTotalBytes"> = BTX_LIMITS): InflateBudget {
  return {
    maxValueBytes: limits.maxInflatedValueBytes,
    remainingTotalBytes: limits.maxInflatedTotalBytes,
  };
}

function hexNibble(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

/** Hex text (surrounding whitespace allowed) to bytes. */
export function hexToBytes(hex: string, maxHexChars: number = BTX_LIMITS.maxHexChars): Uint8Array {
  const s = hex.trim();
  if (s.length > maxHexChars) {
    throw new BtxError("hex-too-large", `Hex value longer than ${maxHexChars} characters`);
  }
  if (s.length % 2 !== 0) throw new BtxError("hex-invalid", "Hex value has an odd length");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = hexNibble(s.charCodeAt(2 * i));
    const lo = hexNibble(s.charCodeAt(2 * i + 1));
    if (hi < 0 || lo < 0) throw new BtxError("hex-invalid", "Hex value has a non-hex character");
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/**
 * Compressed bytes fed to the inflater per write. Deflate expands at most
 * ~1032:1, so one write can produce at most ~8.3 MB before the next budget
 * check (the stream applies backpressure: the next slice is only consumed
 * after the reader has taken the previous output).
 */
export const INFLATE_SLICE_BYTES = 8 * 1024;

/**
 * Inflates a zlib-wrapped stream. Throws BtxError when the value exceeds
 * budget.maxValueBytes or the file's remaining total, checked per chunk.
 * The input is written in INFLATE_SLICE_BYTES slices interleaved with reads,
 * so a zip bomb is never expanded far past the budget. The total budget is
 * decremented by the inflated size.
 */
export async function inflateZlib(input: Uint8Array, budget: InflateBudget): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  let stopped = false;
  // Errors surface on the reader side; the pump only stops.
  const pump = (async () => {
    for (let at = 0; at < input.byteLength && !stopped; at += INFLATE_SLICE_BYTES) {
      await writer.write(input.slice(at, at + INFLATE_SLICE_BYTES));
    }
    if (!stopped) await writer.close();
  })().catch(() => {});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch {
        throw new BtxError("inflate-failed", "Value is not a valid zlib stream");
      }
      if (result.done) break;
      size += result.value.byteLength;
      if (size > budget.maxValueBytes) {
        throw new BtxError(
          "inflate-value-too-large",
          `Inflated value larger than ${budget.maxValueBytes} bytes`,
        );
      }
      if (size > budget.remainingTotalBytes) {
        throw new BtxError(
          "inflate-total-too-large",
          "Inflated values exceed the per-file total budget",
        );
      }
      chunks.push(result.value);
    }
  } catch (e) {
    stopped = true;
    // Cancelling the readable errors the writable side: a pending write rejects
    // and the pump ends without feeding more input.
    reader.cancel().catch(() => {});
    writer.abort().catch(() => {});
    throw e;
  }
  await pump;
  budget.remainingTotalBytes -= size;
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Exact ISO-8859-1 (one char per byte; TextDecoder("latin1") is windows-1252). */
export function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/** UTF-8 when valid, else Latin-1 (never throws). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    return bytesToLatin1(bytes);
  }
}

/** Hex → bytes → inflate, with all budgets. */
export async function decodeHexValue(
  hex: string,
  budget: InflateBudget,
  maxHexChars: number = BTX_LIMITS.maxHexChars,
): Promise<Uint8Array> {
  return inflateZlib(hexToBytes(hex, maxHexChars), budget);
}
