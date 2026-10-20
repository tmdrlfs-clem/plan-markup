import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { BtxError } from "./errors";
import { createInflateBudget, decodeHexValue, decodeText, hexToBytes, inflateZlib } from "./inflate";

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

  it("rejects data that is not zlib", async () => {
    expect(await code(inflateZlib(new Uint8Array([1, 2, 3, 4]), createInflateBudget()))).toBe("inflate-failed");
  });

  it("decodeHexValue chains hex and inflate", async () => {
    const out = await decodeHexValue(hex(z("BBObjPtr")), createInflateBudget());
    expect(decodeText(out)).toBe("BBObjPtr");
  });
});

describe("decodeText", () => {
  it("uses UTF-8 when valid and Latin-1 otherwise", () => {
    expect(decodeText(new Uint8Array([0xc3, 0xa9]))).toBe("é");
    expect(decodeText(new Uint8Array([0xe9, 0x80]))).toBe("é\u0080");
  });
});
