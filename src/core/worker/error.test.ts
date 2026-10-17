import { describe, expect, it } from "vitest";
import { serializeWorkerError } from "./error";

describe("serializeWorkerError", () => {
  it("keeps name, message and stack of an Error", () => {
    const error = new Error("boom");
    const out = serializeWorkerError(error);
    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
    expect(out.stack).toBe(error.stack);
  });

  it("caps a long TypeError message at 500 and the stack at 4000", () => {
    const error = new TypeError("m".repeat(800));
    error.stack = "s".repeat(5000);
    const out = serializeWorkerError(error);
    expect(out.name).toBe("TypeError");
    expect(out.message).toHaveLength(500);
    expect(out.stack).toHaveLength(4000);
  });

  it.each([
    ["Riser note", "string"],
    [{ text: "Riser note" }, "object"],
    [null, "null"],
    [42, "number"],
    [undefined, "undefined"],
  ])("never stringifies a thrown %j", (value, kind) => {
    const out = serializeWorkerError(value);
    expect(out).toEqual({ name: "NonErrorThrown", message: `Non-Error value thrown (${kind})` });
    expect(JSON.stringify(out)).not.toContain("Riser");
  });
});
