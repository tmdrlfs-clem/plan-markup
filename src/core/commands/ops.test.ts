import { describe, expect, it } from "vitest";

import { factorForRatio, type Calibration } from "@/core/calibration/calibration";
import { uuidv7, UUID_PATTERN } from "@/core/ids/uuid";
import { DEFAULT_MEASURE_STYLE, markupSchema, type Markup } from "@/core/schema/markup";

import { applyCalibrationsOp, applyMarkupsOp, docOpSchema, invertOp, type DocOp } from "./ops";

const SHA = "a".repeat(64);
const length = (id: string, x = 72): Markup => ({
  id,
  type: "length",
  pageId: `${SHA}:0`,
  createdAt: "2026-10-25T00:00:00.000Z",
  style: DEFAULT_MEASURE_STYLE,
  points: [
    { x: 0, y: 0 },
    { x, y: 0 },
  ],
});
const cal: Calibration = { xFactor: factorForRatio(100), yFactor: factorForRatio(100), unit: "mm", precision: "0", source: "ratio", ratio: 100 };

describe("uuid v7 (Story 4.5)", () => {
  it("encodes the time, version 7 and the RFC variant; later ids sort after earlier ones", () => {
    const zero = () => new Uint8Array(16);
    const id = uuidv7(0x0123456789ab, zero);
    expect(id).toBe("01234567-89ab-7000-8000-000000000000");
    expect(UUID_PATTERN.test(uuidv7())).toBe(true);
    expect(uuidv7(1000) < uuidv7(2000)).toBe(true);
  });
});

describe("markup schema (Story 4.5, AR7)", () => {
  it("accepts a length; refuses other shapes, bad ids, colours and coordinates", () => {
    const ok = length(uuidv7());
    expect(markupSchema.parse(ok)).toEqual(ok);
    expect(markupSchema.safeParse({ ...ok, type: "area" }).success).toBe(false);
    expect(markupSchema.safeParse({ ...ok, id: "not-a-uuid" }).success).toBe(false);
    // Permissive pattern: any version nibble (Zod v4's uuid() is stricter).
    expect(markupSchema.safeParse({ ...ok, id: "00000000-0000-0000-0000-000000000000" }).success).toBe(true);
    expect(markupSchema.safeParse({ ...ok, style: { ...ok.style, color: "red" } }).success).toBe(false);
    expect(markupSchema.safeParse({ ...ok, points: [{ x: 0, y: 0 }] }).success).toBe(false);
    expect(markupSchema.safeParse({ ...ok, points: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }] }).success).toBe(false);
  });
});

describe("document ops (Story 4.5, AR13)", () => {
  it("add and remove markups; the inverse undoes; an op round-trips through its schema", () => {
    const a = length(uuidv7(1));
    const b = length(uuidv7(2), 144);
    const add: DocOp = { kind: "markups.add", documentId: SHA, markups: [b] };
    const after = applyMarkupsOp([a], add);
    expect(after.map((m) => m.id)).toEqual([a.id, b.id]);
    expect(applyMarkupsOp(after, invertOp(add))).toEqual([a]);
    // Adding an id again replaces it (redo after a restore never duplicates).
    expect(applyMarkupsOp(after, add)).toHaveLength(2);
    expect(docOpSchema.parse(JSON.parse(JSON.stringify(add)))).toEqual(add);
  });

  it("calibrations.set writes and clears page calibrations; its inverse restores them", () => {
    const op: DocOp = { kind: "calibrations.set", documentId: SHA, before: { [`${SHA}:0`]: null }, after: { [`${SHA}:0`]: cal } };
    const set = applyCalibrationsOp({}, op);
    expect(set).toEqual({ [`${SHA}:0`]: cal });
    expect(applyCalibrationsOp(set, invertOp(op))).toEqual({});
    expect(docOpSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
    expect(docOpSchema.safeParse({ ...op, kind: "drop.table" }).success).toBe(false);
  });
});
