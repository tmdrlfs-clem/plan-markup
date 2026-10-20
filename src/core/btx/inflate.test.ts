import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BtxError } from "./errors";
import { INFLATE_SLICE_BYTES, createInflateBudget, decodeHexValue, decodeText, hexToBytes, inflateZlib } from "./inflate";

async function code(p: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    if (e instanceof BtxError) return e.code;
    throw e;
  }
  return undefined;
}

const z = (s: string | Uint8Array) => new Uint8Array(deflateSync(typeof s === "string" ? Buffer.from(s) : s));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("hexToBytes", () => {
  it("decodes upper/lower case hex with surrounding whitespace", () => {
    expect([...hexToBytes(" 00ffA0\r\n")]).toEqual([0, 255, 160]);
  });

  it("rejects odd length, non-hex and over-long values", async () => {
    expect(await code(() => hexToBytes("abc"))).toBe("hex-invalid");
    expect(await code(() => hexToBytes("zz"))).toBe("hex-invalid");
    expect(await code(() => hexToBytes("00".repeat(5), 8))).toBe("hex-too-large");
  });
});

describe("inflateZlib", () => {
  it("inflates a zlib stream and charges the file budget", async () => {
    const budget = createInflateBudget();
    const before = budget.remainingTotalBytes;
    const out = await inflateZlib(z("hello"), budget);
    expect(new TextDecoder().decode(out)).toBe("hello");
    expect(budget.remainingTotalBytes).toBe(before - 5);
  });

  it("stops a value over the per-value budget while inflating", async () => {
    const bomb = z(new Uint8Array(1024 * 1024)); // ~1 KB that inflates to 1 MB
    const budget = { maxValueBytes: 64 * 1024, remainingTotalBytes: 10 * 1024 * 1024 };
    expect(await code(inflateZlib(bomb, budget))).toBe("inflate-value-too-large");
  });

  it("stops when the running per-file total is exceeded", async () => {
    const budget = { maxValueBytes: 1024 * 1024, remainingTotalBytes: 150 * 1024 };
    await inflateZlib(z(new Uint8Array(100 * 1024)), budget);
    expect(await code(inflateZlib(z(new Uint8Array(100 * 1024)), budget))).toBe("inflate-total-too-large");
  });

  it("inflates input larger than one write slice", async () => {
    const data = new Uint8Array(5 * INFLATE_SLICE_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7919) % 251; // poorly compressible
    const out = await inflateZlib(z(data), createInflateBudget());
    expect(out).toEqual(data);
  });

  it("rejects data that is not zlib", async () => {
    expect(await code(inflateZlib(new Uint8Array([1, 2, 3, 4]), createInflateBudget()))).toBe("inflate-failed");
  });

  it("decodeHexValue chains hex and inflate", async () => {
    const out = await decodeHexValue(hex(z("BBObjPtr")), createInflateBudget());
    expect(decodeText(out)).toBe("BBObjPtr");
  });
});

describe("inflateZlib input slicing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("feeds the input in slices and stops writing once the budget is exceeded", async () => {
    let written = 0;
    // A fake inflater that expands every written byte 100x (a zip bomb).
    class ExpandingStream {
      readonly writable: WritableStream<Uint8Array>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor() {
        const ts = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            written += chunk.byteLength;
            controller.enqueue(new Uint8Array(chunk.byteLength * 100));
          },
        });
        this.writable = ts.writable;
        this.readable = ts.readable;
      }
    }
    vi.stubGlobal("DecompressionStream", ExpandingStream);
    const input = new Uint8Array(1024 * 1024);
    const budget = { maxValueBytes: 2 * 100 * INFLATE_SLICE_BYTES, remainingTotalBytes: 1024 * 1024 * 1024 };
    expect(await code(inflateZlib(input, budget))).toBe("inflate-value-too-large");
    // Not the whole megabyte: at most a few slices past the budget were fed.
    expect(written).toBeLessThanOrEqual(4 * INFLATE_SLICE_BYTES);
  });
});

describe("decodeText", () => {
  it("uses UTF-8 when valid and Latin-1 otherwise", () => {
    expect(decodeText(new Uint8Array([0xc3, 0xa9]))).toBe("é");
    expect(decodeText(new Uint8Array([0xe9, 0x80]))).toBe("é\u0080");
  });
});
