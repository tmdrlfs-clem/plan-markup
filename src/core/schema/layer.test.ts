import { describe, expect, it } from "vitest";

import { applyLayersOp, docOpSchema, invertOp, opParts, type DocOp } from "@/core/commands/ops";

import { layerLocked, layerSchema, layerShown, moveLayer, nextLayerName, type Layer } from "./layer";

const A: Layer = { id: "00000000-0000-7000-8000-00000000000a", name: "Sprinklers" };
const B: Layer = { id: "00000000-0000-7000-8000-00000000000b", name: "Layer 2", hidden: true, locked: true };

describe("layers (Story 5.12)", () => {
  it("a layer has an id and a name of 1 to 100 characters", () => {
    expect(layerSchema.safeParse(A).success).toBe(true);
    expect(layerSchema.safeParse({ ...A, name: "   " }).success).toBe(false);
    expect(layerSchema.safeParse({ ...A, name: "x".repeat(101) }).success).toBe(false);
  });

  it("shown and locked by the layer; no layer, or one no longer there: shown, not locked", () => {
    expect(layerShown([A, B], A.id)).toBe(true);
    expect(layerShown([A, B], B.id)).toBe(false);
    expect(layerShown([A, B], undefined)).toBe(true);
    expect(layerShown([A], B.id)).toBe(true);
    expect(layerLocked([A, B], B.id)).toBe(true);
    expect(layerLocked([A, B], A.id)).toBe(false);
  });

  it("a new layer's name is the first free \"Layer n\"; a layer moves one place", () => {
    expect(nextLayerName([])).toBe("Layer 1");
    expect(nextLayerName([A, B])).toBe("Layer 3");
    expect(nextLayerName([{ ...A, name: "layer 2" }])).toBe("Layer 3");
    expect(moveLayer([A, B], B.id, -1)).toEqual([B, A]);
    const same = [A, B];
    expect(moveLayer(same, A.id, -1)).toBe(same);
  });

  it("a compound op applies its parts in order and is undone in reverse", () => {
    const op: DocOp = {
      kind: "compound",
      documentId: "doc",
      ops: [
        { kind: "markups.update", documentId: "doc", before: [], after: [] },
        { kind: "layers.set", documentId: "doc", before: [A, B], after: [A] },
      ],
    };
    expect(docOpSchema.safeParse(op).success).toBe(true);
    const back = invertOp(op);
    expect(opParts(back).map((p) => p.kind)).toEqual(["layers.set", "markups.update"]);
    const layers = opParts(back).find((p) => p.kind === "layers.set")!;
    expect(applyLayersOp([A], layers)).toEqual([A, B]);
    // Compound ops do not nest.
    expect(docOpSchema.safeParse({ kind: "compound", documentId: "doc", ops: [op] }).success).toBe(false);
  });
});
