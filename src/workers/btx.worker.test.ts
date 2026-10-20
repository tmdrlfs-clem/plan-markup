import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { btxParseRequest, handleBtxMessage } from "./btx.worker";

const SYNTHETIC = new URL("../../fixtures/btx/synthetic.btx", import.meta.url);

describe("btx worker message handler", () => {
  it("parses and replies with a structured-clone friendly tool set", async () => {
    const [msg, transfer] = btxParseRequest(7, new Uint8Array(readFileSync(SYNTHETIC)));
    expect(transfer).toEqual([msg.bytes.buffer]);
    const reply = await handleBtxMessage(msg);
    expect(reply?.type).toBe("result");
    if (reply?.type !== "result") return;
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
    });
  });

  it("rejects non-Uint8Array payloads and ignores unknown messages", async () => {
    const reply = await handleBtxMessage({ type: "parse", reqId: 1, bytes: "nope" });
    expect(reply?.type).toBe("error");
    expect(await handleBtxMessage({ type: "other" })).toBeUndefined();
    expect(await handleBtxMessage(null)).toBeUndefined();
  });
});
