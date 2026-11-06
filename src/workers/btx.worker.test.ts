import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isStream, type PdfString } from "@/core/btx/pdf-object";

import { drawsSomething } from "./btx-render";
import { btxImportRequest, btxParseRequest, btxReplyTransfer, handleBtxMessage } from "./btx.worker";

const SYNTHETIC = new URL("../../fixtures/btx/synthetic.btx", import.meta.url);

describe("btx worker message handler", () => {
  it("parses and replies with a structured-clone friendly tool set", async () => {
    const [msg, transfer] = btxParseRequest(7, new Uint8Array(readFileSync(SYNTHETIC)));
    expect(transfer).toEqual([msg.bytes.buffer]);
    const reply = await handleBtxMessage(msg);
    expect(reply.type).toBe("result");
    if (reply.type !== "result") return;
    expect(reply.reqId).toBe(7);
    expect(reply.toolSet.items).toHaveLength(5);
    expect(reply.toolSet.items[0]!.resources.map((r) => r.id)).toContain("SYNTHSTAMPFORMAA");
    // Survives structured clone (no Map, no class instances).
    expect(structuredClone(reply)).toEqual(reply);
  });

  it("replies with a serialized error for bad input", async () => {
    const reply = await handleBtxMessage({ type: "parse", reqId: 3, bytes: new TextEncoder().encode("<Other/>") });
    expect(reply).toEqual({
      type: "error",
      reqId: 3,
      error: expect.objectContaining({ name: "BtxError", message: expect.stringContaining("Not a Revu tool set") }),
      code: "structure-invalid",
    });
  });

  it("carries the BtxError code across the boundary (and only for BtxError)", async () => {
    const reply = await handleBtxMessage({ type: "parse", reqId: 3, bytes: new TextEncoder().encode("<Other/>") });
    expect(reply.type === "error" && reply.code).toBe("structure-invalid");
    expect(structuredClone(reply)).toEqual(reply);
    const typeError = await handleBtxMessage({ type: "parse", reqId: 4, bytes: "nope" });
    expect(typeError.type).toBe("error");
    expect(typeError).not.toHaveProperty("code");
  });

  it("replies to malformed requests instead of dropping them", async () => {
    expect(await handleBtxMessage({ type: "parse", reqId: 1, bytes: "nope" })).toMatchObject({
      type: "error",
      reqId: 1,
      error: { name: "TypeError" },
    });
    expect(await handleBtxMessage({ type: "other", reqId: 2 })).toMatchObject({ type: "error", reqId: 2 });
    for (const bad of [null, "x", { type: "parse" }, { type: "parse", reqId: "1" }, { type: "parse", reqId: Number.NaN }]) {
      expect(await handleBtxMessage(bad)).toMatchObject({ type: "error", reqId: null, error: { name: "TypeError" } });
    }
  });

  it("accepts an ArrayBuffer payload", async () => {
    const bytes = new Uint8Array(readFileSync(SYNTHETIC));
    const reply = await handleBtxMessage({ type: "parse", reqId: 5, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    expect(reply.type).toBe("result");
  });
});

describe("btxReplyTransfer", () => {
  it("lists every owned byte buffer of the tool set once", async () => {
    const [msg] = btxParseRequest(1, new Uint8Array(readFileSync(SYNTHETIC)));
    const reply = await handleBtxMessage(msg);
    if (reply.type !== "result") throw new Error("expected a result");
    // Two references to one string, and a view into a larger buffer.
    const shared: PdfString = { kind: "string", bytes: new Uint8Array([1, 2]), hex: false };
    const backing = new Uint8Array([9, 8, 7, 6]);
    const view: PdfString = { kind: "string", bytes: backing.subarray(1, 3), hex: false };
    reply.toolSet.items[0]!.annotations[0]!.dict.entries.push(["S1", shared], ["S2", shared], ["V", [view]]);
    const transfer = btxReplyTransfer(reply);
    expect(new Set(transfer).size).toBe(transfer.length);
    expect(transfer).toContain(shared.bytes.buffer);
    // The view was replaced by an owned copy; the unrelated backing buffer is not transferred.
    expect([...view.bytes]).toEqual([8, 7]);
    expect(view.bytes.buffer).not.toBe(backing.buffer);
    expect(transfer).not.toContain(backing.buffer);
    const stamp = reply.toolSet.items[0]!.resources.find((r) => r.id === "SYNTHSTAMPFORMAA")!.object;
    expect(isStream(stamp) && transfer.includes(stamp.data.buffer as ArrayBuffer)).toBe(true);
    // Posting with this list works (structuredClone applies the same transfer rules).
    const cloned = structuredClone(reply, { transfer });
    expect(cloned.toolSet.items).toHaveLength(5);
    expect(shared.bytes.byteLength).toBe(0); // detached: moved, not copied
  });

  it("transfers nothing for an error reply", async () => {
    expect(btxReplyTransfer(await handleBtxMessage(null))).toEqual([]);
  });
});

describe("btx worker import (Story 7.4)", () => {
  it("parses, draws each item with the renderer and transfers the PNGs", async () => {
    const [msg] = btxImportRequest(9, new Uint8Array(readFileSync(SYNTHETIC)), 1024);
    const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const reply = await handleBtxMessage(msg, async () => async () => png());
    expect(reply.type).toBe("imported");
    if (reply.type !== "imported") return;
    expect(reply.reqId).toBe(9);
    expect(reply.set.title).toBe("Synthetic Tools");
    expect(reply.set.items).toHaveLength(5);
    expect(btxReplyTransfer(reply)).toHaveLength(5);
  });

  it("a file that is not a tool set is an error with its code; no renderer is an error", async () => {
    const bad = await handleBtxMessage({ type: "import", reqId: 2, bytes: new TextEncoder().encode("<Other/>") }, async () => async () => null);
    expect(bad).toMatchObject({ type: "error", reqId: 2, code: "structure-invalid" });
    const none = await handleBtxMessage({ type: "import", reqId: 3, bytes: new Uint8Array(readFileSync(SYNTHETIC)) });
    expect(none).toMatchObject({ type: "error", reqId: 3 });
  });

  it("a fully transparent image draws nothing", () => {
    expect(drawsSomething(new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 0]))).toBe(false);
    expect(drawsSomething(new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 1]))).toBe(true);
  });
});
