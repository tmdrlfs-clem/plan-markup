// Document operations (Story 4.5, AR13). Framework-free.
//
// Every document mutation is a serialisable op: the editor turns it into an
// undo command ({ do, undo, label }) and serialises the history as ops
// (UX-DR36: it survives a reload until the browser tab closes); Epic 6 sends
// the same ops to the server. An op's inverse undoes it.

import { z } from "zod";

import { calibrationSchema, type Calibration } from "@/core/calibration/calibration";
import { markupSchema, type Markup } from "@/core/schema/markup";

const documentId = z.string().min(1).max(128);
const calibrationMap = z.record(z.string().min(1).max(200), calibrationSchema.nullable());

export const docOpSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markups.add"), documentId, markups: z.array(markupSchema).max(10_000) }),
  z.object({ kind: z.literal("markups.remove"), documentId, markups: z.array(markupSchema).max(10_000) }),
  /** Calibrations by page id before and after (null: none). */
  z.object({ kind: z.literal("calibrations.set"), documentId, before: calibrationMap, after: calibrationMap }),
]);

export type DocOp = z.infer<typeof docOpSchema>;

/** The op that undoes `op`. */
export function invertOp(op: DocOp): DocOp {
  switch (op.kind) {
    case "markups.add":
      return { kind: "markups.remove", documentId: op.documentId, markups: op.markups };
    case "markups.remove":
      return { kind: "markups.add", documentId: op.documentId, markups: op.markups };
    case "calibrations.set":
      return { kind: "calibrations.set", documentId: op.documentId, before: op.after, after: op.before };
  }
}

/** A document's markups after a markups op (in order; an id already present is replaced, a removed one dropped). */
export function applyMarkupsOp(markups: readonly Markup[], op: DocOp): Markup[] {
  if (op.kind === "markups.add") {
    const ids = new Set(op.markups.map((m) => m.id));
    return [...markups.filter((m) => !ids.has(m.id)), ...op.markups];
  }
  if (op.kind === "markups.remove") {
    const ids = new Set(op.markups.map((m) => m.id));
    return markups.filter((m) => !ids.has(m.id));
  }
  return [...markups];
}

/** Calibrations by page id after a calibrations op. */
export function applyCalibrationsOp(calibrations: Readonly<Record<string, Calibration>>, op: DocOp): Record<string, Calibration> {
  const next = { ...calibrations };
  if (op.kind !== "calibrations.set") return next;
  for (const [id, value] of Object.entries(op.after)) {
    if (value) next[id] = value;
    else delete next[id];
  }
  return next;
}
